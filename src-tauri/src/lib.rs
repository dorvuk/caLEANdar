mod storage;
use serde::Serialize;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use storage::{Backup, Snapshot, Store};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Database(Mutex<Store>);
#[derive(Serialize)]
struct ImportedFile {
    name: String,
    content: String,
}
#[tauri::command]
fn load_state(db: State<Database>) -> Result<Snapshot, String> {
    db.0.lock().map_err(|e| e.to_string())?.load()
}
#[tauri::command]
fn save_state(
    db: State<Database>,
    content: String,
    expected_revision: i64,
    reason: String,
) -> Result<i64, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .save(&content, expected_revision, &reason)
}
#[tauri::command]
fn list_backups(db: State<Database>) -> Result<Vec<Backup>, String> {
    db.0.lock().map_err(|e| e.to_string())?.backups()
}
fn read_calendar(path: &Path) -> Result<ImportedFile, String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["ics", "ical", "json"].contains(&extension.as_str()) {
        return Err("Choose an .ics, .ical or configuration .json file.".into());
    }
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot read this file: {e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 40_000_000 {
        return Err("Files must be smaller than 40 MB.".into());
    }
    let mut content = String::new();
    file.take(40_000_001)
        .read_to_string(&mut content)
        .map_err(|e| format!("The file is not valid UTF-8 text: {e}"))?;
    if content.len() > 40_000_000 {
        return Err("Files must be smaller than 40 MB.".into());
    }
    Ok(ImportedFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        content,
    })
}
#[tauri::command]
async fn pick_import(app: tauri::AppHandle, kind: String) -> Result<Option<ImportedFile>, String> {
    let extensions = if kind == "calendar" {
        vec!["ics", "ical"]
    } else {
        vec!["json"]
    };
    let path = app
        .dialog()
        .file()
        .add_filter("Calendar files", &extensions)
        .blocking_pick_file();
    match path {
        Some(p) => read_calendar(&p.into_path().map_err(|e| e.to_string())?).map(Some),
        None => Ok(None),
    }
}
#[tauri::command]
fn read_import(path: PathBuf) -> Result<ImportedFile, String> {
    read_calendar(&path)
}
#[tauri::command]
fn read_backup(db: State<Database>, id: i64) -> Result<String, String> {
    db.0.lock().map_err(|e| e.to_string())?.backup_content(id)
}
#[tauri::command]
async fn save_export(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
    extension: String,
) -> Result<bool, String> {
    if !["png", "json"].contains(&extension.as_str()) || bytes.len() > 80_000_000 {
        return Err("Invalid export format or size.".into());
    }
    let path = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("Export", &[&extension])
        .blocking_save_file();
    let Some(path) = path else { return Ok(false) };
    let mut path = path.into_path().map_err(|e| e.to_string())?;
    if path.extension().is_none() {
        path.set_extension(&extension);
    }
    write_export(&path, &bytes)?;
    Ok(true)
}
fn write_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid destination.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(&bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist(&path)
        .map_err(|e| format!("Cannot save export: {}", e.error))?;
    Ok(())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?;
            std::fs::create_dir_all(&path)?;
            let db = Store::open(&path.join("calendar.sqlite")).map_err(std::io::Error::other)?;
            app.manage(Database(Mutex::new(db)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            list_backups,
            read_backup,
            pick_import,
            read_import,
            save_export
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start caLEANdar");
}
#[cfg(test)]
mod file_tests {
    use super::*;
    #[test]
    fn exports_replace_atomically_and_preserve_binary_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("week.png");
        write_export(&path, b"previous export").unwrap();
        let png = b"\x89PNG\r\n\x1a\nsynthetic payload";
        write_export(&path, png).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), png);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(write_export(&dir.path().join("missing/file.png"), png).is_err());
    }
    #[test]
    fn native_import_rejects_non_calendar_paths_and_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let invalid = dir.path().join("bad.ics");
        std::fs::write(&invalid, [0xff]).unwrap();
        assert!(read_calendar(&invalid).is_err());
        let text = dir.path().join("other.txt");
        std::fs::write(&text, "text").unwrap();
        assert!(read_calendar(&text).is_err());
    }
}
