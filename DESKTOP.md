# BentoPDF for macOS（デスクトップ版）

BentoPDF を Tauri 2 で macOS ネイティブアプリにしたフォークです。Docker や Web サーバーは不要で、`.app` 単体で動きます。PDF エンジン・OCR・フォントはすべて同梱しているので、オフラインで使えます。

- 本家: https://github.com/alam00000/bentopdf
- このフォーク: https://github.com/uniuninaruru/bentopdf （ブランチ `macos-desktop`）
- ライセンス: AGPL-3.0-only（本家と同じ。下の「ライセンス」を参照）

## できること

| 機能                                         | 実装                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| PDF を開くとすぐ閲覧画面                     | 新規 `desktop.html`（本家の PDF Editor と同じ EmbedPDF/PDFium ビューア）         |
| 拡大・縮小、ページ移動、検索、サムネール     | 本家ビューアの機能 + ネイティブメニュー/ショートカット                           |
| ハイライト、注釈、テキスト追加、図形、墨消し | 本家ビューアの機能                                                               |
| 既存テキスト・画像・図形の編集               | 本家の「Edit PDF Text」(editcore) を現在の文書で開き、結果を自動で反映           |
| ページの追加・削除・回転                     | 新規（文書メニュー。pdf-lib で現在の文書に適用）                                 |
| ページの並べ替え・一括整理                   | 本家の「PDF Multi Tool」を現在の文書で開き、結果を自動で反映                     |
| OCR、結合、分割、圧縮ほか 100 以上のツール   | 本家のツールページを「ツール」パネルから開き、結果を文書に適用 / 新規タブ / 保存 |
| 保存・別名保存                               | 新規（ネイティブ保存パネル、元ファイルへの上書きはアトミック書き込み）           |
| 未保存の警告                                 | 新規（タブを閉じる・ウインドウを閉じる・⌘Q・Dock からの終了・ログアウト時）      |
| Finder から開く / 起動中に開く / 複数 PDF    | 新規（`.pdf` の関連付け、Apple Events、タブ、複数ウインドウ）                    |
| ドラッグ＆ドロップ                           | 新規（ウインドウへのドロップで開く。ツール表示中はツールへ渡す）                 |
| プリント                                     | 新規（macOS の PDFKit で標準プリントパネル）                                     |
| ダークモード                                 | システム設定に追従                                                               |
| 日本語                                       | UI・メニュー・ビューアを日本語化、日本語フォント（Noto CJK）同梱                 |

## ビルド

必要なもの: macOS 13 以降（Apple Silicon で確認）、Xcode Command Line Tools、Node.js 22 以降、Rust（rustup）。

```bash
npm ci
npm run desktop:assets      # オフライン用の WASM・OCR データ・フォントを取得（初回のみ、約 210MB）
npm run desktop:app         # リリース版 .app を作成
```

出力先: `src-tauri/target/release/bundle/macos/BentoPDF.app`

- `npm run tauri dev` で開発用ウインドウを起動できます（Vite の HMR が効きます）。
- `npm run build:desktop` はフロントエンドだけをビルドします（出力: `dist-desktop/`）。
- 動作確認用の日本語 PDF は `node scripts/desktop/make-test-pdfs.mjs` と `swift scripts/desktop/make-coretext-pdf.swift test/desktop/jp-coretext.pdf` で作れます。

### Finder でダブルクリックしたときに開くようにする

`.app` は PDF の「エディタ」として登録されます。既定のアプリにするには、Finder で PDF を選んで「情報を見る」→「このアプリケーションで開く」で BentoPDF を選び、「すべてを変更…」を押します（システム設定の変更になるため、アプリからは自動で変更しません）。

## 構成

```
desktop.html, src/desktop/      アプリのウインドウ（タブ、保存、メニュー、ツール連携）
  main.ts                       文書の開閉・保存・未保存確認・メニュー処理
  viewer.ts                     本家ビューア（EmbedPDF）のラッパー
  tools.ts                      ツールパネルとツール表示（同一オリジンの iframe）
  embed-bridge.ts               各ツールページに注入。文書を渡し、ダウンロードを横取りして返す
  pages.ts                      ページの挿入・削除・回転
src-tauri/                      Rust（Tauri 2）
  src/lib.rs                    ウインドウ、Apple Events、ドラッグ＆ドロップ、終了フロー、コマンド
  src/files.rs                  ファイルアクセスの許可管理（ユニットテストあり）
  src/menu.rs                   ネイティブメニュー（日本語/英語）
  src/macos.rs                  AppKit 連携（未保存マーク、PDFKit 印刷、終了要求の捕捉）
vite.desktop.config.ts          本家の vite.config.ts を読み込んで差分だけ当てるデスクトップ用設定
.env.desktop                    CDN の代わりに同梱資産を使う設定
scripts/desktop/                オフライン資産の取得、テスト PDF の作成
```

本家コードへの変更は最小限です。

- `src/js/logic/edit-pdf-export.ts`: PDF Editor の保存処理（墨消しの確定、FreeText の平坦化、フォント埋め込み、墨消し文字の除去）を共有モジュールに切り出し、Web 版とデスクトップ版で同じ処理を使う
- `src/js/config/tool-translation-keys.ts`: ツール名の翻訳キー表を `main.ts` から切り出し
- `src/js/utils/asset-url.ts`: ルート相対の資産 URL を絶対 URL にする（blob: ワーカー内で解決できないため）
- `src/js/i18n/i18n.ts`: デスクトップ版では URL ではなくシステム言語で表示言語を決める
- `src/js/utils/font-loader.ts`: かなを含む文章や日本語環境では、漢字にも日本語フォントを使う（中国語字形になるのを防ぐ）

## セキュリティとファイルアクセス

- fs プラグインは使っていません。WebView から読めるのは、ユーザーが Finder・開くパネル・ドラッグ＆ドロップ・最近使った項目で選んだファイルだけです。書き込めるのは、開いた PDF と保存パネルで選んだパスだけです。判定はすべて Rust 側で行います（`src-tauri/src/files.rs`）。
- 上書き保存は、同じフォルダの一時ファイルに書いて fsync してからリネームします（途中で落ちても元ファイルは壊れません）。
- アプリのコマンドは `build.rs` で宣言し、`capabilities/main.json` で許可したものだけが呼べます。
- CSP で外部スクリプトの読み込みを禁止しています。通信先は、本家のデジタル署名・タイムスタンプ機能が使う CORS プロキシだけを許可しています。それ以外の機能はオフラインで動きます。
- アプリ外へのリンクは既定のブラウザで開きます（WebView 内では開きません）。

## ライセンス

このアプリは AGPL-3.0-only の BentoPDF の派生物で、同じく AGPL-3.0-only です。配布するときは、対応するソースコード（このフォーク）を入手できるようにしてください。アプリ内の「BentoPDF」メニュー →「ライセンスとソースコード…」からもリンクしています。

同梱コンポーネントのライセンス:

- PDFium / bentopdf-pdfium、Hyper Compress、PyMuPDF、Ghostscript、CoherentPDF: AGPL-3.0
- EmbedPDF ビューア（bentopdf-viewer）: MIT
- Tesseract.js: Apache-2.0、言語データ: Apache-2.0
- Noto フォント: SIL Open Font License 1.1

`public/desktop-assets/README.txt` に同梱資産の一覧を書いています。

## 既知の制限

- 署名は ad-hoc（`-`）だけで、公証はしていません。ほかの Mac で開くと Gatekeeper の警告が出ます。
- アプリのサイズは約 300MB です（PyMuPDF・LibreOffice・Ghostscript・Tesseract・CJK フォントを同梱しているため）。
- ページ操作やツールの結果を適用すると、ビューアの取り消し履歴はリセットされます。
- ツール画面は本家のデザイン（ダーク）のままです。
- 暗号化された PDF にはページ操作を適用できません（ビューアでの閲覧・注釈は可能）。
- Node のテストのうち 2 件（editcore の WASM を読むもの）は、リポジトリのパスに日本語などの非 ASCII 文字が含まれると失敗します。本家側の、パスの扱いに起因する問題です。
