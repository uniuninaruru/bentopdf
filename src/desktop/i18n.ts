// Strings for the desktop window chrome. Tool pages use BentoPDF's own i18n.

const ja = {
  open: '開く (⌘O)',
  save: '保存 (⌘S)',
  tools: 'ツール',
  close: '閉じる',
  welcomeSub: 'PDF の閲覧・注釈・編集・整理をオフラインで',
  openPdf: 'PDF を開く…',
  createPdf: '画像・Office から PDF を作成…',
  dropHint: 'PDF をウインドウにドラッグ＆ドロップしても開けます',
  dropToOpen: 'ドロップして開く',
  recent: '最近使った項目',
  clear: '消去',
  searchTools: 'ツールを検索',
  noTools: '一致するツールがありません',
  untitled: '名称未設定.pdf',
  saved: '保存しました: {name}',
  saveFailed: '保存できませんでした: {error}',
  openFailed: '「{name}」を開けませんでした: {error}',
  notPdf: '「{name}」は PDF ではないため開けません',
  loading: '読み込み中…',
  saving: '保存中…',
  applying: '適用中…',
  preparing: '準備中…',
  needDoc: '先に PDF を開いてください',
  applyAndSave: '適用して保存',
  cancel: 'キャンセル',
  ok: 'OK',
  replaceDoc: 'この文書に適用',
  openAsNew: '新しいタブで開く',
  saveToFile: 'ファイルに保存…',
  resultReady: '結果: {name} ({size})',
  resultApplied: '「{tool}」の結果を適用しました。⌘S で保存できます',
  resultSaved: '保存しました: {name}',
  resultOpened: '新しいタブで開きました: {name}',
  toolUnsaved: 'このツールには未適用の作業があります。閉じてもよろしいですか?',
  closeAnyway: '閉じる',
  pendingRedactions:
    '未適用の墨消しがあります。ページ操作の前に適用するか、取り消してください。',
  pageInserted: '空白ページを挿入しました',
  pageDeleted: 'ページ {n} を削除しました',
  pageRotated: 'ページ {n} を回転しました',
  pagesInserted: '{count} ページを挿入しました',
  cannotDeleteLast: '最後の 1 ページは削除できません',
  confirmDeletePage: 'ページ {n} を削除しますか? この操作は取り消せません。',
  delete: '削除',
  goToPage: 'ページへ移動',
  pageNumber: 'ページ番号 (1–{max})',
  go: '移動',
  properties: '文書のプロパティ',
  file: 'ファイル',
  location: '場所',
  size: 'サイズ',
  pages: 'ページ数',
  title: 'タイトル',
  author: '作成者',
  producer: 'PDF 作成',
  created: '作成日',
  modified: '更新日',
  pdfVersion: 'PDF バージョン',
  notSaved: '（未保存）',
  shortcuts: 'キーボードショートカット',
  licenses: 'ライセンスとソースコード',
  licenseText:
    'BentoPDF は AGPL-3.0 の下で配布されているフリーソフトウェアです。このアプリはその派生物で、同じく AGPL-3.0 で配布されます。対応するソースコードは下記から入手できます。',
  sourceCode: 'ソースコード',
  upstream: '元のプロジェクト',
  components:
    '同梱コンポーネント: PDFium / EmbedPDF (MIT) / PyMuPDF, Ghostscript, CoherentPDF (AGPL-3.0) / Tesseract.js (Apache-2.0) / Noto フォント (OFL-1.1) ほか',
  settings: '設定',
  author_name: '注釈の作成者名',
  openLog: 'ログの場所',
  confirmTitle: '確認',
  toolCategoryEdit: '編集',
  toolCategoryPages: 'ページ',
  toolCategoryOptimize: '最適化・変換',
  toolCategoryCombine: '結合・分割',
  toolCategorySecurity: '署名・セキュリティ',
  toolCategoryCreate: 'PDF を作成',
  toolCategoryAll: 'すべてのツール',
  editContent: 'テキストと画像を編集',
  editContentSub: '既存の文字・画像・図形を直接編集',
  organize: 'ページを整理',
  organizeSub: '並べ替え・削除・回転・挿入',
  dirtyClose: '未保存',
  printing: 'プリントを準備中…',
  reloadedAfterCrash: '表示エンジンを再起動しました',
};

type Key = keyof typeof ja;

const en: Record<Key, string> = {
  open: 'Open (⌘O)',
  save: 'Save (⌘S)',
  tools: 'Tools',
  close: 'Close',
  welcomeSub: 'View, annotate, edit and organize PDFs — offline',
  openPdf: 'Open PDF…',
  createPdf: 'Create PDF from Images or Office…',
  dropHint: 'You can also drag PDFs onto this window',
  dropToOpen: 'Drop to open',
  recent: 'Recent',
  clear: 'Clear',
  searchTools: 'Search tools',
  noTools: 'No matching tools',
  untitled: 'Untitled.pdf',
  saved: 'Saved: {name}',
  saveFailed: 'Could not save: {error}',
  openFailed: 'Could not open “{name}”: {error}',
  notPdf: '“{name}” is not a PDF',
  loading: 'Loading…',
  saving: 'Saving…',
  applying: 'Applying…',
  preparing: 'Preparing…',
  needDoc: 'Open a PDF first',
  applyAndSave: 'Apply and Save',
  cancel: 'Cancel',
  ok: 'OK',
  replaceDoc: 'Apply to This Document',
  openAsNew: 'Open in New Tab',
  saveToFile: 'Save to File…',
  resultReady: 'Result: {name} ({size})',
  resultApplied: 'Applied “{tool}”. Press ⌘S to save.',
  resultSaved: 'Saved: {name}',
  resultOpened: 'Opened in a new tab: {name}',
  toolUnsaved: 'This tool has work that has not been applied. Close it anyway?',
  closeAnyway: 'Close',
  pendingRedactions:
    'There are redaction marks that have not been applied. Apply or remove them before changing pages.',
  pageInserted: 'Inserted a blank page',
  pageDeleted: 'Deleted page {n}',
  pageRotated: 'Rotated page {n}',
  pagesInserted: 'Inserted {count} page(s)',
  cannotDeleteLast: 'The last page cannot be deleted',
  confirmDeletePage: 'Delete page {n}? This cannot be undone.',
  delete: 'Delete',
  goToPage: 'Go to Page',
  pageNumber: 'Page number (1–{max})',
  go: 'Go',
  properties: 'Document Properties',
  file: 'File',
  location: 'Location',
  size: 'Size',
  pages: 'Pages',
  title: 'Title',
  author: 'Author',
  producer: 'Producer',
  created: 'Created',
  modified: 'Modified',
  pdfVersion: 'PDF version',
  notSaved: '(not saved)',
  shortcuts: 'Keyboard Shortcuts',
  licenses: 'Licenses and Source Code',
  licenseText:
    'BentoPDF is free software released under the AGPL-3.0. This app is a derivative work and is also distributed under the AGPL-3.0. The corresponding source code is available below.',
  sourceCode: 'Source code',
  upstream: 'Original project',
  components:
    'Bundled components: PDFium / EmbedPDF (MIT), PyMuPDF, Ghostscript, CoherentPDF (AGPL-3.0), Tesseract.js (Apache-2.0), Noto fonts (OFL-1.1) and others',
  settings: 'Settings',
  author_name: 'Annotation author name',
  openLog: 'Log file',
  confirmTitle: 'Confirm',
  toolCategoryEdit: 'Edit',
  toolCategoryPages: 'Pages',
  toolCategoryOptimize: 'Optimize & Convert',
  toolCategoryCombine: 'Combine & Split',
  toolCategorySecurity: 'Sign & Secure',
  toolCategoryCreate: 'Create PDF',
  toolCategoryAll: 'All Tools',
  editContent: 'Edit Text and Images',
  editContentSub: 'Edit existing text, images and shapes in place',
  organize: 'Organize Pages',
  organizeSub: 'Reorder, delete, rotate, insert',
  dirtyClose: 'Unsaved',
  printing: 'Preparing to print…',
  reloadedAfterCrash: 'The rendering engine was restarted',
};

let current: Record<Key, string> = ja;
let langCode = 'ja';

export function setLanguage(lang: string): void {
  langCode = lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  current = langCode === 'ja' ? ja : en;
  document.documentElement.lang = langCode;
}

export function language(): string {
  return langCode;
}

export function t(key: Key, params?: Record<string, string | number>): string {
  let s = current[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params))
      s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export function applyStaticText(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
    el.setAttribute('aria-label', el.title);
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
