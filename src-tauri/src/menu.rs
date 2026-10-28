//! Native macOS menu bar. Custom items are forwarded to the focused window as a
//! `menu` event carrying the item id; the frontend maps ids to actions.

use std::path::PathBuf;
use tauri::menu::{
    AboutMetadata, Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

pub const RECENT_PREFIX: &str = "recent:";

struct Labels {
    ja: bool,
}

impl Labels {
    fn t<'a>(&self, ja: &'a str, en: &'a str) -> &'a str {
        if self.ja {
            ja
        } else {
            en
        }
    }
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, text);
    if let Some(a) = accel {
        b = b.accelerator(a);
    }
    b.build(app)
}

pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    ja: bool,
    recent: &[PathBuf],
) -> tauri::Result<Menu<R>> {
    let l = Labels { ja };
    let name = "BentoPDF";

    let about = PredefinedMenuItem::about(
        app,
        Some(l.t("BentoPDF について", "About BentoPDF")),
        Some(AboutMetadata {
            name: Some(name.into()),
            version: Some(app.package_info().version.to_string()),
            copyright: Some("AGPL-3.0-only — BentoPDF contributors".into()),
            credits: Some(
                "Source code: https://github.com/uniuninaruru/bentopdf\nBased on BentoPDF by alam00000"
                    .into(),
            ),
            ..Default::default()
        }),
    )?;

    let app_menu = SubmenuBuilder::new(app, name)
        .item(&about)
        .item(&item(app, "app:licenses", l.t("ライセンスとソースコード…", "Licenses and Source Code…"), None)?)
        .separator()
        .item(&item(app, "app:settings", l.t("設定…", "Settings…"), Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some(l.t("サービス", "Services")))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(l.t("BentoPDF を非表示", "Hide BentoPDF")))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(l.t("ほかを非表示", "Hide Others")))?)
        .item(&PredefinedMenuItem::show_all(app, Some(l.t("すべてを表示", "Show All")))?)
        .separator()
        .item(&item(app, "app:quit", l.t("BentoPDF を終了", "Quit BentoPDF"), Some("CmdOrCtrl+Q"))?)
        .build()?;

    let recent_menu = recent_submenu(app, &l, recent)?;
    let file_menu = SubmenuBuilder::new(app, l.t("ファイル", "File"))
        .item(&item(app, "file:new-window", l.t("新規ウインドウ", "New Window"), Some("CmdOrCtrl+N"))?)
        .item(&item(app, "file:open", l.t("開く…", "Open…"), Some("CmdOrCtrl+O"))?)
        .item(&recent_menu)
        .separator()
        .item(&item(app, "file:close-tab", l.t("タブを閉じる", "Close Tab"), Some("CmdOrCtrl+W"))?)
        .item(&item(app, "file:close-window", l.t("ウインドウを閉じる", "Close Window"), Some("Shift+CmdOrCtrl+W"))?)
        .separator()
        .item(&item(app, "file:save", l.t("保存", "Save"), Some("CmdOrCtrl+S"))?)
        .item(&item(app, "file:save-as", l.t("別名で保存…", "Save As…"), Some("Shift+CmdOrCtrl+S"))?)
        .separator()
        .item(&item(app, "file:print", l.t("プリント…", "Print…"), Some("CmdOrCtrl+P"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, l.t("編集", "Edit"))
        .item(&item(app, "edit:undo", l.t("取り消す", "Undo"), Some("CmdOrCtrl+Z"))?)
        .item(&item(app, "edit:redo", l.t("やり直す", "Redo"), Some("Shift+CmdOrCtrl+Z"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(l.t("カット", "Cut")))?)
        .item(&PredefinedMenuItem::copy(app, Some(l.t("コピー", "Copy")))?)
        .item(&PredefinedMenuItem::paste(app, Some(l.t("ペースト", "Paste")))?)
        .item(&PredefinedMenuItem::select_all(app, Some(l.t("すべてを選択", "Select All")))?)
        .separator()
        .item(&item(app, "edit:delete-selected", l.t("選択した注釈を削除", "Delete Selected Annotation"), None)?)
        .separator()
        .item(&item(app, "edit:find", l.t("検索…", "Find…"), Some("CmdOrCtrl+F"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, l.t("表示", "View"))
        .item(&item(app, "view:zoom-in", l.t("拡大", "Zoom In"), Some("CmdOrCtrl+="))?)
        .item(&item(app, "view:zoom-out", l.t("縮小", "Zoom Out"), Some("CmdOrCtrl+-"))?)
        .item(&item(app, "view:actual-size", l.t("実際のサイズ", "Actual Size"), Some("CmdOrCtrl+0"))?)
        .item(&item(app, "view:fit-width", l.t("幅に合わせる", "Fit Width"), Some("CmdOrCtrl+1"))?)
        .item(&item(app, "view:fit-page", l.t("ページ全体を表示", "Fit Page"), Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item(app, "view:sidebar", l.t("サイドバー（サムネール）", "Sidebar (Thumbnails)"), Some("Alt+CmdOrCtrl+S"))?)
        .separator()
        .item(&item(app, "view:prev-page", l.t("前のページ", "Previous Page"), Some("Alt+CmdOrCtrl+Up"))?)
        .item(&item(app, "view:next-page", l.t("次のページ", "Next Page"), Some("Alt+CmdOrCtrl+Down"))?)
        .item(&item(app, "view:go-to-page", l.t("ページへ移動…", "Go to Page…"), Some("Alt+CmdOrCtrl+G"))?)
        .separator()
        .item(&item(app, "view:next-tab", l.t("次のタブ", "Next Tab"), Some("Ctrl+Tab"))?)
        .item(&item(app, "view:prev-tab", l.t("前のタブ", "Previous Tab"), Some("Ctrl+Shift+Tab"))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some(l.t("フルスクリーンにする", "Enter Full Screen")))?)
        .build()?;

    let annotate_menu = SubmenuBuilder::new(app, l.t("注釈", "Annotate"))
        .item(&item(app, "annot:select", l.t("選択ツール", "Select Tool"), Some("CmdOrCtrl+Alt+1"))?)
        .separator()
        .item(&item(app, "annot:highlight", l.t("ハイライト", "Highlight"), Some("Ctrl+CmdOrCtrl+H"))?)
        .item(&item(app, "annot:underline", l.t("下線", "Underline"), Some("Ctrl+CmdOrCtrl+U"))?)
        .item(&item(app, "annot:strikeout", l.t("取り消し線", "Strikethrough"), Some("Ctrl+CmdOrCtrl+K"))?)
        .separator()
        .item(&item(app, "annot:text", l.t("テキストを追加", "Add Text"), Some("Ctrl+CmdOrCtrl+T"))?)
        .item(&item(app, "annot:comment", l.t("コメント（ノート）", "Comment (Note)"), Some("Ctrl+CmdOrCtrl+N"))?)
        .item(&item(app, "annot:ink", l.t("ペン（手書き）", "Pen (Ink)"), Some("Ctrl+CmdOrCtrl+I"))?)
        .item(&item(app, "annot:rectangle", l.t("四角形", "Rectangle"), None)?)
        .item(&item(app, "annot:circle", l.t("楕円", "Ellipse"), None)?)
        .item(&item(app, "annot:arrow", l.t("矢印", "Arrow"), None)?)
        .item(&item(app, "annot:stamp", l.t("スタンプ・画像", "Stamp / Image"), None)?)
        .separator()
        .item(&item(app, "annot:redact", l.t("墨消し", "Redact"), None)?)
        .build()?;

    let doc_menu = SubmenuBuilder::new(app, l.t("文書", "Document"))
        .item(&item(app, "doc:edit-content", l.t("テキストと画像を編集…", "Edit Text and Images…"), Some("CmdOrCtrl+E"))?)
        .item(&item(app, "doc:organize", l.t("ページを整理…", "Organize Pages…"), Some("Alt+CmdOrCtrl+O"))?)
        .separator()
        .item(&item(app, "doc:insert-blank", l.t("空白ページを挿入", "Insert Blank Page"), Some("Shift+CmdOrCtrl+N"))?)
        .item(&item(app, "doc:insert-file", l.t("ファイルからページを挿入…", "Insert Pages from File…"), None)?)
        // No shortcut on purpose: Cmd+Backspace deletes text in input fields.
        .item(&item(app, "doc:delete-page", l.t("現在のページを削除", "Delete Current Page"), None)?)
        .item(&item(app, "doc:rotate-left", l.t("ページを左に回転", "Rotate Page Left"), Some("CmdOrCtrl+L"))?)
        .item(&item(app, "doc:rotate-right", l.t("ページを右に回転", "Rotate Page Right"), Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(app, "tool:ocr-pdf", l.t("OCR（文字認識）…", "OCR (Text Recognition)…"), None)?)
        .item(&item(app, "tool:compress-pdf", l.t("圧縮…", "Compress…"), None)?)
        .item(&item(app, "tool:merge-pdf", l.t("結合…", "Merge…"), None)?)
        .item(&item(app, "tool:split-pdf", l.t("分割…", "Split…"), None)?)
        .item(&item(app, "tool:sign-pdf", l.t("署名…", "Sign…"), None)?)
        .item(&item(app, "tool:form-filler", l.t("フォームに入力…", "Fill Form…"), None)?)
        .item(&item(app, "tool:protect-pdf", l.t("パスワードで保護…", "Protect with Password…"), None)?)
        .separator()
        .item(&item(app, "doc:all-tools", l.t("すべてのツール…", "All Tools…"), Some("Shift+CmdOrCtrl+T"))?)
        .item(&item(app, "doc:properties", l.t("文書のプロパティ…", "Document Properties…"), Some("CmdOrCtrl+I"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, l.t("ウインドウ", "Window"))
        .item(&PredefinedMenuItem::minimize(app, Some(l.t("しまう", "Minimize")))?)
        .item(&PredefinedMenuItem::maximize(app, Some(l.t("拡大／縮小", "Zoom")))?)
        .separator()
        .item(&PredefinedMenuItem::bring_all_to_front(app, Some(l.t("すべてを手前に移動", "Bring All to Front")))?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, l.t("ヘルプ", "Help"))
        .item(&item(app, "help:shortcuts", l.t("キーボードショートカット", "Keyboard Shortcuts"), Some("CmdOrCtrl+/"))?)
        .item(&item(app, "help:source", l.t("ソースコード (GitHub)", "Source Code (GitHub)"), None)?)
        .item(&item(app, "help:upstream", l.t("BentoPDF プロジェクト", "BentoPDF Project"), None)?)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &annotate_menu,
            &doc_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

fn recent_submenu<R: Runtime>(
    app: &AppHandle<R>,
    l: &Labels,
    recent: &[PathBuf],
) -> tauri::Result<Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, l.t("最近使った項目", "Open Recent"));
    if recent.is_empty() {
        let none = MenuItemBuilder::with_id("recent:none", l.t("なし", "None"))
            .enabled(false)
            .build(app)?;
        b = b.item(&none);
    } else {
        for (i, p) in recent.iter().enumerate() {
            let label = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.to_string_lossy().into_owned());
            b = b.item(&item(app, &format!("{RECENT_PREFIX}{i}"), &label, None)?);
        }
        b = b
            .separator()
            .item(&item(app, "recent:clear", l.t("メニューを消去", "Clear Menu"), None)?);
    }
    b.build()
}
