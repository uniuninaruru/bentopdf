fn main() {
    // Declare the app's own commands so capabilities can allow them explicitly.
    // Commands not listed in a capability are rejected by the IPC layer.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "frontend_ready",
            "open_dialog",
            "open_recent",
            "recent_files",
            "clear_recent",
            "read_file",
            "save_dialog",
            "write_file",
            "set_document_state",
            "ask_unsaved",
            "close_window",
            "print_pdf",
            "new_window",
            "open_external",
            "log_line",
            "app_info",
        ])),
    )
    .expect("failed to run tauri-build");
}
