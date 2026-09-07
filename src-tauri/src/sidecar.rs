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

/// Lanza el proceso sidecar. En un build distribuido el sidecar viaja como un
/// binario compilado (`yatt-sidecar(.exe)`) junto al ejecutable principal y
/// `YATT_ROOT` apunta a la raíz portable de datos (ver `db::project_root`).
/// En desarrollo, hace fallback a bun/node ejecutando `sidecar/src/index.ts`
/// desde el repo, de modo que pueda importar playwright.
fn spawn_child() -> Result<(Child, ChildStdin, ChildStdout), String> {
    let root = crate::db::project_root();

    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();
    if let Ok(bin) = std::env::var("YATT_SIDECAR") {
        candidates.push((bin, Vec::new()));
    }
    // Producción: binario sidecar compilado, junto al ejecutable principal.
    // Se prueban el nombre plano y el sufijo con target triple (así lo nombra
    // el bundler de Tauri para `externalBin`).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["yatt-sidecar", "yatt-sidecar-x86_64-pc-windows-gnu"] {
                let path = dir.join(name).with_extension(std::env::consts::EXE_EXTENSION);
                if path.exists() {
                    candidates.push((path.display().to_string(), Vec::new()));
                }
            }
        }
    }
    // Desarrollo: bun o Node 23+ (type stripping) ejecutando el TS directo.
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar");
    let script = base.join("src").join("index.ts");
    candidates.push(("bun".to_string(), vec!["run".to_string(), script.display().to_string()]));
    candidates.push(("node".to_string(), vec![script.display().to_string()]));

    let mut last_err = String::from("no se encontró un runtime para el sidecar");
    rotate_log_if_needed();
    for (bin, args) in candidates {
        log_line(&format!("[bridge] intentando lanzar sidecar: {bin} {}", args.join(" ")));
        let mut cmd = Command::new(&bin);
        cmd.args(&args)
            // El sidecar usa YATT_ROOT como raíz de datos; el cwd sólo importa
            // en desarrollo (resolver node_modules). Si `base` no existe
            // (producción), caemos a la raíz de datos.
            .current_dir(if base.exists() { base.clone() } else { root.clone() })
            .env("YATT_ROOT", &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Windows: el sidecar es un binario de consola; sin esta flag, al
        // lanzarlo desde la app GUI parpadea una ventana negra de consola.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        match cmd.spawn() {
            Ok(mut child) => {
                let stdin = child.stdin.take().ok_or("sidecar sin stdin")?;
                let stdout = child.stdout.take().ok_or("sidecar sin stdout")?;
                let stderr = child.stderr.take();
                log_line(&format!("[bridge] sidecar lanzado (pid {:?})", child.id()));
                // El stderr del sidecar va al log: en un build distribuido no
                // hay consola donde caería (antes era Stdio::inherit).
                if let Some(stderr) = stderr {
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stderr);
                        for line in reader.lines().map_while(Result::ok) {
                            log_line(&format!("[sidecar-err] {line}"));
                        }
                    });
                }
                return Ok((child, stdin, stdout));
            }
            Err(e) => {
                last_err = format!("{bin}: {e}");
                log_line(&format!("[bridge] fallo al lanzar {bin}: {e}"));
            }
        }
    }
    log_line(&format!("[bridge] sin sidecar disponible: {last_err}"));
    Err(last_err)
}

/// Log de diagnóstico del puente en `yatt-sidecar.log` (junto a los datos):
/// intentos de spawn, stderr del sidecar y salida inesperada. Siempre activo
/// en builds distribuidos: sin consola visible, es la única ventana al motor.
fn log_line(msg: &str) {
    use std::io::Write;
    // Los payloads (screenshots base64, etc.) son enormes: guardamos un corte.
    const MAX: usize = 2000;
    let truncated = if msg.len() > MAX { &msg[..msg.floor_char_boundary(MAX)] } else { msg };
    let path = crate::db::project_root().join("yatt-sidecar.log");
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).ok();
    if let Some(f) = file.as_mut() {
        let _ = writeln!(f, "{}", truncated);
        let _ = f.flush();
    }
}

/// Poda el log si supera ~1 MB: lo trunca antes de un nuevo spawn.
fn rotate_log_if_needed() {
    let path = crate::db::project_root().join("yatt-sidecar.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 1_000_000 {
            let _ = std::fs::write(&path, b"");
        }
    }
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
            Err(e) => {
                log_line(&format!("[bridge] error leyendo stdout: {e}"));
                break;
            }
        };
        log_line(&format!("[sidecar-out] {line}"));
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
    log_line("[bridge] stdout EOF: el sidecar terminó");
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

    // El `open` puede implicar descargar el navegador (primera ejecución en
    // una máquina limpia): le damos mucho más margen que al resto.
    let timeout = if method == "open" {
        std::time::Duration::from_secs(900)
    } else {
        std::time::Duration::from_secs(180)
    };
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