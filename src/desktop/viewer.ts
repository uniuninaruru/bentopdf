// Wraps the bundled EmbedPDF viewer (the same engine as the web PDF Editor)
// and exposes what the desktop window needs: documents with stable ids,
// commands, modification events and export.

import type { EmbedPdfContainer, PluginRegistry } from 'bentopdf-viewer';
import type {
  AppliedRedactionTracker,
  RedactionPluginLite,
  ViewerCommandsPlugin,
} from '@/types';
import { editorFontFallback } from '../js/config/editor-fonts.js';
import { getEditorDisabledCategories } from '../js/utils/disabled-tools.js';
import {
  exportEditedPdf,
  trackAppliedRedactions,
} from '../js/logic/edit-pdf-export.js';

const wasmUrl = new URL('bentopdf-pdfium/editcore.wasm', import.meta.url).href;

/* Minimal views of the plugin capabilities used here. */
interface DocumentState {
  id: string;
  name?: string;
  document?: { pageCount?: number; pages?: unknown[] } | null;
}
interface DocManager {
  openDocumentBuffer(opts: {
    buffer: ArrayBuffer;
    name: string;
    documentId?: string;
    autoActivate?: boolean;
  }): unknown;
  closeDocument(id: string): { toPromise?: () => Promise<unknown> };
  setActiveDocument(id: string): void;
  getActiveDocumentId(): string | null;
  getDocumentOrder(): string[];
  moveDocument(id: string, toIndex: number): void;
  getDocumentState(id: string): DocumentState | null;
  isDocumentOpen(id: string): boolean;
  onDocumentOpened(cb: (s: DocumentState) => void): void;
  onDocumentClosed(cb: (id: string | { id?: string }) => void): void;
  onDocumentError(
    cb: (e: { documentId: string; message: string; code?: number }) => void
  ): void;
  onActiveDocumentChanged(
    cb: (e: {
      previousDocumentId: string | null;
      currentDocumentId: string | null;
    }) => void
  ): void;
}
interface Task<T> {
  toPromise(): Promise<T>;
}
interface ExportCap {
  saveAsCopy(): Task<ArrayBuffer>;
  forDocument(id: string): { saveAsCopy(): Task<ArrayBuffer> };
}
interface ScrollCap {
  getCurrentPage(): number;
  getTotalPages(): number;
  scrollToPage(opts: { pageNumber: number; behavior?: string }): void;
  forDocument(id: string): {
    getCurrentPage(): number;
    getTotalPages(): number;
    scrollToPage(opts: { pageNumber: number; behavior?: string }): void;
  };
}
interface CommandsCap extends ViewerCommandsPlugin {
  execute(id: string, documentId?: string, source?: string): void;
}
export interface ViewerCallbacks {
  opened(id: string): void;
  closed(id: string): void;
  activeChanged(id: string | null): void;
  modified(id: string): void;
  failed(id: string, message: string): void;
}

const MODIFYING_ANNOTATION_EVENTS = new Set([
  'create',
  'update',
  'delete',
  'add',
  'remove',
  'clear',
]);

export class Viewer {
  private container: EmbedPdfContainer | null = null;
  registry!: PluginRegistry;
  private docs!: DocManager;
  private commands: CommandsCap | null = null;
  private redaction: RedactionPluginLite | null = null;
  private tracker: AppliedRedactionTracker | null = null;
  private waiting = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void }
  >();
  private loading = new Set<string>();
  private counter = 0;

  async init(
    target: HTMLElement,
    opts: { locale: string; author: string; callbacks: ViewerCallbacks }
  ): Promise<void> {
    const { default: EmbedPDF } = await import('bentopdf-viewer');
    const container = EmbedPDF.init({
      type: 'container',
      target,
      worker: true,
      wasmUrl,
      fontFallback: editorFontFallback,
      disabledCategories: getEditorDisabledCategories(),
      documentManager: { maxDocuments: 50 },
      tabBar: 'never',
      theme: { preference: 'system' },
      i18n: { defaultLocale: opts.locale },
      annotations: { annotationAuthor: opts.author },
      export: { defaultFileName: 'document.pdf' },
    } as Parameters<typeof EmbedPDF.init>[0]);
    if (!container) throw new Error('viewer failed to start');
    this.container = container;
    this.registry = await container.registry;
    const r = this.registry;
    const provides = <T>(id: string): T | null => {
      try {
        return (r.getPlugin(id)?.provides() as unknown as T) ?? null;
      } catch {
        return null;
      }
    };

    this.docs = provides<DocManager>('document-manager')!;
    this.commands = provides<CommandsCap>('commands');
    this.redaction = provides<RedactionPluginLite>('redaction');
    this.tracker = this.redaction
      ? trackAppliedRedactions(this.redaction)
      : null;
    const cb = opts.callbacks;

    this.docs.onDocumentOpened((s) => {
      this.loading.delete(s.id);
      this.waiting.get(s.id)?.resolve();
      this.waiting.delete(s.id);
      cb.opened(s.id);
    });
    this.docs.onDocumentError((e) => {
      this.loading.delete(e.documentId);
      const w = this.waiting.get(e.documentId);
      if (w) {
        w.reject(new Error(e.message));
        this.waiting.delete(e.documentId);
      }
      cb.failed(e.documentId, e.message);
    });
    this.docs.onDocumentClosed((d) => {
      const id = typeof d === 'string' ? d : d?.id || '';
      this.tracker?.forget(id);
      cb.closed(id);
    });
    this.docs.onActiveDocumentChanged((e) =>
      cb.activeChanged(e.currentDocumentId)
    );

    const annotation = provides<{
      onAnnotationEvent(
        fn: (e: { type: string; documentId?: string }) => void
      ): void;
    }>('annotation');
    annotation?.onAnnotationEvent((e) => {
      if (
        MODIFYING_ANNOTATION_EVENTS.has(e.type) &&
        e.documentId &&
        !this.loading.has(e.documentId)
      ) {
        cb.modified(e.documentId);
      }
    });
    this.redaction?.onRedactionEvent((e) => {
      if (e.type === 'commit' && e.documentId) cb.modified(e.documentId);
    });
    const history = provides<{
      onHistoryChange(fn: (e: { documentId: string }) => void): void;
    }>('history');
    history?.onHistoryChange((e) => {
      if (e.documentId && !this.loading.has(e.documentId))
        cb.modified(e.documentId);
    });
  }

  /** Replaces a viewer command (e.g. the toolbar's open/export) with our own action. */
  overrideCommand(id: string, action: () => void): void {
    const c = this.commands;
    if (!c) return;
    type Resolved = {
      labelKey?: string;
      icon?: string;
      categories?: string[];
    } | null;
    let existing: Resolved;
    try {
      // resolve() needs an active document; before one is open, use defaults.
      existing =
        (c as unknown as { resolve?: (id: string) => Resolved }).resolve?.(
          id
        ) ?? null;
    } catch {
      existing = null;
    }
    c.unregisterCommand(id);
    c.registerCommand({
      id,
      labelKey: existing?.labelKey ?? id,
      icon: existing?.icon ?? 'file',
      categories: existing?.categories ?? ['document'],
      action,
    });
  }

  exec(id: string): void {
    try {
      this.commands?.execute(id, this.activeId() ?? undefined, 'ui');
    } catch (err) {
      console.warn('viewer command failed', id, err);
    }
  }

  /** Opens a PDF and resolves with its id once it has loaded. */
  async open(
    bytes: Uint8Array,
    name: string,
    activate = true
  ): Promise<string> {
    const id = `d${Date.now().toString(36)}${(++this.counter).toString(36)}`;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const done = new Promise<void>((resolve, reject) =>
      this.waiting.set(id, { resolve, reject })
    );
    this.loading.add(id);
    this.docs.openDocumentBuffer({
      buffer,
      name,
      documentId: id,
      autoActivate: activate,
    });
    await done;
    // Annotation 'loaded' events and history resets settle right after open.
    setTimeout(() => this.loading.delete(id), 300);
    return id;
  }

  async close(id: string): Promise<void> {
    if (!this.docs.isDocumentOpen(id)) return;
    const task = this.docs.closeDocument(id);
    await task?.toPromise?.().catch(() => {});
  }

  activate(id: string): void {
    if (
      this.docs.isDocumentOpen(id) &&
      this.docs.getActiveDocumentId() !== id
    ) {
      this.docs.setActiveDocument(id);
    }
  }

  activeId(): string | null {
    return this.docs?.getActiveDocumentId() ?? null;
  }

  move(id: string, index: number): void {
    try {
      this.docs.moveDocument(id, index);
    } catch {
      /* order is cosmetic */
    }
  }

  isOpen(id: string): boolean {
    return this.docs.isDocumentOpen(id);
  }

  pageCount(id: string): number {
    const s = this.docs.getDocumentState(id);
    return s?.document?.pageCount ?? s?.document?.pages?.length ?? 0;
  }

  private scroll(): ScrollCap | null {
    try {
      return this.registry
        .getPlugin('scroll')
        ?.provides() as unknown as ScrollCap;
    } catch {
      return null;
    }
  }

  /** Current page, 1-based. */
  currentPage(id: string): number {
    try {
      return this.scroll()?.forDocument(id).getCurrentPage() ?? 1;
    } catch {
      return 1;
    }
  }

  goToPage(id: string, pageNumber: number): void {
    try {
      this.scroll()
        ?.forDocument(id)
        .scrollToPage({ pageNumber, behavior: 'instant' });
    } catch (err) {
      console.warn('scroll failed', err);
    }
  }

  pendingRedactions(id: string): number {
    if (this.activeId() !== id) this.activate(id);
    return this.redaction?.getState().pendingCount ?? 0;
  }

  /** The document as the viewer holds it, annotations included, no post-processing. */
  async rawBytes(id: string): Promise<Uint8Array> {
    const exp = this.registry
      .getPlugin('export')
      .provides() as unknown as ExportCap;
    const buf = await exp.forDocument(id).saveAsCopy().toPromise();
    return new Uint8Array(buf);
  }

  /** Final bytes for saving: applies redactions, flattens FreeText, embeds fonts. */
  async exportForSave(
    id: string,
    ui: {
      confirm: (
        title: string,
        message: string,
        confirmLabel: string
      ) => Promise<boolean>;
      showAlert: (title: string, message: string) => void;
      showLoader: (message: string) => void;
      hideLoader: () => void;
      applyLabel: string;
    }
  ): Promise<Uint8Array | null> {
    this.activate(id);
    // Activation is synchronous in the store, but give the UI a tick to follow.
    await new Promise((r) => setTimeout(r, 0));
    return exportEditedPdf({
      registry: this.registry,
      documentId: id,
      redactionPlugin: this.redaction,
      redactionTracker: this.tracker,
      confirm: ui.confirm,
      showAlert: ui.showAlert,
      showLoader: ui.showLoader,
      hideLoader: ui.hideLoader,
      applyLabel: ui.applyLabel,
    });
  }
}
