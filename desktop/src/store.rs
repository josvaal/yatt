//! Storage layer: DB rows + file mirrors, plus settings.json for run config.
use crate::db::Db;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn sanitize(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("el nombre no puede estar vacío".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("nombre de archivo no válido".to_string());
    }
    Ok(trimmed.to_string())
}

/// Run configuration persisted as `<root>/settings.json` (envs + browser defaults).
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    #[serde(default)]
    pub envs: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default, rename = "activeEnv")]
    pub active_env: Option<String>,
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default, rename = "viewportWidth")]
    pub viewport_width: Option<u32>,
    #[serde(default, rename = "viewportHeight")]
    pub viewport_height: Option<u32>,
    #[serde(default, rename = "timezoneId")]
    pub timezone_id: Option<String>,
    #[serde(default, rename = "geoLat")]
    pub geo_lat: Option<f64>,
    #[serde(default, rename = "geoLon")]
    pub geo_lon: Option<f64>,
    #[serde(default)]
    pub session: Option<String>,
}

pub struct Store {
    db: Db,
    root: PathBuf,
}

impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        let db = Db::open(root)?;
        db.migrate()?;
        db.resync()?;
        Ok(Self {
            db,
            root: root.to_path_buf(),
        })
    }

    #[allow(dead_code)] // útil para debug de rutas portables
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn dir(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn write_mirror(&self, dir: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
        fs::create_dir_all(dir).map_err(|e| format!("creando {}: {e}", dir.display()))?;
        let path = dir.join(filename);
        fs::write(&path, bytes).map_err(|e| format!("guardando {filename}: {e}"))?;
        Ok(path)
    }

    // ---- tests ----

    pub fn test_save(&self, name: &str, content: &str) -> Result<(), String> {
        let name = sanitize(name)?;
        self.db.upsert_entry("tests", "content", &name, content)?;
        self.write_mirror(
            &self.dir("tests"),
            &format!("{name}.yatt.json"),
            content.as_bytes(),
        )?;
        Ok(())
    }

    pub fn test_list(&self) -> Result<Vec<String>, String> {
        self.db.select_names("tests")
    }

    pub fn test_load(&self, name: &str) -> Result<String, String> {
        let name = sanitize(name)?;
        self.db
            .select_text("tests", "content", &name)?
            .ok_or_else(|| format!("el test {name} no existe"))
    }

    pub fn test_delete(&self, name: &str) -> Result<(), String> {
        let name = sanitize(name)?;
        self.db.delete_row("tests", &name)?;
        let _ = fs::remove_file(self.dir("tests").join(format!("{name}.yatt.json")));
        Ok(())
    }

    // ---- reports ----

    pub fn report_save(&self, name: &str, content: &str) -> Result<PathBuf, String> {
        let name = sanitize(name)?;
        self.db.upsert_entry("reports", "content", &name, content)?;
        self.write_mirror(&self.dir("reports"), &name, content.as_bytes())
    }

    pub fn report_list(&self) -> Result<Vec<String>, String> {
        self.db.select_names("reports")
    }

    pub fn report_delete(&self, name: &str) -> Result<(), String> {
        let name = sanitize(name)?;
        self.db.delete_row("reports", &name)?;
        let _ = fs::remove_file(self.dir("reports").join(&name));
        Ok(())
    }

    /// Path of a report, materializing the mirror if missing (for xdg-open).
    pub fn report_path(&self, name: &str) -> Result<PathBuf, String> {
        let name = sanitize(name)?;
        let content = self
            .db
            .select_text("reports", "content", &name)?
            .ok_or_else(|| format!("el reporte {name} no existe"))?;
        let path = self.dir("reports").join(&name);
        if !path.exists() {
            self.write_mirror(&self.dir("reports"), &name, content.as_bytes())?;
        }
        Ok(path)
    }

    // ---- baselines / exports ----

    pub fn baseline_list(&self) -> Result<Vec<String>, String> {
        self.db.select_names("baselines")
    }

    pub fn baseline_delete(&self, name: &str) -> Result<(), String> {
        let name = sanitize(name)?;
        self.db.delete_row("baselines", &name)?;
        let _ = fs::remove_file(self.dir("baselines").join(format!("{name}.png")));
        Ok(())
    }

    pub fn export_save(&self, name: &str, content: &str) -> Result<PathBuf, String> {
        let name = sanitize(name)?;
        self.write_mirror(&self.dir("exports"), &name, content.as_bytes())
    }

    // ---- settings ----

    pub fn settings_load(&self) -> Settings {
        let path = self.root.join("settings.json");
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn settings_save(&self, settings: &Settings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("serializando settings: {e}"))?;
        self.write_mirror(&self.root, "settings.json", json.as_bytes())?;
        Ok(())
    }
}
