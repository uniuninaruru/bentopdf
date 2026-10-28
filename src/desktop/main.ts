// BentoPDF desktop app window: document tabs around the PDF viewer, native
// open/save, menu commands, drag and drop, tools, and unsaved-changes checks.

import '@phosphor-icons/web/regular';
import './desktop.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { supportedLanguages } from '../js/i18n/i18n.js';
import { native, isTauri, dirname, type FileRef } from './native.js';
import {
  t,
  setLanguage,
  applyStaticText,
  formatSize,
  language,
} from './i18n.js';
import { Viewer } from './viewer.js';
import { ToolPanel, ToolSheet, loadCatalog, type ToolDef } from './tools.js';
import * as pages from './pages.js';

interface Doc {
  id: string;
  name: string;
  /** File on disk; null for documents that have never been saved. */
  path: string | null;
  writable: boolean;
  dirty: boolean;
}

const docs = new Map<string, Doc>();
let order: string[] = [];
let activeId: string | null = null;
const replacing = new Set<string>();
let lastReportedState = '';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const appEl = $('app');
const viewer = new Viewer();
let viewerReady: Promise<void> | null = null;
let startupDone: () => void;
const started = new Promise<void>((r) => (startupDone = r));

const AUTHOR_KEY = 'bentopdf-desktop-author';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ------------------------------------------------------------------ UI bits

function toast(message: string, error = false): void {
  const el = document.createElement('div');
  el.className = error ? 'toast error' : 'toast';
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), error ? 7000 : 3500);
  if (error) native.log('error', message);
}

let busyCount = 0;
function busy(message: string | null): void {
  busyCount = Math.max(0, busyCount + (message ? 1 : -1));
  if (message) $('busy-text').textContent = message;
  $('busy').hidden = busyCount === 0;
}

interface ModalButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

function modal(
  title: string,
  body: Node | string,
  buttons: ModalButton[]
): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('modal');
  $('modal-title').textContent = title;
  const bodyEl = $('modal-body');
  bodyEl.textContent = '';
  if (typeof body === 'string') {
    const p = document.createElement('p');
    p.textContent = body;
    bodyEl.appendChild(p);
  } else {
    bodyEl.appendChild(body);
  }
  const actions = $('modal-actions');
  actions.textContent = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `btn${b.primary ? ' btn-primary' : ''}${b.danger ? ' btn-danger' : ''}`;
    btn.value = b.value;
    btn.textContent = b.label;
    actions.appendChild(btn);
    if (b.primary) setTimeout(() => btn.focus(), 0);
  }
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () =>
        resolve(
          dialog.returnValue && dialog.returnValue !== 'cancel'
            ? dialog.returnValue
            : null
        ),
      { once: true }
    );
    dialog.returnValue = '';
    dialog.showModal();
  });
}

async function confirmDialog(
  title: string,
  message: string,
  ok: string
): Promise<boolean> {
  const r = await modal(title, message, [
    { label: t('cancel'), value: 'cancel' },
    { label: ok, value: 'ok', primary: true },
  ]);
  return r === 'ok';
}

function alertDialog(title: string, message: string): void {
  void modal(title, message, [{ label: t('ok'), value: 'ok', primary: true }]);
}

// ------------------------------------------------------------------- viewer

function viewerLocale(lang: string): string {
  const l = lang.toLowerCase();
  if (l.startsWith('zh')) return 'zh-CN';
  for (const code of ['ja', 'de', 'fr', 'es', 'nl', 'sv'])
    if (l.startsWith(code)) return code;
  return 'en';
}

function authorName(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || 'BentoPDF';
  } catch {
    return 'BentoPDF';
  }
}

function ensureViewer(): Promise<void> {
  if (!viewerReady) {
    viewerReady = (async () => {
      await viewer.init($('viewer'), {
        locale: viewerLocale(language()),
        author: authorName(),
        callbacks: {
          opened: () => {},
          closed: (id) => {
            // Closed from the viewer's own UI.
            if (replacing.has(id) || !docs.has(id)) return;
            docs.delete(id);
            order = order.filter((x) => x !== id);
            render();
          },
          activeChanged: (id) => {
            activeId = id && docs.has(id) ? id : activeId;
            render();
          },
          modified: (id) => {
            const d = docs.get(id);
            if (d && !d.dirty) {
              d.dirty = true;
              render();
            }
          },
          failed: (id, message) => {
            native.log('warn', `viewer failed to load ${id}: ${message}`);
          },
        },
      });
      viewer.overrideCommand('document:open', () => void openWithDialog());
      viewer.overrideCommand('document:export', () => void saveActive(true));
      viewer.overrideCommand('document:print', () => void printActive());
      viewer.overrideCommand('document:close', () => {
        if (activeId) void closeDoc(activeId);
      });
    })().catch((err) => {
      viewerReady = null;
      native.log('error', `viewer init failed: ${errorText(err)}`);
      throw err;
    });
  }
  return viewerReady;
}

// --------------------------------------------------------------- rendering

function render(): void {
  order = order.filter((id) => docs.has(id));
  if (activeId && !docs.has(activeId))
    activeId = order[order.length - 1] ?? null;
  if (!activeId && order.length) activeId = order[0];
  if (activeId && viewer.activeId() !== activeId) viewer.activate(activeId);

  appEl.dataset.state = order.length ? 'viewer' : 'welcome';
  renderTabs();

  const active = activeId ? docs.get(activeId) : null;
  const title = active ? active.name : 'BentoPDF';
  document.title = title;
  if (isTauri)
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {});

  const anyDirty = [...docs.values()].some((d) => d.dirty);
  const edited = anyDirty || sheet.isOpen;
  const key = `${edited}|${active?.path ?? ''}`;
  if (key !== lastReportedState) {
    lastReportedState = key;
    void native.setDocumentState(edited, active?.path ?? null).catch(() => {});
  }
  if (!order.length) void renderRecent();
}

function renderTabs(): void {
  const nav = $('tabs');
  nav.textContent = '';
  for (const id of order) {
    const d = docs.get(id)!;
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === activeId));
    tab.dataset.dirty = String(d.dirty);
    tab.title = d.path ?? d.name;

    const icon = document.createElement('i');
    icon.className = 'ph ph-file-pdf tab-icon';
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = d.name;
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = t('close');
    close.innerHTML = '<i class="ph ph-x"></i><span class="dot"></span>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      void closeDoc(id);
    });
    tab.addEventListener('mousedown', (e) => {
      // Re-rendering here would replace the close button before its click lands.
      if ((e.target as Element).closest('.tab-close')) return;
      if (e.button === 0 && id !== activeId) {
        activeId = id;
        render();
      }
    });
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) void closeDoc(id);
    });
    tab.append(icon, name, close);
    nav.appendChild(tab);
  }
  ($('btn-save') as HTMLButtonElement).disabled = !activeId;
}

async function renderRecent(): Promise<void> {
  const files = await native.recentFiles().catch(() => [] as FileRef[]);
  const list = $('recent-list');
  list.textContent = '';
  $('recent').hidden = files.length === 0;
  for (const f of files.slice(0, 10)) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'recent-item';
    btn.title = f.path;
    const icon = document.createElement('i');
    icon.className = 'ph ph-file-pdf';
    const text = document.createElement('span');
    text.className = 'recent-text';
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = f.name;
    const path = document.createElement('span');
    path.className = 'recent-path';
    path.textContent = (dirname(f.path) ?? '').replace(/^\/Users\/[^/]+/, '~');
    text.append(name, path);
    btn.append(icon, text);
    btn.addEventListener('click', async () => {
      try {
        const ref = await native.openRecent(f.path);
        await openRefs([ref]);
      } catch (e) {
        toast(t('openFailed', { name: f.name, error: errorText(e) }), true);
        void renderRecent();
      }
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

// --------------------------------------------------------------- documents

const isPdfName = (name: string) => /\.pdf$/i.test(name);

async function openRefs(refs: FileRef[]): Promise<void> {
  if (!refs.length) return;
  await ensureViewer();
  for (const ref of refs) {
    if (!isPdfName(ref.name)) {
      toast(t('notPdf', { name: ref.name }), true);
      continue;
    }
    const existing = [...docs.values()].find((d) => d.path === ref.path);
    if (existing) {
      activeId = existing.id;
      continue;
    }
    busy(t('loading'));
    try {
      const bytes = await native.readFile(ref.path);
      const id = await viewer.open(bytes, ref.name, true);
      docs.set(id, {
        id,
        name: ref.name,
        path: ref.path,
        writable: ref.writable,
        dirty: false,
      });
      order.push(id);
      activeId = id;
      native.log('info', `opened ${ref.name} (${bytes.length} bytes)`);
    } catch (e) {
      toast(t('openFailed', { name: ref.name, error: errorText(e) }), true);
    } finally {
      busy(null);
    }
  }
  render();
}

async function openWithDialog(): Promise<void> {
  const refs = await native.openDialog(true);
  await openRefs(refs);
}

async function openBytes(bytes: Uint8Array, name: string): Promise<void> {
  await ensureViewer();
  const fileName = isPdfName(name) ? name : `${name}.pdf`;
  const id = await viewer.open(bytes, fileName, true);
  docs.set(id, {
    id,
    name: fileName,
    path: null,
    writable: false,
    dirty: true,
  });
  order.push(id);
  activeId = id;
  render();
}

/** Swaps a document's content (after a tool or page operation), keeping its tab and file. */
async function replaceDocument(
  id: string,
  bytes: Uint8Array,
  page?: number
): Promise<void> {
  const doc = docs.get(id);
  if (!doc) {
    await openBytes(bytes, t('untitled'));
    return;
  }
  const targetPage = page ?? viewer.currentPage(id);
  const index = order.indexOf(id);
  replacing.add(id);
  try {
    const newId = await viewer.open(bytes, doc.name, true);
    viewer.move(newId, index);
    await viewer.close(id);
    docs.delete(id);
    docs.set(newId, { ...doc, id: newId, dirty: true });
    order[index] = newId;
    activeId = newId;
    render();
    const go = () =>
      viewer.goToPage(
        newId,
        Math.min(Math.max(targetPage, 1), viewer.pageCount(newId) || 1)
      );
    setTimeout(go, 120);
    setTimeout(go, 500);
  } finally {
    replacing.delete(id);
  }
}

function suggestedName(doc: Doc): string {
  return isPdfName(doc.name) ? doc.name : `${doc.name}.pdf`;
}

async function saveDoc(id: string, saveAs = false): Promise<boolean> {
  const doc = docs.get(id);
  if (!doc) return false;
  await ensureViewer();
  let bytes: Uint8Array | null;
  try {
    bytes = await viewer.exportForSave(id, {
      confirm: confirmDialog,
      showAlert: alertDialog,
      showLoader: (m) => busy(m),
      hideLoader: () => busy(null),
      applyLabel: t('applyAndSave'),
    });
  } catch (e) {
    alertDialog(t('confirmTitle'), t('saveFailed', { error: errorText(e) }));
    return false;
  }
  if (!bytes) return false;

  let target = !saveAs && doc.path && doc.writable ? doc.path : null;
  if (!target) {
    const picked = await native.saveDialog(
      suggestedName(doc),
      dirname(doc.path)
    );
    if (!picked) return false;
    target = picked.path;
  }
  busy(t('saving'));
  try {
    const written = await native.writeFile(target, bytes);
    Object.assign(doc, {
      path: written.path,
      name: written.name,
      writable: true,
      dirty: false,
    });
    render();
    toast(t('saved', { name: doc.name }));
    return true;
  } catch (e) {
    alertDialog(t('confirmTitle'), t('saveFailed', { error: errorText(e) }));
    return false;
  } finally {
    busy(null);
  }
}

async function saveActive(saveAs = false): Promise<void> {
  if (!activeId) return toast(t('needDoc'));
  await saveDoc(activeId, saveAs);
}

/** Closes a tab. Resolves false if the user cancelled. */
async function closeDoc(id: string): Promise<boolean> {
  const doc = docs.get(id);
  if (!doc) return true;
  if (doc.dirty) {
    activeId = id;
    render();
    if (promptOpen) return false;
    const answer = await askUnsavedOnce([doc.name]);
    if (answer === 'cancel') return false;
    if (answer === 'save' && !(await saveDoc(id))) return false;
  }
  docs.delete(id);
  const index = order.indexOf(id);
  order = order.filter((x) => x !== id);
  if (activeId === id)
    activeId = order[Math.min(index, order.length - 1)] ?? null;
  await viewer.close(id);
  render();
  return true;
}

/** True while a save-changes prompt is on screen. */
let promptOpen = false;

async function askUnsavedOnce(
  names: string[]
): Promise<'save' | 'discard' | 'cancel'> {
  promptOpen = true;
  try {
    return await native.askUnsaved(names);
  } finally {
    promptOpen = false;
  }
}

/** Rust asks before closing a window that reported unsaved state. */
async function handleCloseRequest(): Promise<void> {
  // A second close/quit request while a prompt is showing would stack a
  // second prompt; cancel it instead and let the open prompt decide.
  if (promptOpen) return native.closeWindow(false);
  if (sheet.isOpen && !(await sheet.close())) return native.closeWindow(false);
  const dirty = order.map((id) => docs.get(id)!).filter((d) => d.dirty);
  if (!dirty.length) return native.closeWindow(true);
  if (dirty.length === 1) {
    activeId = dirty[0].id;
    render();
  }
  const answer = await askUnsavedOnce(dirty.map((d) => d.name));
  if (answer === 'cancel') return native.closeWindow(false);
  if (answer === 'save') {
    for (const d of dirty) {
      activeId = d.id;
      render();
      if (!(await saveDoc(d.id))) return native.closeWindow(false);
    }
  }
  await native.closeWindow(true);
}

// ----------------------------------------------------------- page commands

type PageOp =
  | 'insert-blank'
  | 'insert-file'
  | 'delete'
  | 'rotate-left'
  | 'rotate-right';

// Page operations replace the document, so they must not overlap: a second
// one started mid-way would work on the old copy and drop the first change.
let pageQueue: Promise<void> = Promise.resolve();

function pageOperation(op: PageOp): Promise<void> {
  const run = pageQueue.then(() => runPageOperation(op));
  pageQueue = run.catch(() => {});
  return run;
}

async function runPageOperation(op: PageOp): Promise<void> {
  const id = activeId;
  if (!id) return toast(t('needDoc'));
  await ensureViewer();
  if (viewer.pendingRedactions(id) > 0) {
    return alertDialog(t('confirmTitle'), t('pendingRedactions'));
  }
  const current = viewer.currentPage(id); // 1-based
  if (op === 'delete') {
    if (viewer.pageCount(id) <= 1)
      return alertDialog(t('confirmTitle'), t('cannotDeleteLast'));
    const ok = await confirmDialog(
      t('confirmTitle'),
      t('confirmDeletePage', { n: current }),
      t('delete')
    );
    if (!ok) return;
  }
  let other: Uint8Array | null = null;
  if (op === 'insert-file') {
    const refs = await native.openDialog(true);
    if (!refs.length) return;
    other = await native.readFile(refs[0].path);
  }
  busy(t('applying'));
  try {
    const bytes = await viewer.rawBytes(id);
    let out: Uint8Array;
    let message: string;
    let page = current;
    switch (op) {
      case 'insert-blank':
        out = await pages.insertBlankPage(bytes, current - 1);
        message = t('pageInserted');
        page = current + 1;
        break;
      case 'delete':
        out = await pages.deletePage(bytes, current - 1);
        message = t('pageDeleted', { n: current });
        page = Math.max(1, current - 1);
        break;
      case 'rotate-left':
      case 'rotate-right':
        out = await pages.rotatePage(
          bytes,
          current - 1,
          op === 'rotate-left' ? -90 : 90
        );
        message = t('pageRotated', { n: current });
        break;
      case 'insert-file': {
        const r = await pages.insertPdf(bytes, other!, current - 1);
        out = r.bytes;
        message = t('pagesInserted', { count: r.added });
        page = current + 1;
        break;
      }
    }
    await replaceDocument(id, out, page);
    toast(message);
  } catch (e) {
    if (e instanceof pages.PageOpError && e.message === 'last-page') {
      alertDialog(t('confirmTitle'), t('cannotDeleteLast'));
    } else {
      toast(errorText(e), true);
    }
  } finally {
    busy(null);
  }
}

async function printActive(): Promise<void> {
  const id = activeId;
  if (!id) return toast(t('needDoc'));
  if (!isTauri) return viewer.exec('document:print');
  busy(t('printing'));
  let bytes: Uint8Array;
  try {
    bytes = await viewer.rawBytes(id);
  } finally {
    busy(null);
  }
  try {
    await native.printPdf(bytes, docs.get(id)?.name ?? 'BentoPDF');
  } catch (e) {
    toast(errorText(e), true);
  }
}

async function goToPageDialog(): Promise<void> {
  const id = activeId;
  if (!id) return;
  const max = viewer.pageCount(id);
  const wrap = document.createElement('div');
  const label = document.createElement('p');
  label.textContent = t('pageNumber', { max });
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = String(max);
  input.value = String(viewer.currentPage(id));
  input.name = 'page';
  wrap.append(label, input);
  setTimeout(() => input.select(), 0);
  const r = await modal(t('goToPage'), wrap, [
    { label: t('cancel'), value: 'cancel' },
    { label: t('go'), value: 'go', primary: true },
  ]);
  const n = Number(input.value);
  if (r === 'go' && n >= 1 && n <= max) viewer.goToPage(id, n);
}

async function showProperties(): Promise<void> {
  const id = activeId;
  const doc = id ? docs.get(id) : null;
  if (!id || !doc) return;
  const bytes = await viewer.rawBytes(id);
  const info: pages.DocInfo | null = await pages
    .readInfo(bytes)
    .catch((): null => null);
  const dl = document.createElement('dl');
  const row = (k: string, v: string | undefined) => {
    if (!v) return;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  };
  const date = (d?: Date) =>
    d && !isNaN(d.getTime()) ? d.toLocaleString(language()) : undefined;
  row(t('file'), doc.name);
  row(t('location'), doc.path ? dirname(doc.path) : t('notSaved'));
  row(t('size'), formatSize(bytes.length));
  row(t('pages'), String(info?.pages ?? viewer.pageCount(id)));
  row(t('pdfVersion'), info?.version);
  row(t('title'), info?.title);
  row(t('author'), info?.author);
  row(t('producer'), info?.producer);
  row(t('created'), date(info?.created));
  row(t('modified'), date(info?.modified));
  await modal(t('properties'), dl, [
    { label: t('ok'), value: 'ok', primary: true },
  ]);
}

async function showSettings(): Promise<void> {
  const wrap = document.createElement('div');
  const label = document.createElement('p');
  label.textContent = t('author_name');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search';
  input.value = authorName();
  wrap.append(label, input);
  const r = await modal(t('settings'), wrap, [
    { label: t('cancel'), value: 'cancel' },
    { label: t('ok'), value: 'ok', primary: true },
  ]);
  if (r !== 'ok') return;
  const name = input.value.trim() || 'BentoPDF';
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    /* not persisted */
  }
  try {
    const annot = viewer.registry
      ?.getPlugin('annotation')
      ?.provides() as unknown as {
      setAnnotationAuthor?: (n: string) => void;
    };
    annot?.setAnnotationAuthor?.(name);
  } catch {
    /* applies on next launch */
  }
}

async function showLicenses(): Promise<void> {
  const info = await native.appInfo();
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = t('licenseText');
  const dl = document.createElement('dl');
  const link = (label: string, url: string) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void native.openExternal(url);
    });
    dd.appendChild(a);
    dl.append(dt, dd);
  };
  link(t('sourceCode'), info.sourceUrl);
  link(t('upstream'), info.upstreamUrl);
  if (info.logPath) {
    const dt = document.createElement('dt');
    dt.textContent = t('openLog');
    const dd = document.createElement('dd');
    dd.textContent = info.logPath;
    dl.append(dt, dd);
  }
  const comps = document.createElement('p');
  comps.style.marginTop = '12px';
  comps.textContent = `${t('components')} — v${info.version}`;
  wrap.append(p, dl, comps);
  await modal(t('licenses'), wrap, [
    { label: t('ok'), value: 'ok', primary: true },
  ]);
}

const SHORTCUTS: [string, string][] = [
  ['⌘O', 'file:open'],
  ['⌘S', 'file:save'],
  ['⇧⌘S', 'file:save-as'],
  ['⌘W', 'file:close-tab'],
  ['⌘P', 'file:print'],
  ['⌘F', 'edit:find'],
  ['⌘Z / ⇧⌘Z', 'edit:undo'],
  ['⌘= / ⌘- / ⌘0', 'view:zoom'],
  ['⌘1 / ⌘2', 'view:fit'],
  ['⌥⌘S', 'view:sidebar'],
  ['⌥⌘↑ / ⌥⌘↓', 'view:page'],
  ['⌥⌘G', 'view:go-to-page'],
  ['⌃⇥ / ⌃⇧⇥', 'view:tab'],
  ['⌃⌘H / ⌃⌘U / ⌃⌘K', 'annot:markup'],
  ['⌃⌘T / ⌃⌘N / ⌃⌘I', 'annot:add'],
  ['⌘E', 'doc:edit-content'],
  ['⌥⌘O', 'doc:organize'],
  ['⌘L / ⌘R', 'doc:rotate'],
  ['⇧⌘N', 'doc:insert-blank'],
  ['⇧⌘T', 'doc:all-tools'],
  ['⌘I', 'doc:properties'],
];

const SHORTCUT_LABELS: Record<string, [string, string]> = {
  'file:open': ['開く', 'Open'],
  'file:save': ['保存', 'Save'],
  'file:save-as': ['別名で保存', 'Save As'],
  'file:close-tab': ['タブを閉じる', 'Close Tab'],
  'file:print': ['プリント', 'Print'],
  'edit:find': ['検索', 'Find'],
  'edit:undo': ['取り消す / やり直す', 'Undo / Redo'],
  'view:zoom': ['拡大 / 縮小 / 実際のサイズ', 'Zoom In / Out / Actual Size'],
  'view:fit': ['幅に合わせる / ページ全体', 'Fit Width / Fit Page'],
  'view:sidebar': ['サムネール', 'Thumbnails'],
  'view:page': ['前 / 次のページ', 'Previous / Next Page'],
  'view:go-to-page': ['ページへ移動', 'Go to Page'],
  'view:tab': ['次 / 前のタブ', 'Next / Previous Tab'],
  'annot:markup': [
    'ハイライト / 下線 / 取り消し線',
    'Highlight / Underline / Strikethrough',
  ],
  'annot:add': ['テキスト / コメント / ペン', 'Text / Comment / Pen'],
  'doc:edit-content': ['テキストと画像を編集', 'Edit Text and Images'],
  'doc:organize': ['ページを整理', 'Organize Pages'],
  'doc:rotate': ['ページを左 / 右に回転', 'Rotate Page Left / Right'],
  'doc:insert-blank': ['空白ページを挿入', 'Insert Blank Page'],
  'doc:all-tools': ['すべてのツール', 'All Tools'],
  'doc:properties': ['文書のプロパティ', 'Document Properties'],
};

async function showShortcuts(): Promise<void> {
  const table = document.createElement('table');
  const ja = language() === 'ja';
  for (const [keys, id] of SHORTCUTS) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = SHORTCUT_LABELS[id]?.[ja ? 0 : 1] ?? id;
    const b = document.createElement('td');
    b.textContent = keys;
    tr.append(a, b);
    table.appendChild(tr);
  }
  await modal(t('shortcuts'), table, [
    { label: t('ok'), value: 'ok', primary: true },
  ]);
}

// -------------------------------------------------------------------- tools

const toolPanel = new ToolPanel((tool) => void openTool(tool));
const sheet = new ToolSheet({
  activeDocument: () => {
    const d = activeId ? docs.get(activeId) : null;
    return d ? { id: d.id, name: d.name } : null;
  },
  documentFile: async (id) => {
    const d = docs.get(id)!;
    const bytes = await viewer.rawBytes(id);
    return new File([bytes as BlobPart], suggestedName(d), {
      type: 'application/pdf',
    });
  },
  replaceDocument: (id, bytes) => replaceDocument(id, bytes),
  openBytes,
  saveBytes: async (bytes, name) => {
    const active = activeId ? docs.get(activeId) : null;
    const picked = await native.saveDialog(name, dirname(active?.path));
    if (!picked) return false;
    try {
      await native.writeFile(picked.path, bytes);
      return true;
    } catch (e) {
      alertDialog(t('confirmTitle'), t('saveFailed', { error: errorText(e) }));
      return false;
    }
  },
  toast,
  confirm: confirmDialog,
  sheetChanged: () => render(),
});

async function openTool(tool: ToolDef): Promise<void> {
  toolPanel.hide();
  if (tool.usesDocument && !activeId && tool.autoApply) {
    toast(t('needDoc'));
    return;
  }
  busy(t('preparing'));
  try {
    await sheet.open(tool);
  } catch (e) {
    toast(errorText(e), true);
  } finally {
    busy(null);
  }
}

async function openToolById(id: string): Promise<void> {
  const { byId } = await loadCatalog();
  const tool = byId.get(id);
  if (tool) await openTool(tool);
}

// --------------------------------------------------------------------- menu

const VIEWER_COMMANDS: Record<string, string> = {
  'edit:find': 'panel:toggle-search',
  'edit:delete-selected': 'annotation:delete-selected',
  'view:zoom-in': 'zoom:in',
  'view:zoom-out': 'zoom:out',
  'view:actual-size': 'zoom:100',
  'view:fit-width': 'zoom:fit-width',
  'view:fit-page': 'zoom:fit-page',
  'view:sidebar': 'panel:toggle-sidebar',
  'view:prev-page': 'scroll:previous-page',
  'view:next-page': 'scroll:next-page',
  'annot:select': 'mode:view',
  'annot:highlight': 'annotation:add-highlight',
  'annot:underline': 'annotation:add-underline',
  'annot:strikeout': 'annotation:add-strikeout',
  'annot:text': 'annotation:add-text',
  'annot:comment': 'annotation:add-comment',
  'annot:ink': 'annotation:add-ink',
  'annot:rectangle': 'annotation:add-rectangle',
  'annot:circle': 'annotation:add-circle',
  'annot:arrow': 'annotation:add-arrow',
  'annot:stamp': 'annotation:add-stamp',
  'annot:redact': 'redaction:redact',
};

const ANNOTATION_MODES: Record<string, string> = {
  'annot:highlight': 'mode:annotate',
  'annot:underline': 'mode:annotate',
  'annot:strikeout': 'mode:annotate',
  'annot:text': 'mode:annotate',
  'annot:comment': 'mode:annotate',
  'annot:ink': 'mode:annotate',
  'annot:stamp': 'mode:annotate',
  'annot:rectangle': 'mode:shapes',
  'annot:circle': 'mode:shapes',
  'annot:arrow': 'mode:shapes',
  'annot:redact': 'mode:redact',
};

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement)
    return !['button', 'checkbox', 'radio', 'range', 'file'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/** Focused element, looking inside the viewer's shadow DOM. */
function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function cycleTab(step: number): void {
  if (order.length < 2 || !activeId) return;
  const i = order.indexOf(activeId);
  activeId = order[(i + step + order.length) % order.length];
  render();
}

async function onMenu(id: string): Promise<void> {
  await started;
  native.log('debug', `menu ${id}`);
  if (id === 'edit:undo' || id === 'edit:redo') {
    const redo = id === 'edit:redo';
    if (sheet.isOpen) {
      sheet.forwardKey({
        key: 'z',
        code: 'KeyZ',
        metaKey: true,
        shiftKey: redo,
      });
    } else if (isTextField(deepActiveElement())) {
      document.execCommand(redo ? 'redo' : 'undo');
    } else {
      viewer.exec(redo ? 'history:redo' : 'history:undo');
    }
    return;
  }
  if (sheet.isOpen && id === 'file:close-tab') {
    await sheet.close();
    return;
  }
  if (id.startsWith('tool:')) return openToolById(id.slice(5));
  const cmd = VIEWER_COMMANDS[id];
  if (cmd) {
    if (!activeId) return toast(t('needDoc'));
    if (sheet.isOpen) await sheet.close();
    // Annotation tools live in the viewer's annotate/shapes/redact modes;
    // switch first so the matching toolbar is visible.
    const mode = ANNOTATION_MODES[id];
    if (mode) viewer.exec(mode);
    viewer.exec(cmd);
    return;
  }
  switch (id) {
    case 'file:open':
      return openWithDialog();
    case 'file:close-tab':
      if (activeId) await closeDoc(activeId);
      else if (isTauri) await getCurrentWindow().close();
      return;
    case 'file:close-window':
      if (isTauri) await getCurrentWindow().close();
      return;
    case 'file:save':
      return saveActive(false);
    case 'file:save-as':
      return saveActive(true);
    case 'file:print':
      return printActive();
    case 'view:go-to-page':
      return goToPageDialog();
    case 'view:next-tab':
      return cycleTab(1);
    case 'view:prev-tab':
      return cycleTab(-1);
    case 'doc:edit-content':
      return openToolById('edit-pdf-text');
    case 'doc:organize':
      return openToolById('pdf-multi-tool');
    case 'doc:insert-blank':
      return pageOperation('insert-blank');
    case 'doc:insert-file':
      return pageOperation('insert-file');
    case 'doc:delete-page':
      return pageOperation('delete');
    case 'doc:rotate-left':
      return pageOperation('rotate-left');
    case 'doc:rotate-right':
      return pageOperation('rotate-right');
    case 'doc:all-tools':
      return toolPanel.show(true, '');
    case 'doc:properties':
      return showProperties();
    case 'app:settings':
      return showSettings();
    case 'app:licenses':
      return showLicenses();
    case 'help:shortcuts':
      return showShortcuts();
  }
}

// ------------------------------------------------------------- drag & drop

async function onFilesDropped(refs: FileRef[]): Promise<void> {
  if (sheet.isOpen) {
    const files = await Promise.all(
      refs.map(
        async (r) =>
          new File([(await native.readFile(r.path)) as BlobPart], r.name, {
            type: isPdfName(r.name) ? 'application/pdf' : '',
          })
      )
    );
    if (sheet.addFiles(files)) return;
  }
  await openRefs(refs);
}

function wireDragOverlay(): void {
  if (!isTauri) return;
  const overlay = $('drop-overlay');
  void getCurrentWebview().onDragDropEvent((e) => {
    const type = e.payload.type;
    overlay.hidden = !(type === 'enter' || type === 'over');
  });
}

// ------------------------------------------------------------------ startup

function bentoLanguage(lang: string): string {
  const lower = lang.toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(lower)) return 'zh-TW';
  const primary = lower.split('-')[0];
  return (supportedLanguages as readonly string[]).includes(primary)
    ? primary
    : 'en';
}

function wireUi(): void {
  $('btn-open').addEventListener('click', () => void openWithDialog());
  $('welcome-open').addEventListener('click', () => void openWithDialog());
  $('welcome-create').addEventListener(
    'click',
    () => void toolPanel.show(true, 'PDF')
  );
  $('btn-save').addEventListener('click', () => void saveActive(false));
  $('recent-clear').addEventListener('click', async () => {
    await native.clearRecent();
    void renderRecent();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($<HTMLDialogElement>('modal').open) return;
    if (toolPanel.visible) toolPanel.hide();
  });
  // Links in the app window open in the default browser.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="http"]');
    if (a instanceof HTMLAnchorElement) {
      e.preventDefault();
      void native.openExternal(a.href);
    }
  });
  window.addEventListener('focus', () => {
    if (!order.length) void renderRecent();
  });
  if (isTauri) {
    const win = getCurrentWindow();
    const syncFullscreen = async () => {
      document.documentElement.classList.toggle(
        'fullscreen',
        await win.isFullscreen()
      );
    };
    void win.onResized(() => void syncFullscreen());
    void syncFullscreen();
  }
  wireDragOverlay();
}

async function start(): Promise<void> {
  setLanguage(navigator.language);
  // Listen before announcing readiness so no file event is missed.
  await native.on<FileRef[]>(
    'open-files',
    (refs) => void started.then(() => openRefs(refs))
  );
  await native.on<FileRef[]>(
    'files-dropped',
    (refs) => void started.then(() => onFilesDropped(refs))
  );
  await native.on<string>('menu', (id) => void onMenu(id));
  await native.on<{ quitting: boolean }>(
    'close-requested',
    () => void started.then(handleCloseRequest)
  );

  const info = await native.ready();
  setLanguage(info.lang);
  try {
    localStorage.setItem('bentopdf-language', bentoLanguage(info.lang));
  } catch {
    /* tool pages fall back to the browser language */
  }
  applyStaticText();
  wireUi();
  render();
  void ensureViewer().catch((e) => toast(errorText(e), true));
  void loadCatalog();
  startupDone();
  native.log('info', `window ready (${info.files.length} file(s) queued)`);

  if (info.files.length) await openRefs(info.files);
  for (const m of info.menu) await onMenu(m);
}

window.addEventListener('error', (e) =>
  native.log('error', `${e.message} @ ${e.filename}:${e.lineno}`)
);
window.addEventListener('unhandledrejection', (e) =>
  native.log('error', `unhandled: ${errorText(e.reason)}`)
);

void start();
