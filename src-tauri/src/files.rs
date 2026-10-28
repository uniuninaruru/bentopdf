//! File access for the app.
//!
//! The webview never gets general filesystem access. It can only read files the
//! user chose (Finder "Open", the Open panel, drag and drop, Open Recent) and
//! only write to files the user opened or picked in a Save panel. Every path is
//! checked against these grants in Rust before any I/O happens.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Largest file the app will read into memory.
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_RECENT: usize = 15;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub writable: bool,
}

#[derive(Default)]
pub struct Grants {
    read: HashSet<PathBuf>,
    write: HashSet<PathBuf>,
}

impl Grants {
    /// Grants read access (and write access for PDFs) to a file the user opened.
    pub fn grant_opened(&mut self, path: &Path) -> Option<FileRef> {
        let canonical = fs::canonicalize(path).ok()?;
        let meta = fs::metadata(&canonical).ok()?;
        if !meta.is_file() {
            return None;
        }
        let writable = is_pdf(&canonical) && !meta.permissions().readonly();
        self.read.insert(canonical.clone());
        if writable {
            self.write.insert(canonical.clone());
        }
        Some(file_ref(&canonical, meta.len(), writable))
    }

    /// Grants write (and later read) access to a Save panel target.
    pub fn grant_save_target(&mut self, path: &Path) -> Option<FileRef> {
        let target = normalize_target(path)?;
        self.write.insert(target.clone());
        self.read.insert(target.clone());
        let size = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        Some(file_ref(&target, size, true))
    }

    pub fn can_read(&self, path: &Path) -> Option<PathBuf> {
        let canonical = fs::canonicalize(path).ok()?;
        self.read.contains(&canonical).then_some(canonical)
    }

    pub fn can_write(&self, path: &Path) -> Option<PathBuf> {
        let target = normalize_target(path)?;
        self.write.contains(&target).then_some(target)
    }
}

pub fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn file_ref(path: &Path, size: u64, writable: bool) -> FileRef {
    FileRef {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "document.pdf".into()),
        size,
        writable,
    }
}

/// Canonicalizes the parent directory of a (possibly not yet existing) file.
fn normalize_target(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let name = path.file_name()?;
    let parent = fs::canonicalize(path.parent()?).ok()?;
    let target = parent.join(name);
    if target.is_dir() {
        return None;
    }
    Some(target)
}

pub fn read_granted(grants: &Grants, path: &str) -> Result<Vec<u8>, String> {
    let path = grants
        .can_read(Path::new(path))
        .ok_or_else(|| "このファイルを読む許可がありません".to_string())?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_READ_BYTES {
        return Err("ファイルが大きすぎます (2GB まで)".into());
    }
    fs::read(&path).map_err(|e| e.to_string())
}

/// Writes atomically: a temp file in the same folder is fsynced, then renamed
/// over the target, so a crash never leaves a half-written PDF behind.
pub fn write_granted(grants: &Grants, path: &str, bytes: &[u8]) -> Result<FileRef, String> {
    let target = grants
        .can_write(Path::new(path))
        .ok_or_else(|| "このファイルに書き込む許可がありません".to_string())?;
    let dir = target.parent().ok_or("保存先フォルダが不正です")?;
    let file_name = target
        .file_name()
        .ok_or("ファイル名が不正です")?
        .to_string_lossy()
        .into_owned();
    let tmp = dir.join(format!(".{}.bentopdf-{}.tmp", file_name, std::process::id()));

    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Ok(meta) = fs::metadata(&target) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, &target)
    })();

    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("保存に失敗しました: {e}"));
    }
    Ok(file_ref(&target, bytes.len() as u64, true))
}

/// Recently used files, stored as JSON in the app data folder.
pub struct Recent {
    file: Option<PathBuf>,
    pub items: Vec<PathBuf>,
}

impl Recent {
    pub fn load(file: Option<PathBuf>) -> Self {
        let items = file
            .as_ref()
            .and_then(|f| fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .unwrap_or_default();
        Recent { file, items }
    }

    pub fn add(&mut self, path: &Path) {
        self.items.retain(|p| p != path);
        self.items.insert(0, path.to_path_buf());
        self.items.truncate(MAX_RECENT);
        self.save();
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.save();
    }

    pub fn existing(&self) -> Vec<FileRef> {
        self.items
            .iter()
            .filter_map(|p| {
                let meta = fs::metadata(p).ok()?;
                meta.is_file().then(|| file_ref(p, meta.len(), is_pdf(p)))
            })
            .collect()
    }

    fn save(&self) {
        if let Some(file) = &self.file {
            if let Some(dir) = file.parent() {
                let _ = fs::create_dir_all(dir);
            }
            if let Ok(json) = serde_json::to_string_pretty(&self.items) {
                let _ = fs::write(file, json);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bentopdf-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn ungranted_paths_are_rejected() {
        let dir = temp_dir("reject");
        let file = dir.join("a.pdf");
        fs::write(&file, b"%PDF-1.7").unwrap();
        let grants = Grants::default();
        assert!(read_granted(&grants, file.to_str().unwrap()).is_err());
        assert!(write_granted(&grants, file.to_str().unwrap(), b"x").is_err());
    }

    #[test]
    fn opened_pdf_can_be_read_and_saved_in_place() {
        let dir = temp_dir("inplace");
        let file = dir.join("日本語.pdf");
        fs::write(&file, b"%PDF-1.7 old").unwrap();
        let mut grants = Grants::default();
        let r = grants.grant_opened(&file).unwrap();
        assert!(r.writable);
        assert_eq!(read_granted(&grants, &r.path).unwrap(), b"%PDF-1.7 old");
        write_granted(&grants, &r.path, b"%PDF-1.7 new").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"%PDF-1.7 new");
        // No temp files are left behind.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn opened_non_pdf_is_read_only() {
        let dir = temp_dir("nonpdf");
        let file = dir.join("photo.png");
        fs::write(&file, b"png").unwrap();
        let mut grants = Grants::default();
        let r = grants.grant_opened(&file).unwrap();
        assert!(!r.writable);
        assert!(write_granted(&grants, &r.path, b"x").is_err());
    }

    #[test]
    fn save_target_grant_does_not_cover_siblings() {
        let dir = temp_dir("sibling");
        let mut grants = Grants::default();
        let target = dir.join("out.pdf");
        grants.grant_save_target(&target).unwrap();
        write_granted(&grants, target.to_str().unwrap(), b"%PDF").unwrap();
        let sibling = dir.join("other.pdf");
        assert!(write_granted(&grants, sibling.to_str().unwrap(), b"%PDF").is_err());
        // A traversal that resolves to a different file is rejected too.
        let sneaky = dir.join("sub").join("..").join("other.pdf");
        fs::create_dir_all(dir.join("sub")).unwrap();
        assert!(write_granted(&grants, sneaky.to_str().unwrap(), b"%PDF").is_err());
    }

    #[test]
    fn recent_list_is_deduplicated_and_capped() {
        let dir = temp_dir("recent");
        let mut recent = Recent::load(Some(dir.join("recent.json")));
        for i in 0..20 {
            recent.add(&dir.join(format!("{i}.pdf")));
        }
        recent.add(&dir.join("5.pdf"));
        assert_eq!(recent.items.len(), MAX_RECENT);
        assert_eq!(recent.items[0], dir.join("5.pdf"));
        let reloaded = Recent::load(Some(dir.join("recent.json")));
        assert_eq!(reloaded.items, recent.items);
    }
}
