//! BentoPDF desktop shell.
//!
//! Rust owns windows, the menu bar, file access and the quit flow. The
//! frontend (desktop.html) owns documents: it reports per-window "edited"
//! state, and Rust asks it to confirm before a window with unsaved changes
//! closes or the app quits.

mod files;
mod menu;
#[cfg(target_os = "macos")]
mod macos;

use files::{FileRef, Grants, Recent};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, DragDropEvent, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

const SOURCE_URL: &str = "https://github.com/uniuninaruru/bentopdf";
const UPSTREAM_URL: &str = "https://github.com/alam00000/bentopdf";

#[derive(Default)]
struct WindowInfo {
    ready: bool,
    edited: bool,
    allow_close: bool,
    queued_files: Vec<FileRef>,
    queued_menu: Vec<String>,
}

struct AppState {
    /// Set once `setup` has run. macOS can deliver "open file" events before
    /// that (cold launch from Finder); those are queued in `early_opens`.
    initialized: AtomicBool,
    early_opens: Mutex<Vec<PathBuf>>,
    grants: Mutex<Grants>,
    windows: Mutex<HashMap<String, WindowInfo>>,
    /// Window labels, most recently focused last.
    focus_order: Mutex<Vec<String>>,
    quitting: AtomicBool,
    quit_allowed: AtomicBool,
    counter: AtomicU32,
    recent: Mutex<Recent>,
    lang: String,
    log_file: Mutex<Option<PathBuf>>,
}

impl AppState {
    fn new(lang: String) -> Self {
        AppState {
            initialized: AtomicBool::new(false),
            early_opens: Mutex::new(Vec::new()),
            grants: Mutex::new(Grants::default()),
            windows: Mutex::new(HashMap::new()),
            focus_order: Mutex::new(Vec::new()),
            quitting: AtomicBool::new(false),
            quit_allowed: AtomicBool::new(false),
            counter: AtomicU32::new(0),
            recent: Mutex::new(Recent::load(None)),
            lang,
            log_file: Mutex::new(None),
        }
    }

    fn ja(&self) -> bool {
        self.lang.starts_with("ja")
    }

    fn log(&self, level: &str, message: &str) {
        let Some(path) = self.log_file.lock().unwrap().clone() else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
            let _ = writeln!(f, "{secs:.3} [{level}] {message}");
        }
    }

    fn any_edited(&self) -> bool {
        self.windows.lock().unwrap().values().any(|w| w.edited)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyInfo {
    files: Vec<FileRef>,
    menu: Vec<String>,
    lang: String,
    version: String,
    user_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    quitting: bool,
}

// ---------------------------------------------------------------------------
// Windows

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let state = app.state::<AppState>();
    let n = state.counter.fetch_add(1, Ordering::SeqCst) + 1;
    let label = format!("doc-{n}");
    state
        .windows
        .lock()
        .unwrap()
        .insert(label.clone(), WindowInfo::default());

    let app_for_nav = app.clone();
    let app_for_new = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("desktop.html".into()))
        .title("BentoPDF")
        .inner_size(1280.0, 860.0)
        .min_inner_size(720.0, 480.0)
        .accept_first_mouse(true)
        .on_navigation(move |url| {
            let allowed = is_app_url(url);
            if !allowed {
                open_external_url(&app_for_nav, url.as_str());
            }
            allowed
        })
        .on_new_window(move |url, _features| {
            open_external_url(&app_for_new, url.as_str());
            NewWindowResponse::Deny
        });

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 20.0));
    }

    // Cascade new windows from the most recently focused one.
    if let Some(prev) = last_window(app) {
        if let (Ok(pos), Ok(scale)) = (prev.outer_position(), prev.scale_factor()) {
            let p = pos.to_logical::<f64>(scale);
            builder = builder.position(p.x + 28.0, p.y + 28.0);
        }
    } else {
        builder = builder.center();
    }

    let window = builder.build()?;
    state.log("info", &format!("window created: {label}"));
    Ok(window)
}

fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" => true,
        "http" | "https" => matches!(url.host_str(), Some("localhost") | Some("tauri.localhost")),
        _ => false,
    }
}

fn open_external_url(app: &AppHandle, url: &str) {
    let Ok(parsed) = Url::parse(url) else { return };
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return;
    }
    if is_app_url(&parsed) {
        return;
    }
    app.state::<AppState>()
        .log("info", &format!("open external: {}", parsed.as_str()));
    let _ = std::process::Command::new("/usr/bin/open").arg(parsed.as_str()).spawn();
}

fn last_window(app: &AppHandle) -> Option<WebviewWindow> {
    let state = app.state::<AppState>();
    let order = state.focus_order.lock().unwrap().clone();
    for label in order.iter().rev() {
        if let Some(w) = app.get_webview_window(label) {
            return Some(w);
        }
    }
    app.webview_windows().into_values().next()
}

/// Window that should receive files or menu commands, created if needed.
fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    last_window(app).or_else(|| create_window(app).ok())
}

fn deliver_files(app: &AppHandle, window: &WebviewWindow, refs: Vec<FileRef>) {
    if refs.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    let ready = {
        let mut windows = state.windows.lock().unwrap();
        let info = windows.entry(window.label().to_string()).or_default();
        if !info.ready {
            info.queued_files.extend(refs.clone());
        }
        info.ready
    };
    if ready {
        let _ = window.emit_to(window.label(), "open-files", refs);
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn deliver_menu(app: &AppHandle, id: &str) {
    let Some(window) = target_window(app) else { return };
    let state = app.state::<AppState>();
    let ready = {
        let mut windows = state.windows.lock().unwrap();
        let info = windows.entry(window.label().to_string()).or_default();
        if !info.ready {
            info.queued_menu.push(id.to_string());
        }
        info.ready
    };
    if ready {
        let _ = window.emit_to(window.label(), "menu", id.to_string());
    }
}

/// Grants access to files the user asked to open and sends them to a window.
fn open_paths(app: &AppHandle, paths: Vec<PathBuf>, window: Option<WebviewWindow>) {
    let state = app.state::<AppState>();
    let refs = grant_paths(app, &paths);
    state.log("info", &format!("open {} file(s)", refs.len()));
    if refs.is_empty() {
        return;
    }
    if let Some(window) = window.or_else(|| target_window(app)) {
        deliver_files(app, &window, refs);
    }
}

fn grant_paths(app: &AppHandle, paths: &[PathBuf]) -> Vec<FileRef> {
    let state = app.state::<AppState>();
    let refs: Vec<FileRef> = {
        let mut grants = state.grants.lock().unwrap();
        paths.iter().filter_map(|p| grants.grant_opened(p)).collect()
    };
    let mut recent_changed = false;
    {
        let mut recent = state.recent.lock().unwrap();
        for r in refs.iter().filter(|r| files::is_pdf(Path::new(&r.path))) {
            recent.add(Path::new(&r.path));
            recent_changed = true;
        }
    }
    if recent_changed {
        rebuild_menu(app);
    }
    refs
}

fn rebuild_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let recent = state.recent.lock().unwrap().items.clone();
    match menu::build(app, state.ja(), &recent) {
        Ok(m) => {
            let _ = app.set_menu(m);
        }
        Err(e) => state.log("error", &format!("menu build failed: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Quit flow

fn start_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.quitting.store(true, Ordering::SeqCst);
    continue_quit(app);
}

/// Closes windows without unsaved changes, then asks the first edited window
/// to confirm. Called again each time a window is destroyed while quitting.
fn continue_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.quitting.load(Ordering::SeqCst) {
        return;
    }
    let windows = app.webview_windows();
    let edited: Vec<String> = {
        let infos = state.windows.lock().unwrap();
        windows
            .keys()
            .filter(|l| infos.get(*l).map(|i| i.edited).unwrap_or(false))
            .cloned()
            .collect()
    };
    if edited.is_empty() {
        state.quit_allowed.store(true, Ordering::SeqCst);
        state.log("info", "quit");
        app.exit(0);
        return;
    }
    for (label, w) in &windows {
        if !edited.contains(label) {
            let _ = w.destroy();
        }
    }
    if let Some(w) = app.get_webview_window(&edited[0]) {
        let _ = w.set_focus();
        let _ = w.emit_to(w.label(), "close-requested", CloseRequest { quitting: true });
    }
}

// ---------------------------------------------------------------------------
// Commands

#[tauri::command]
fn frontend_ready(app: AppHandle, window: WebviewWindow) -> ReadyInfo {
    let state = app.state::<AppState>();
    let (files, menu) = {
        let mut windows = state.windows.lock().unwrap();
        let info = windows.entry(window.label().to_string()).or_default();
        info.ready = true;
        (std::mem::take(&mut info.queued_files), std::mem::take(&mut info.queued_menu))
    };
    state.log("info", &format!("frontend ready: {} ({} queued)", window.label(), files.len()));
    #[cfg(target_os = "macos")]
    let user_name = macos::full_user_name();
    #[cfg(not(target_os = "macos"))]
    let user_name = String::new();
    ReadyInfo {
        files,
        menu,
        lang: state.lang.clone(),
        version: app.package_info().version.to_string(),
        user_name,
    }
}

#[tauri::command]
async fn open_dialog(app: AppHandle, window: WebviewWindow, pdf_only: bool) -> Result<Vec<FileRef>, String> {
    let picker_app = app.clone();
    let paths = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = picker_app.dialog().file().set_parent(&window);
        if pdf_only {
            dialog = dialog.add_filter("PDF", &["pdf", "PDF"]);
        }
        dialog.blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    let paths: Vec<PathBuf> = paths
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    Ok(grant_paths(&app, &paths))
}

#[tauri::command]
fn recent_files(app: AppHandle) -> Vec<FileRef> {
    app.state::<AppState>().recent.lock().unwrap().existing()
}

#[tauri::command]
fn clear_recent(app: AppHandle) {
    app.state::<AppState>().recent.lock().unwrap().clear();
    rebuild_menu(&app);
}

/// Opens a file from the recent list. Only paths Rust itself recorded are accepted.
#[tauri::command]
fn open_recent(app: AppHandle, path: String) -> Result<FileRef, String> {
    let state = app.state::<AppState>();
    let known = state.recent.lock().unwrap().items.iter().any(|p| p == Path::new(&path));
    if !known {
        return Err("最近使った項目にないファイルです".into());
    }
    grant_paths(&app, &[PathBuf::from(&path)])
        .into_iter()
        .next()
        .ok_or_else(|| "ファイルが見つかりません".into())
}

#[tauri::command]
fn read_file(app: AppHandle, path: String) -> Result<Response, String> {
    let state = app.state::<AppState>();
    let grants = state.grants.lock().unwrap();
    files::read_granted(&grants, &path).map(Response::new)
}

#[tauri::command]
async fn save_dialog(
    app: AppHandle,
    window: WebviewWindow,
    default_name: String,
    directory: Option<String>,
) -> Result<Option<FileRef>, String> {
    let picker_app = app.clone();
    let ext = Path::new(&default_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = picker_app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(default_name);
        if let Some(dir) = directory.filter(|d| Path::new(d).is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        if let Some(ext) = ext.as_deref() {
            dialog = dialog.add_filter(ext.to_ascii_uppercase(), &[ext]);
        }
        dialog.blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let state = app.state::<AppState>();
    let r = state.grants.lock().unwrap().grant_save_target(&path);
    Ok(r)
}

/// Body: raw bytes. Header `x-path`: percent-encoded absolute path.
#[tauri::command]
fn write_file(app: AppHandle, request: Request<'_>) -> Result<FileRef, String> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
        .ok_or("x-path header is missing")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let state = app.state::<AppState>();
    let result = {
        let grants = state.grants.lock().unwrap();
        files::write_granted(&grants, &path, bytes)
    };
    match &result {
        Ok(r) => {
            state.log("info", &format!("saved {} bytes to {}", bytes.len(), r.path));
            if files::is_pdf(Path::new(&r.path)) {
                state.recent.lock().unwrap().add(Path::new(&r.path));
                rebuild_menu(&app);
            }
        }
        Err(e) => state.log("error", &format!("save failed for {path}: {e}")),
    }
    result
}

#[tauri::command]
fn set_document_state(app: AppHandle, window: WebviewWindow, edited: bool, path: Option<String>) {
    let state = app.state::<AppState>();
    if let Some(info) = state.windows.lock().unwrap().get_mut(window.label()) {
        info.edited = edited;
    }
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(ns) = w.ns_window() {
                macos::set_document_state(ns, edited, path.as_deref());
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = path;
}

/// Native "save changes?" alert, shown as a sheet. Returns save | discard | cancel.
#[tauri::command]
async fn ask_unsaved(app: AppHandle, window: WebviewWindow, names: Vec<String>) -> Result<String, String> {
    let ja = app.state::<AppState>().ja();
    let (title, message, save, discard, cancel) = if ja {
        let title = match names.len() {
            1 => format!("「{}」への変更を保存しますか?", names[0]),
            n => format!("{n} 個の書類に未保存の変更があります。保存しますか?"),
        };
        (title, "保存しないと、変更内容は失われます。".to_string(), "保存", "保存しない", "キャンセル")
    } else {
        let title = match names.len() {
            1 => format!("Do you want to save the changes made to “{}”?", names[0]),
            n => format!("You have unsaved changes in {n} documents. Save them?"),
        };
        (title, "Your changes will be lost if you don’t save them.".to_string(), "Save", "Don’t Save", "Cancel")
    };
    let dialog_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .message(message)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .parent(&window)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                save.to_string(),
                discard.to_string(),
                cancel.to_string(),
            ))
            .blocking_show_with_result()
    })
    .await
    .map_err(|e| e.to_string())?;
    let answer = match result {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(label) if label == save => "save",
        MessageDialogResult::Custom(label) if label == discard => "discard",
        _ => "cancel",
    };
    Ok(answer.into())
}

/// Called by the frontend after its unsaved-changes flow.
#[tauri::command]
fn close_window(app: AppHandle, window: WebviewWindow, proceed: bool) {
    let state = app.state::<AppState>();
    if proceed {
        if let Some(info) = state.windows.lock().unwrap().get_mut(window.label()) {
            info.allow_close = true;
            info.edited = false;
        }
        let _ = window.destroy();
    } else {
        state.quitting.store(false, Ordering::SeqCst);
    }
}

/// Body: raw PDF bytes. Header `x-title`: percent-encoded job title.
#[tauri::command]
async fn print_pdf(app: AppHandle, window: WebviewWindow, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let title = request
        .headers()
        .get("x-title")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "BentoPDF".into());
    let bytes = bytes.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let result = macos::print_pdf(&bytes, &title);
            #[cfg(not(target_os = "macos"))]
            let result: Result<(), String> = Err("printing is only implemented on macOS".into());
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("print cancelled".into())))
        .await
        .map_err(|e| e.to_string())?;
    if let Err(e) = &result {
        app.state::<AppState>().log("error", &format!("print failed: {e}"));
    }
    result
}

#[tauri::command]
fn new_window(app: AppHandle) -> Result<(), String> {
    create_window(&app).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) {
    open_external_url(&app, &url);
}

#[tauri::command]
fn log_line(app: AppHandle, window: WebviewWindow, level: String, message: String) {
    let level = match level.as_str() {
        "error" | "warn" | "info" | "debug" => level,
        _ => "info".into(),
    };
    let message: String = message.chars().take(4000).collect();
    app.state::<AppState>()
        .log(&level, &format!("[{}] {message}", window.label()));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    lang: String,
    source_url: String,
    upstream_url: String,
    log_path: Option<String>,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    let state = app.state::<AppState>();
    let log_path = state
        .log_file
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned());
    AppInfo {
        version: app.package_info().version.to_string(),
        lang: state.lang.clone(),
        source_url: SOURCE_URL.into(),
        upstream_url: UPSTREAM_URL.into(),
        log_path,
    }
}

// ---------------------------------------------------------------------------

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "app:quit" => start_quit(app),
        "file:new-window" => {
            let _ = create_window(app);
        }
        "recent:clear" => {
            app.state::<AppState>().recent.lock().unwrap().clear();
            rebuild_menu(app);
        }
        "help:source" => open_external_url(app, SOURCE_URL),
        "help:upstream" => open_external_url(app, UPSTREAM_URL),
        _ if id.starts_with(menu::RECENT_PREFIX) => {
            let index: usize = id[menu::RECENT_PREFIX.len()..].parse().unwrap_or(usize::MAX);
            let path = app
                .state::<AppState>()
                .recent
                .lock()
                .unwrap()
                .items
                .get(index)
                .cloned();
            if let Some(path) = path {
                open_paths(app, vec![path], None);
            }
        }
        _ => deliver_menu(app, id),
    }
}

fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    let label = window.label().to_string();
    match event {
        WindowEvent::Focused(true) => {
            let mut order = state.focus_order.lock().unwrap();
            order.retain(|l| l != &label);
            order.push(label);
        }
        WindowEvent::CloseRequested { api, .. } => {
            let needs_confirm = state
                .windows
                .lock()
                .unwrap()
                .get(&label)
                .map(|i| i.edited && !i.allow_close)
                .unwrap_or(false);
            if needs_confirm {
                api.prevent_close();
                let _ = window.emit_to(label.as_str(), "close-requested", CloseRequest { quitting: false });
            }
        }
        WindowEvent::Destroyed => {
            state.windows.lock().unwrap().remove(&label);
            state.focus_order.lock().unwrap().retain(|l| l != &label);
            if state.quitting.load(Ordering::SeqCst) {
                continue_quit(app);
            }
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            let refs = grant_paths(app, paths);
            if !refs.is_empty() {
                let _ = window.emit_to(label.as_str(), "files-dropped", refs);
            }
        }
        _ => {}
    }
}

pub fn run() {
    #[cfg(target_os = "macos")]
    let lang = macos::preferred_language();
    #[cfg(not(target_os = "macos"))]
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en".into());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(lang))
        .setup(|app| {
            let handle = app.handle().clone();
            let state = handle.state::<AppState>();
            *state.log_file.lock().unwrap() =
                app.path().app_log_dir().ok().map(|d| d.join("bentopdf.log"));
            if let Ok(dir) = app.path().app_data_dir() {
                *state.recent.lock().unwrap() = Recent::load(Some(dir.join("recent.json")));
            }
            state.log("info", &format!("start v{} lang={}", handle.package_info().version, state.lang));

            rebuild_menu(&handle);

            #[cfg(target_os = "macos")]
            {
                let quit_app = handle.clone();
                macos::install_terminate_handler(Box::new(move || {
                    let state = quit_app.state::<AppState>();
                    if state.quit_allowed.load(Ordering::SeqCst) || !state.any_edited() {
                        state.quit_allowed.store(true, Ordering::SeqCst);
                        return true;
                    }
                    let h = quit_app.clone();
                    let _ = quit_app.run_on_main_thread(move || start_quit(&h));
                    false
                }));
            }

            // Files from Finder that arrived before setup, plus command-line
            // arguments (used during development).
            let mut paths: Vec<PathBuf> = std::mem::take(&mut *state.early_opens.lock().unwrap());
            paths.extend(
                std::env::args_os()
                    .skip(1)
                    .map(PathBuf::from)
                    .filter(|p| p.is_file()),
            );
            state.initialized.store(true, Ordering::SeqCst);

            let window = create_window(&handle)?;
            if !paths.is_empty() {
                open_paths(&handle, paths, Some(window));
            }
            Ok(())
        })
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            open_dialog,
            open_recent,
            recent_files,
            clear_recent,
            read_file,
            save_dialog,
            write_file,
            set_document_state,
            ask_unsaved,
            close_window,
            print_pdf,
            new_window,
            open_external,
            log_line,
            app_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building BentoPDF");

    app.run(|app, event| match event {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            let Some(state) = app.try_state::<AppState>() else { return };
            if !state.initialized.load(Ordering::SeqCst) {
                state.early_opens.lock().unwrap().extend(paths);
                return;
            }
            state.log("info", &format!("opened event with {} url(s)", urls.len()));
            open_paths(app, paths, None);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows && app.webview_windows().is_empty() {
                let _ = create_window(app);
            }
        }
        RunEvent::ExitRequested { code, api, .. } => {
            // Closing the last window keeps the app running, like other Mac apps.
            let Some(state) = app.try_state::<AppState>() else { return };
            if code.is_none() && !state.quitting.load(Ordering::SeqCst) {
                api.prevent_exit();
            }
        }
        _ => {}
    });
}
