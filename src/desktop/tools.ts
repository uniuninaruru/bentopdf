// Tool panel and tool sheet. Tools are BentoPDF's existing tool pages, loaded
// in a same-origin iframe. embed-bridge.ts (inside the page) hands the current
// document to the tool and sends the tool's output back here.

import { categories } from '../js/config/tools.js';
import {
  categoryTranslationKeys,
  toolTranslationKeys,
} from '../js/config/tool-translation-keys.js';
import { t, formatSize } from './i18n.js';

export interface ToolDef {
  id: string;
  name: string;
  sub: string;
  icon: string;
  /** Hand the open document to the tool. */
  usesDocument: boolean;
  /** Apply a PDF result to the document straight away and close the sheet. */
  autoApply?: boolean;
}

export interface ToolResult {
  blob: Blob;
  name: string;
}

export interface HostApi {
  activeDocument(): { id: string; name: string } | null;
  documentFile(id: string): Promise<File>;
  replaceDocument(id: string, bytes: Uint8Array, label: string): Promise<void>;
  openBytes(bytes: Uint8Array, name: string): Promise<void>;
  saveBytes(bytes: Uint8Array, name: string): Promise<boolean>;
  toast(message: string, error?: boolean): void;
  confirm(title: string, message: string, ok: string): Promise<boolean>;
  sheetChanged(open: boolean): void;
}

// Pages hidden in the desktop app: the viewer itself replaces the PDF Editor,
// assets are bundled so WASM settings are moot, and size presets duplicate
// Compress PDF.
const HIDDEN = new Set(['edit-pdf', 'wasm-settings']);
const HIDDEN_PREFIX = ['compress-pdf-to-', 'compress-pdf-for-'];

// Tools that create a new PDF from other files rather than changing the open one.
const CREATES_NEW =
  /-to-pdf$|^(image-to-pdf|email-to-pdf|form-creator|pdf-workflow)$/;
const AUTO_APPLY = new Set(['edit-pdf-text', 'pdf-multi-tool', 'organize-pdf']);

let i18nReady: Promise<(key: string) => string> | null = null;

/** BentoPDF's translations (public/locales) for tool names. */
function bentoTranslator(): Promise<(key: string) => string> {
  if (!i18nReady) {
    i18nReady = import('../js/i18n/i18n.js').then(async (m) => {
      await m.initI18n();
      return (key: string) => {
        const v = m.t(key);
        return v === key || v === key.split(':').pop() ? '' : v;
      };
    });
  }
  return i18nReady;
}

interface CatalogGroup {
  title: string;
  tools: ToolDef[];
}

let catalogCache: {
  groups: CatalogGroup[];
  byId: Map<string, ToolDef>;
} | null = null;

export async function loadCatalog(): Promise<{
  groups: CatalogGroup[];
  byId: Map<string, ToolDef>;
}> {
  if (catalogCache) return catalogCache;
  const tr = await bentoTranslator().catch(() => (_k: string) => '');
  const byId = new Map<string, ToolDef>();
  const groups: CatalogGroup[] = [];

  for (const category of categories) {
    const tools: ToolDef[] = [];
    for (const tool of category.tools) {
      const id = tool.href
        .split('/')
        .pop()!
        .replace(/\.html$/, '');
      if (HIDDEN.has(id) || HIDDEN_PREFIX.some((p) => id.startsWith(p)))
        continue;
      const key = toolTranslationKeys[tool.name];
      let def = byId.get(id);
      if (!def) {
        def = {
          id,
          name: (key && tr(`${key}.name`)) || tool.name,
          sub: (key && tr(`${key}.subtitle`)) || tool.subtitle,
          icon: tool.icon?.startsWith('ph-') ? tool.icon : 'ph-wrench',
          usesDocument: !CREATES_NEW.test(id),
          autoApply: AUTO_APPLY.has(id),
        };
        byId.set(id, def);
      }
      if (!tools.includes(def)) tools.push(def);
    }
    const catKey = categoryTranslationKeys[category.name];
    if (tools.length)
      groups.push({ title: (catKey && tr(catKey)) || category.name, tools });
  }

  // The desktop's own names for the two editing entry points.
  const edit = byId.get('edit-pdf-text');
  if (edit)
    Object.assign(edit, { name: t('editContent'), sub: t('editContentSub') });
  const organize = byId.get('pdf-multi-tool');
  if (organize)
    Object.assign(organize, { name: t('organize'), sub: t('organizeSub') });

  catalogCache = { groups, byId };
  return catalogCache;
}

// ---------------------------------------------------------------- tool panel

export class ToolPanel {
  private panel = document.getElementById('tool-panel')!;
  private list = document.getElementById('tool-list')!;
  private search = document.getElementById('tool-search') as HTMLInputElement;
  private button = document.getElementById('btn-tools')!;

  constructor(private onPick: (tool: ToolDef) => void) {
    this.search.placeholder = t('searchTools');
    this.search.addEventListener('input', () => void this.render());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
      if (e.key === 'Enter') {
        const first = this.list.querySelector<HTMLButtonElement>('.tool-item');
        first?.click();
      }
    });
    this.button.addEventListener('click', () => this.toggle());
  }

  get visible(): boolean {
    return !this.panel.hidden;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else void this.show();
  }

  async show(focusSearch = false, query = ''): Promise<void> {
    this.panel.hidden = false;
    this.button.setAttribute('aria-pressed', 'true');
    if (query !== undefined) this.search.value = query;
    await this.render();
    if (focusSearch) this.search.focus();
  }

  hide(): void {
    this.panel.hidden = true;
    this.button.setAttribute('aria-pressed', 'false');
  }

  private async render(): Promise<void> {
    const { groups, byId } = await loadCatalog();
    const q = this.search.value.trim().toLowerCase();
    this.list.textContent = '';
    if (q) {
      // A tool can be listed in several categories; show each match once.
      const matches = [...byId.values()].filter((tool) =>
        `${tool.name} ${tool.sub} ${tool.id}`.toLowerCase().includes(q)
      );
      if (matches.length) {
        this.list.appendChild(this.group(null, matches));
      } else {
        const empty = document.createElement('div');
        empty.className = 'tool-empty';
        empty.textContent = t('noTools');
        this.list.appendChild(empty);
      }
      return;
    }
    for (const g of groups) this.list.appendChild(this.group(g.title, g.tools));
  }

  private group(title: string | null, tools: ToolDef[]): HTMLElement {
    const section = document.createElement('div');
    section.className = 'tool-group';
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      section.appendChild(h);
    }
    for (const tool of tools) {
      const btn = document.createElement('button');
      btn.className = 'tool-item';
      btn.title = tool.sub;
      const icon = document.createElement('i');
      icon.className = `ph ${tool.icon}`;
      const text = document.createElement('span');
      text.className = 'tool-item-text';
      const name = document.createElement('span');
      name.className = 'tool-item-name';
      name.textContent = tool.name;
      const sub = document.createElement('span');
      sub.className = 'tool-item-sub';
      sub.textContent = tool.sub;
      text.append(name, sub);
      btn.append(icon, text);
      btn.addEventListener('click', () => this.onPick(tool));
      section.appendChild(btn);
    }
    return section;
  }
}

// ---------------------------------------------------------------- tool sheet

interface Session {
  tool: ToolDef;
  docId: string | null;
  docName: string | null;
  files: File[];
  results: ToolResult[];
  applied: boolean;
}

export class ToolSheet {
  private sheet = document.getElementById('sheet')!;
  private frame = document.getElementById('sheet-frame') as HTMLIFrameElement;
  private loading = document.getElementById('sheet-loading')!;
  private resultBar = document.getElementById('result-bar')!;
  private resultText = document.getElementById('result-text')!;
  private resultActions = document.getElementById('result-actions')!;
  private session: Session | null = null;

  constructor(private api: HostApi) {
    window.__bentoDesktopHost = {
      attach: (win) => this.attach(win),
      download: (blob, name, win) => void this.receive(blob, name, win),
    };
    document
      .getElementById('sheet-close')!
      .addEventListener('click', () => void this.close());
    this.frame.addEventListener('load', () => {
      this.loading.hidden = true;
    });
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  get toolId(): string | null {
    return this.session?.tool.id ?? null;
  }

  async open(tool: ToolDef): Promise<void> {
    if (this.session && !(await this.close())) return;
    const active =
      tool.usesDocument || tool.id === 'merge-pdf'
        ? this.api.activeDocument()
        : null;
    let files: File[] = [];
    if (active) {
      files = [await this.api.documentFile(active.id)];
    }
    this.session = {
      tool,
      docId: tool.usesDocument ? (active?.id ?? null) : null,
      docName: active?.name ?? null,
      files,
      results: [],
      applied: false,
    };
    document.getElementById('sheet-icon')!.className = `ph ${tool.icon}`;
    document.getElementById('sheet-name')!.textContent = tool.name;
    document.getElementById('sheet-doc')!.textContent = active
      ? `— ${active.name}`
      : '';
    this.resultBar.hidden = true;
    this.loading.hidden = false;
    this.sheet.hidden = false;
    this.frame.src = `/${tool.id}.html`;
    this.api.sheetChanged(true);
  }

  /** Files dropped on the window while a tool is open go to the tool. */
  addFiles(files: File[]): boolean {
    try {
      return (
        this.frame.contentWindow?.__bentoEmbedded?.addFiles(files) ?? false
      );
    } catch {
      return false;
    }
  }

  /** Sends a key press to the tool (menu shortcuts swallow real key events). */
  forwardKey(init: KeyboardEventInit): void {
    try {
      const win = this.frame.contentWindow;
      const target = win?.document.activeElement ?? win?.document.body;
      target?.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );
    } catch {
      /* cross-origin pages are never loaded here */
    }
  }

  /** True when the tool has work it would warn about on unload. */
  hasUnsavedWork(): boolean {
    if (!this.session || this.session.applied) return false;
    try {
      const win = this.frame.contentWindow;
      if (!win) return false;
      const ev = new Event('beforeunload', { cancelable: true });
      return !win.dispatchEvent(ev);
    } catch {
      return false;
    }
  }

  /** Closes the sheet. Resolves false if the user chose to keep it open. */
  async close(force = false): Promise<boolean> {
    if (!this.session) return true;
    if (!force && this.hasUnsavedWork()) {
      const ok = await this.api.confirm(
        t('confirmTitle'),
        t('toolUnsaved'),
        t('closeAnyway')
      );
      if (!ok) return false;
    }
    this.session = null;
    this.sheet.hidden = true;
    this.resultBar.hidden = true;
    this.frame.src = 'about:blank';
    this.api.sheetChanged(false);
    return true;
  }

  private attach(win: Window): { files: File[] } | null {
    if (!this.session || win !== this.frame.contentWindow) return null;
    this.loading.hidden = true;
    return { files: this.session.files };
  }

  private async receive(blob: Blob, name: string, win: Window): Promise<void> {
    const s = this.session;
    if (!s || win !== this.frame.contentWindow) return;
    const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test(name);

    if (isPdf && s.tool.autoApply && s.docId) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await this.api.replaceDocument(s.docId, bytes, s.tool.name);
      s.applied = true;
      await this.close(true);
      this.api.toast(t('resultApplied', { tool: s.tool.name }));
      return;
    }
    if (!isPdf) {
      // Images, ZIPs, Office files…: save right away, like a download.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (await this.api.saveBytes(bytes, name)) {
        this.api.toast(t('resultSaved', { name }));
      }
      return;
    }
    s.results.push({ blob, name });
    this.showResults();
  }

  private showResults(): void {
    const s = this.session;
    if (!s) return;
    const results = s.results;
    const last = results[results.length - 1];
    this.resultText.textContent =
      results.length === 1
        ? t('resultReady', {
            name: last.name,
            size: formatSize(last.blob.size),
          })
        : t('resultReady', {
            name: `${results.length} PDF`,
            size: formatSize(results.reduce((n, r) => n + r.blob.size, 0)),
          });
    this.resultActions.textContent = '';
    const add = (
      label: string,
      primary: boolean,
      action: () => Promise<void>
    ) => {
      const b = document.createElement('button');
      b.className = primary ? 'btn btn-primary' : 'btn';
      b.textContent = label;
      b.addEventListener('click', () => void action());
      this.resultActions.appendChild(b);
    };

    if (results.length === 1 && s.docId) {
      add(t('replaceDoc'), true, async () => {
        const bytes = new Uint8Array(await last.blob.arrayBuffer());
        await this.api.replaceDocument(s.docId!, bytes, s.tool.name);
        s.applied = true;
        await this.close(true);
        this.api.toast(t('resultApplied', { tool: s.tool.name }));
      });
    }
    add(t('openAsNew'), results.length === 1 && !s.docId, async () => {
      for (const r of results) {
        await this.api.openBytes(
          new Uint8Array(await r.blob.arrayBuffer()),
          r.name
        );
      }
      s.applied = true;
      await this.close(true);
      this.api.toast(t('resultOpened', { name: last.name }));
    });
    add(t('saveToFile'), false, async () => {
      for (const r of results) {
        const ok = await this.api.saveBytes(
          new Uint8Array(await r.blob.arrayBuffer()),
          r.name
        );
        if (!ok) return;
      }
      s.applied = true;
      this.api.toast(t('resultSaved', { name: last.name }));
    });
    this.resultBar.hidden = false;
  }
}
