// Injected into every BentoPDF tool page in the desktop build (see
// vite.desktop.config.ts). When the page runs inside the app window's tool
// sheet it:
//   - hides site chrome (navbar, footer, marketing sections)
//   - loads the document handed over by the app window into the tool
//   - sends files the tool would download back to the app window instead
// Outside the app window it does nothing, so tool pages keep working as-is.

import { onPageReady } from '../js/i18n/i18n.js';

interface DesktopHost {
  attach(win: Window): { files: File[] } | null;
  download(blob: Blob, name: string, win: Window): void;
}

declare global {
  interface Window {
    __bentoDesktopHost?: DesktopHost;
    __bentoEmbedded?: { addFiles(files: File[]): boolean };
  }
}

function findHost(): DesktopHost | null {
  try {
    if (window.parent === window) return null;
    return window.parent.__bentoDesktopHost ?? null;
  } catch {
    return null;
  }
}

const EMBED_CSS = `
html.bento-embedded body > nav,
html.bento-embedded body > header,
html.bento-embedded body > footer,
html.bento-embedded body > section,
html.bento-embedded [data-simple-footer],
html.bento-embedded #tool-landing,
html.bento-embedded #back-to-tools,
html.bento-embedded #mobile-menu,
html.bento-embedded .faq-list { display: none !important; }
html.bento-embedded #uploader { min-height: 100vh; }
`;

function installDownloadInterception(send: (blob: Blob, name: string) => void) {
  const blobs = new Map<string, Blob>();
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = createObjectURL(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    // Keep the Blob reachable briefly: some tools revoke right after click().
    setTimeout(() => blobs.delete(url), 30_000);
    revokeObjectURL(url);
  };

  const dataUrlToBlob = (href: string): Blob | null => {
    const m = href.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!m) return null;
    const bytes = m[2]
      ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  };

  const handle = (a: HTMLAnchorElement): boolean => {
    if (!a.hasAttribute('download')) return false;
    const href = a.href;
    const blob =
      blobs.get(href) ??
      (href.startsWith('data:') ? dataUrlToBlob(href) : null);
    if (!blob) return false;
    send(blob, a.download || 'download');
    return true;
  };

  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (handle(this)) return;
    click.call(this);
  };
  const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (
    this: HTMLAnchorElement,
    ev: Event
  ) {
    if (ev.type === 'click' && handle(this)) return false;
    return dispatch.call(this, ev);
  };
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[download]');
      if (a instanceof HTMLAnchorElement && handle(a)) e.preventDefault();
    },
    true
  );
}

function findFileInput(): HTMLInputElement | null {
  for (const sel of ['#file-input', '#pdf-file-input', '#file']) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLInputElement && el.type === 'file') return el;
  }
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ];
  return (
    inputs.find((i) => (i.accept || '').includes('pdf')) ?? inputs[0] ?? null
  );
}

function giveFiles(files: File[]): boolean {
  const input = findFileInput();
  if (!input || files.length === 0) return false;
  const dt = new DataTransfer();
  const list = input.multiple ? files : files.slice(0, 1);
  for (const f of list) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const host = findHost();
if (host) {
  document.documentElement.classList.add('bento-embedded');
  const style = document.createElement('style');
  style.textContent = EMBED_CSS;
  document.head.appendChild(style);

  installDownloadInterception((blob, name) =>
    host.download(blob, name, window)
  );
  window.__bentoEmbedded = { addFiles: giveFiles };

  const ctx = host.attach(window);
  if (ctx && ctx.files.length > 0) {
    // Page scripts attach their input listeners in their own onPageReady
    // callbacks, which run after this one; wait a moment for them.
    onPageReady(() => {
      setTimeout(() => giveFiles(ctx.files), 150);
    });
  }
}

export {};
