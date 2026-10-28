// Bridge to the Rust side. When the window is opened in a plain browser (UI
// development without Tauri), a small in-memory fallback keeps the app usable.

import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface FileRef {
  path: string;
  name: string;
  size: number;
  writable: boolean;
}

export interface ReadyInfo {
  files: FileRef[];
  menu: string[];
  lang: string;
  version: string;
}

export interface AppInfo {
  version: string;
  lang: string;
  sourceUrl: string;
  upstreamUrl: string;
  logPath: string | null;
}

export type UnsavedAnswer = 'save' | 'discard' | 'cancel';

export const isTauri = '__TAURI_INTERNALS__' in window;

// ----------------------------------------------------------- browser fallback

const memoryFiles = new Map<string, File>();
let memoryCounter = 0;

function pickFiles(accept: string): Promise<FileRef[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.onchange = () => {
      const refs = [...(input.files ?? [])].map((f) => {
        const path = `memory://${++memoryCounter}/${f.name}`;
        memoryFiles.set(path, f);
        return { path, name: f.name, size: f.size, writable: false };
      });
      resolve(refs);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function browserDownload(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------- API

export const native = {
  async ready(): Promise<ReadyInfo> {
    if (!isTauri) {
      return { files: [], menu: [], lang: navigator.language, version: 'dev' };
    }
    return invoke<ReadyInfo>('frontend_ready');
  },

  async openDialog(pdfOnly = true): Promise<FileRef[]> {
    if (!isTauri) return pickFiles(pdfOnly ? 'application/pdf' : '');
    return invoke<FileRef[]>('open_dialog', { pdfOnly });
  },

  async readFile(path: string): Promise<Uint8Array> {
    if (!isTauri) {
      const f = memoryFiles.get(path);
      if (!f) throw new Error('file not found');
      return new Uint8Array(await f.arrayBuffer());
    }
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    return new Uint8Array(buf);
  },

  async saveDialog(
    defaultName: string,
    directory?: string
  ): Promise<FileRef | null> {
    if (!isTauri) {
      const path = `download://${defaultName}`;
      return { path, name: defaultName, size: 0, writable: true };
    }
    return invoke<FileRef | null>('save_dialog', {
      defaultName,
      directory: directory ?? null,
    });
  },

  async writeFile(path: string, bytes: Uint8Array): Promise<FileRef> {
    if (!isTauri) {
      const name = path.split('/').pop() || 'document.pdf';
      browserDownload(bytes, name);
      return { path, name, size: bytes.length, writable: true };
    }
    return invoke<FileRef>('write_file', bytes, {
      headers: { 'x-path': encodeURIComponent(path) },
    });
  },

  async recentFiles(): Promise<FileRef[]> {
    if (!isTauri) return [];
    return invoke<FileRef[]>('recent_files');
  },

  async openRecent(path: string): Promise<FileRef> {
    return invoke<FileRef>('open_recent', { path });
  },

  async clearRecent(): Promise<void> {
    if (isTauri) await invoke('clear_recent');
  },

  async setDocumentState(edited: boolean, path: string | null): Promise<void> {
    if (isTauri) await invoke('set_document_state', { edited, path });
  },

  async askUnsaved(names: string[]): Promise<UnsavedAnswer> {
    if (!isTauri) {
      return window.confirm(`Save changes to ${names.join(', ')}?`)
        ? 'save'
        : 'discard';
    }
    return invoke<UnsavedAnswer>('ask_unsaved', { names });
  },

  /** Native macOS print panel (PDFKit). Resolves when the panel closes. */
  async printPdf(bytes: Uint8Array, title: string): Promise<void> {
    if (!isTauri) throw new Error('printing needs the desktop app');
    await invoke('print_pdf', bytes, {
      headers: { 'x-title': encodeURIComponent(title) },
    });
  },

  async closeWindow(proceed: boolean): Promise<void> {
    if (isTauri) await invoke('close_window', { proceed });
  },

  async newWindow(): Promise<void> {
    if (isTauri) await invoke('new_window');
    else window.open(location.href);
  },

  async openExternal(url: string): Promise<void> {
    if (isTauri) await invoke('open_external', { url });
    else window.open(url, '_blank', 'noopener');
  },

  async appInfo(): Promise<AppInfo> {
    if (!isTauri) {
      return {
        version: 'dev',
        lang: navigator.language,
        sourceUrl: 'https://github.com/uniuninaruru/bentopdf',
        upstreamUrl: 'https://github.com/alam00000/bentopdf',
        logPath: null,
      };
    }
    return invoke<AppInfo>('app_info');
  },

  log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    if (isTauri) void invoke('log_line', { level, message }).catch(() => {});
    else console.log(`[${level}] ${message}`);
  },

  async on<T>(
    event: string,
    handler: (payload: T) => void
  ): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    // Scoped to this window: Rust emits per-window events (open-files, menu…).
    return getCurrentWebviewWindow().listen<T>(event, (e) =>
      handler(e.payload)
    );
  },
};

/** Directory part of a path, for Save panels. */
export function dirname(path: string | null | undefined): string | undefined {
  if (!path || !path.startsWith('/')) return undefined;
  return path.slice(0, path.lastIndexOf('/')) || '/';
}
