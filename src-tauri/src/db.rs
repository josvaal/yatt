use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Raíz del proyecto (el directorio padre de src-tauri): los datos viven aquí,
/// portables y versionables con Git, y FUERA del árbol de `src-tauri` que
/// vigila `tauri dev` (si no, guardar o borrar un archivo disparaba
/// recompilación y reinicio de la app).
pub fn project_root() -> PathBuf {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    here.parent().unwrap_or(&here).to_path_buf()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tests (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS baselines (
    name TEXT PRIMARY KEY,
    png BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    name TEXT PRIMARY KEY,
    storage_state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
";

/// Conexión única a `yatt.db` (SQLite, WAL), la fuente de verdad del sistema.
/// Las carpetas legacy (`tests/`, `reports/`, `baselines/`) se mantienen como
/// espejo automático para git, CLI de CI y "abrir con el SO".
pub struct Db {
    conn: Mutex<Connection>,
    root: PathBuf,
}

impl Db {
    pub fn open(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|e| format!("creando la raíz de datos: {e}"))?;
        let conn =
            Connection::open(root.join("yatt.db")).map_err(|e| format!("abriendo yatt.db: {e}"))?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))
            .map_err(|e| format!("configurando busy_timeout: {e}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("activando WAL: {e}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("creando tablas: {e}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
            root: root.to_path_buf(),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "la base de datos está bloqueada".to_string())
    }

    /// Inserta o reemplaza una fila de texto (`content` o `storage_state`).
    pub fn upsert_entry(&self, table: &str, col: &str, name: &str, value: &str) -> Result<(), String> {
        let conn = self.lock()?;
        let sql = format!("INSERT OR REPLACE INTO {table} (name, {col}, updated_at) VALUES (?1, ?2, ?3)");
        conn.execute(&sql, params![name, value, now_ms()])
            .map(|_| ())
            .map_err(|e| format!("guardando {name} en {table}: {e}"))
    }

    /// Inserta o reemplaza una fila BLOB (`baselines.png`).
    pub fn upsert_blob(&self, table: &str, name: &str, blob: &[u8]) -> Result<(), String> {
        let conn = self.lock()?;
        let sql = format!("INSERT OR REPLACE INTO {table} (name, png, updated_at) VALUES (?1, ?2, ?3)");
        conn.execute(&sql, params![name, blob, now_ms()])
            .map(|_| ())
            .map_err(|e| format!("guardando {name} en {table}: {e}"))
    }

    pub fn select_text(&self, table: &str, col: &str, name: &str) -> Result<Option<String>, String> {
        let conn = self.lock()?;
        let sql = format!("SELECT {col} FROM {table} WHERE name = ?1");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![name]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row.get(0).map(Some).map_err(|e| e.to_string()),
            None => Ok(None),
        }
    }

    pub fn select_blob(&self, table: &str, name: &str) -> Result<Option<Vec<u8>>, String> {
        let conn = self.lock()?;
        let sql = format!("SELECT png FROM {table} WHERE name = ?1");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![name]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row.get(0).map(Some).map_err(|e| e.to_string()),
            None => Ok(None),
        }
    }

    pub fn select_names(&self, table: &str) -> Result<Vec<String>, String> {
        let conn = self.lock()?;
        let sql = format!("SELECT name FROM {table} ORDER BY name");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let names = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(names)
    }

    pub fn delete_row(&self, table: &str, name: &str) -> Result<(), String> {
        let conn = self.lock()?;
        let sql = format!("DELETE FROM {table} WHERE name = ?1");
        conn.execute(&sql, params![name])
            .map(|_| ())
            .map_err(|e| format!("borrando {name} de {table}: {e}"))
    }

    pub fn row_exists(&self, table: &str, name: &str) -> Result<bool, String> {
        let conn = self.lock()?;
        let sql = format!("SELECT 1 FROM {table} WHERE name = ?1");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![name]).map_err(|e| e.to_string())?;
        Ok(rows.next().map_err(|e| e.to_string())?.is_some())
    }

    /// Importa una vez los ficheros legacy (carpetas en la raíz del proyecto)
    /// que no tengan todavía fila en la DB. Idempotente.
    pub fn migrate(&self) -> Result<(), String> {
        self.migrate_text("tests", "content", &self.root.join("tests"), ".yatt.json")?;
        self.migrate_text("reports", "content", &self.root.join("reports"), "")?;
        self.migrate_blob("baselines", &self.root.join("baselines"), ".png")?;
        self.migrate_text("sessions", "storage_state", &self.root.join("sessions"), ".json")?;
        Ok(())
    }

    /// Materializa como ficheros los datos de la DB que carezcan de espejo
    /// (por ejemplo tras un arranque limpio). Sesiones no: viven solo en la DB.
    pub fn resync(&self) -> Result<(), String> {
        self.materialize_text("tests", "content", &self.root.join("tests"), ".yatt.json")?;
        self.materialize_text("reports", "content", &self.root.join("reports"), "")?;
        self.materialize_blob("baselines", &self.root.join("baselines"), ".png")?;
        Ok(())
    }

    fn migrate_text(&self, table: &str, col: &str, dir: &Path, suffix: &str) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| format!("leyendo {}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || !entry.file_name().to_string_lossy().ends_with(suffix) {
                continue;
            }
            let fname = entry.file_name().to_string_lossy().to_string();
            let key = fname.trim_end_matches(suffix).to_string();
            if self.row_exists(table, &key)? {
                continue;
            }
            let content = fs::read_to_string(entry.path())
                .map_err(|e| format!("leyendo {fname}: {e}"))?;
            self.upsert_entry(table, col, &key, &content)?;
        }
        Ok(())
    }

    fn migrate_blob(&self, table: &str, dir: &Path, suffix: &str) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| format!("leyendo {}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || !entry.file_name().to_string_lossy().ends_with(suffix) {
                continue;
            }
            let fname = entry.file_name().to_string_lossy().to_string();
            let key = fname.trim_end_matches(suffix).to_string();
            if self.row_exists(table, &key)? {
                continue;
            }
            let bytes = fs::read(entry.path()).map_err(|e| format!("leyendo {fname}: {e}"))?;
            self.upsert_blob(table, &key, &bytes)?;
        }
        Ok(())
    }

    fn materialize_text(&self, table: &str, col: &str, dir: &Path, suffix: &str) -> Result<(), String> {
        for name in self.select_names(table)? {
            let path = dir.join(format!("{name}{suffix}"));
            if path.exists() {
                continue;
            }
            let content = self.select_text(table, col, &name)?.unwrap_or_default();
            fs::create_dir_all(dir).map_err(|e| format!("creando {}: {e}", dir.display()))?;
            fs::write(&path, content).map_err(|e| format!("materializando {name}: {e}"))?;
        }
        Ok(())
    }

    fn materialize_blob(&self, table: &str, dir: &Path, suffix: &str) -> Result<(), String> {
        for name in self.select_names(table)? {
            let path = dir.join(format!("{name}{suffix}"));
            if path.exists() {
                continue;
            }
            let bytes = self.select_blob(table, &name)?.unwrap_or_default();
            fs::create_dir_all(dir).map_err(|e| format!("creando {}: {e}", dir.display()))?;
            fs::write(&path, bytes).map_err(|e| format!("materializando {name}: {e}"))?;
        }
        Ok(())
    }
}