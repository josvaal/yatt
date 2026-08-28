use crate::db::{project_root, Db};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// Los tests se guardan en la DB (fuente de verdad) y se espejan como
/// `tests/<nombre>.yatt.json` en la raíz del proyecto: portables y
/// versionables con Git, y fuera del árbol que vigila `tauri dev`.
fn tests_dir() -> PathBuf {
    project_root().join("tests")
}

/// Los reportes de corrida: fila en la DB + espejo `reports/<nombre>.html|.json`.
fn reports_dir() -> PathBuf {
    project_root().join("reports")
}

fn sanitize(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("el nombre no puede estar vacío".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("nombre de archivo no válido".to_string());
    }
    Ok(trimmed.to_string())
}

fn write_mirror(dir: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("creando carpeta {}: {e}", dir.display()))?;
    let path = dir.join(filename);
    fs::write(&path, bytes).map_err(|e| format!("guardando {filename}: {e}"))?;
    Ok(path)
}

fn remove_mirror(dir: &Path, filename: &str) {
    let _ = fs::remove_file(dir.join(filename));
}

#[tauri::command]
pub fn test_save(db: State<'_, Db>, name: String, content: String) -> Result<(), String> {
    let name = sanitize(&name)?;
    db.upsert_entry("tests", "content", &name, &content)?;
    write_mirror(&tests_dir(), &format!("{name}.yatt.json"), content.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn test_list(db: State<'_, Db>) -> Result<Vec<String>, String> {
    db.select_names("tests")
}

#[tauri::command]
pub fn test_load(db: State<'_, Db>, name: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    db.select_text("tests", "content", &name)?
        .ok_or_else(|| format!("el test {name} no existe"))
}

#[tauri::command]
pub fn test_delete(db: State<'_, Db>, name: String) -> Result<(), String> {
    let name = sanitize(&name)?;
    db.delete_row("tests", &name)?;
    remove_mirror(&tests_dir(), &format!("{name}.yatt.json"));
    Ok(())
}

#[tauri::command]
pub fn report_save(db: State<'_, Db>, name: String, content: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    db.upsert_entry("reports", "content", &name, &content)?;
    let path = write_mirror(&reports_dir(), &name, content.as_bytes())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn report_list(db: State<'_, Db>) -> Result<Vec<String>, String> {
    db.select_names("reports")
}

#[tauri::command]
pub fn report_delete(db: State<'_, Db>, name: String) -> Result<(), String> {
    let name = sanitize(&name)?;
    db.delete_row("reports", &name)?;
    remove_mirror(&reports_dir(), &name);
    Ok(())
}

/// Ruta del reporte para abrirlo con el SO: materializa el espejo si falta.
#[tauri::command]
pub fn report_path(db: State<'_, Db>, name: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    let content = db
        .select_text("reports", "content", &name)?
        .ok_or_else(|| format!("el reporte {name} no existe"))?;
    let path = reports_dir().join(&name);
    if !path.exists() {
        write_mirror(&reports_dir(), &name, content.as_bytes())?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// Imágenes base de asserts visuales (RF-20): BLOB en la DB que escribe el
/// sidecar (mismo `yatt.db` vía YATT_ROOT) + espejo `baselines/<nombre>.png`.
#[tauri::command]
pub fn baseline_list(db: State<'_, Db>) -> Result<Vec<String>, String> {
    db.select_names("baselines")
}

/// Export de un test a código Playwright (RF-24): `exports/<nombre>.spec.ts`.
/// Es un artefacto portátil, así que sigue siendo solo fichero.
#[tauri::command]
pub fn export_save(name: String, content: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    let dir = project_root().join("exports");
    fs::create_dir_all(&dir).map_err(|e| format!("creando carpeta exports: {e}"))?;
    let path = dir.join(&name);
    fs::write(&path, &content).map_err(|e| format!("guardando {name}: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}