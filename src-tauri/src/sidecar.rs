use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

/// Canal de eventos que Tauri emite hacia el frontend.
pub const EVENT_CHANNEL: &str = "yatt://event";

pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<ChildStdin>>,
    pub pending: std::sync::Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
    pub next_id: AtomicU64,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            pending: std::sync::Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }
}

/// Lanza el proceso sidecar (bun o node) con cwd en `sidecar/`, de modo que
/// pueda importar playwright. En un build empaquetado esto se sustituirá por un
/// binario sidecar registrado en Tauri (phase de distribución).
///
/// `YATT_ROOT` apunta a la raíz del proyecto: el sidecar guarda ahí sus
/// baselines/ y sesiones/ (misma raíz que tests/ y reports/ del frontend).
fn spawn_child() -> Result<(Child, ChildStdin, ChildStdout), String> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar");
    let script = base.join("src").join("index.ts");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");

    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();
    if let Ok(bin) = std::env::var("YATT_SIDECAR") {
        candidates.push((bin, Vec::new()));
    }
    candidates.push(("bun".to_string(), vec!["run".to_string(), script.display().to_string()]));
    // Node 23+ ejecuta TS con type stripping directamente.
    candidates.push(("node".to_string(), vec![script.display().to_string()]));

    let mut last_err = String::from("no se encontró un runtime para el sidecar");
    for (bin, args) in candidates {
        let mut cmd = Command::new(&bin);
        cmd.args(&args)
            .current_dir(&base)
            .env("YATT_ROOT", &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        match cmd.spawn() {
            Ok(mut child) => {
                let stdin = child.stdin.take().ok_or("sidecar sin stdin")?;
                let stdout = child.stdout.take().ok_or("sidecar sin stdout")?;
                return Ok((child, stdin, stdout));
            }
            Err(e) => last_err = format!("{bin}: {e}"),
        }
    }
    Err(last_err)
}

/// Log de depuración del bridge, activo solo con la variable YATT_DEBUG=1.
fn debug_log(msg: &str) {
    if std::env::var_os("YATT_DEBUG").is_some() {
        eprintln!("[yatt-bridge] {msg}");
    }
}

/// Lee stdout del sidecar línea a línea: las respuestas resuelven los oneshot
/// pendientes por id; los eventos se reemiten al frontend.
fn read_loop(
    stream: ChildStdout,
    app: AppHandle,
    pending: std::sync::Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
) {
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match msg.get("type").and_then(|v| v.as_str()) {
            Some("response") => {
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if let Some(tx) = pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(msg.clone());
                    }
                }
            }
            Some("event") => {
                if let Some(name) = msg.get("name").and_then(|v| v.as_str()) {
                    debug_log(&format!("evento del sidecar: {name}"));
                }
                let _ = app.emit(EVENT_CHANNEL, msg.clone());
            }
            _ => {}
        }
    }
    // EOF: el sidecar murió o fue asesinado.
    let _ = app.emit(EVENT_CHANNEL, json!({ "type": "event", "name": "sidecar_exited" }));
    let _ = app.emit(EVENT_CHANNEL, json!({ "type": "event", "name": "browser_status", "data": { "open": false } }));
}

/// Arranca el sidecar si aún no está vivo. Idempotente.
pub fn spawn(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    if state.child.lock().unwrap().is_some() {
        return Ok(());
    }
    let (child, stdin, stdout) = spawn_child()?;
    let app2 = app.clone();
    let pending = state.pending.clone();
    std::thread::spawn(move || read_loop(stdout, app2, pending));
    {
        let mut cl = state.child.lock().unwrap();
        *cl = Some(child);
        let mut sl = state.stdin.lock().unwrap();
        *sl = Some(stdin);
    }
    Ok(())
}

/// Puente genérico JSON-RPC: el frontend envía `{"id","method","params"}` como
/// string y recibe el `result` del sidecar o el error como Err.
#[tauri::command]
pub async fn sidecar_request(
    app: AppHandle,
    state: State<'_, SidecarState>,
    payload: String,
) -> Result<Value, String> {
    let req: Value = serde_json::from_str(&payload).map_err(|e| format!("payload inválido: {e}"))?;
    let id = req
        .get("id")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| state.next_id.fetch_add(1, Ordering::SeqCst));
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("?").to_string();

    spawn(&app)?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
    {
        let mut pending = state.pending.lock().unwrap();
        pending.insert(id, tx);
    }
    {
        let mut guard = state.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or("sidecar sin canal de escritura")?;
        let line = serde_json::to_string(&req).map_err(|e| format!("serializar request: {e}"))?;
        if let Err(e) = stdin.write_all(format!("{line}\n").as_bytes()).and_then(|()| stdin.flush()) {
            state.pending.lock().unwrap().remove(&id);
            return Err(format!("escribiendo al sidecar: {e}"));
        }
    }

    let timeout = std::time::Duration::from_secs(180);
    let resp = tokio::time::timeout(timeout, rx)
        .await
        .map_err(|_| format!("timeout del sidecar en método '{method}'"))?
        .map_err(|_| "el sidecar terminó antes de responder".to_string())?;

    let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    debug_log(&format!("request '{method}' -> {}", if ok { "ok" } else { "error" }));
    if ok {
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    } else {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("error desconocido del sidecar");
        Err(err.to_string())
    }
}

/// Cierre ordenado del sidecar: cerrar su stdin hace que el sidecar cierre
/// Chromium y salga solo (EOF → closeBrowser → exit), así nunca se mata el
/// sidecar a mitad de un cierre y dejan procesos de Chromium huérfanos.
pub fn stop(state: &State<'_, SidecarState>) {
    let mut cl = state.child.lock().unwrap();
    if cl.is_none() {
        return;
    }
    // Cierra el canal de escritura: el sidecar ve EOF, cierra el browser y sale.
    state.stdin.lock().unwrap().take();
    let mut child = cl.take().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => break,
        }
    }
    let mut pending = state.pending.lock().unwrap();
    for (_, tx) in pending.drain() {
        let _ = tx.send(json!({ "type": "response", "id": 0, "ok": false, "error": "sidecar detenido" }));
    }
}

#[tauri::command]
pub fn sidecar_stop(state: State<'_, SidecarState>) {
    stop(&state);
}