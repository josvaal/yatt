use std::fs;
use std::path::PathBuf;

/// Raíz del proyecto (el directorio padre de src-tauri): los tests y reportes
/// viven aquí, portables y versionables con Git, y FUERA del árbol de
/// `src-tauri` que vigila `tauri dev` (si no, guardar o borrar un archivo
/// disparaba recompilación y reinicio de la app).
fn project_root() -> PathBuf {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    here.parent().unwrap_or(&here).to_path_buf()
}

/// Los tests viven como `tests/<nombre>.yatt.json` en la raíz del proyecto.
fn tests_dir() -> PathBuf {
    project_root().join("tests")
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

#[tauri::command]
pub fn test_save(name: String, content: String) -> Result<(), String> {
    let name = sanitize(&name)?;
    let dir = tests_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("creando carpeta tests: {e}"))?;
    let path = dir.join(format!("{name}.yatt.json"));
    fs::write(&path, content).map_err(|e| format!("guardando {name}: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn test_list() -> Result<Vec<String>, String> {
    let dir = tests_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| format!("leyendo carpeta tests: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".yatt.json") {
            out.push(name.trim_end_matches(".yatt.json").to_string());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn test_load(name: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    let path = tests_dir().join(format!("{name}.yatt.json"));
    fs::read_to_string(&path).map_err(|e| format!("leyendo {name}: {e}"))
}

#[tauri::command]
pub fn test_delete(name: String) -> Result<(), String> {
    let name = sanitize(&name)?;
    let path = tests_dir().join(format!("{name}.yatt.json"));
    fs::remove_file(path).map_err(|e| format!("borrando {name}: {e}"))
}

/// Los reportes de corrida viven como `reports/<nombre>.html|.json`
/// en la raíz del proyecto.
fn reports_dir() -> PathBuf {
    project_root().join("reports")
}

#[tauri::command]
pub fn report_save(name: String, content: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    let dir = reports_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("creando carpeta reports: {e}"))?;
    let path = dir.join(&name);
    fs::write(&path, &content).map_err(|e| format!("guardando {name}: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn report_list() -> Result<Vec<String>, String> {
    let dir = reports_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| format!("leyendo carpeta reports: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".html") || name.ends_with(".json") {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn report_delete(name: String) -> Result<(), String> {
    let name = sanitize(&name)?;
    let path = reports_dir().join(name);
    fs::remove_file(path).map_err(|e| format!("borrando reporte: {e}"))
}

#[tauri::command]
pub fn report_path(name: String) -> Result<String, String> {
    let name = sanitize(&name)?;
    let path = reports_dir().join(&name);
    if !path.exists() {
        return Err(format!("el reporte {name} no existe"));
    }
    Ok(path.to_string_lossy().to_string())
}