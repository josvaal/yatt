//! Puente JSONL hacia el sidecar Node (libcosmic re-exporta el iced de
//! pop-os): el hilo lector (bloqueante, igual que en src-tauri) empuja
//! eventos por un canal unbounded que la subscription convierte en Messages;
//! los requests son futures para `task::future`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use cosmic::iced::futures::channel::{mpsc, oneshot};
use cosmic::iced::futures::{SinkExt, Stream, StreamExt};
use cosmic::iced::stream;
use serde_json::{json, Value};

type Pending = HashMap<u64, oneshot::Sender<Value>>;

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending: Pending,
}

pub struct Bridge {
    inner: Arc<Mutex<Inner>>,
    next_id: AtomicU64,
    events_tx: mpsc::UnboundedSender<Value>,
    events_rx: Mutex<Option<mpsc::UnboundedReceiver<Value>>>,
}

impl Bridge {
    /// Instancia global única: la subscription necesita una fuente sin
    /// capturas del estado del puente, así que vive en un OnceLock estático.
    pub fn global() -> Arc<Self> {
        static BRIDGE: OnceLock<Arc<Bridge>> = OnceLock::new();
        BRIDGE.get_or_init(|| Arc::new(Bridge::new())).clone()
    }

    /// Stream de eventos del sidecar para la subscription.
    pub fn event_stream() -> impl Stream<Item = Value> {
        stream::channel(100, |mut output: mpsc::Sender<Value>| async move {
            let bridge = Bridge::global();
            if let Some(mut rx) = bridge.take_events() {
                while let Some(ev) = rx.next().await {
                    if output.send(ev).await.is_err() {
                        break;
                    }
                }
            }
        })
    }

    /// Subscription de la app: eventos del sidecar como Items.
    pub fn subscription() -> cosmic::iced::Subscription<Value> {
        cosmic::iced::Subscription::run_with(std::any::TypeId::of::<Self>(), |_| Self::event_stream())
    }

    pub fn new() -> Self {
        let (events_tx, events_rx) = mpsc::unbounded();
        Self {
            inner: Arc::new(Mutex::new(Inner {
                child: None,
                stdin: None,
                pending: HashMap::new(),
            })),
            next_id: AtomicU64::new(1),
            events_tx,
            events_rx: Mutex::new(Some(events_rx)),
        }
    }

    /// Receiver de eventos para la subscription; None si ya fue tomado.
    pub fn take_events(&self) -> Option<mpsc::UnboundedReceiver<Value>> {
        self.events_rx.lock().unwrap().take()
    }

    /// Toma el lock de child durante todo el check+spawn+set: dos requests
    /// simultáneos no deben spawnear dos sidecars (orden child→stdin).
    pub fn spawn(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.child.is_some() {
            return Ok(());
        }
        let (child, stdin, stdout) = spawn_child()?;
        let reader = Arc::clone(&self.inner);
        let events = self.events_tx.clone();
        std::thread::spawn(move || read_loop(stdout, reader, events));
        inner.child = Some(child);
        inner.stdin = Some(stdin);
        Ok(())
    }

    /// Request JSON-RPC crudo: devuelve la respuesta completa (ok/result/error)
    /// para que el runner pueda sacar evidencia (screenshot) incluso en fallos.
    /// Recibe `Arc<Self>` para que el future sea 'static (Task::perform/stream).
    pub async fn request_raw(self: Arc<Self>, method: &str, params: Value) -> Result<Value, String> {
        self.spawn()?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        log_line(&format!("[req] {method} id={id}"));
        let (tx, rx) = oneshot::channel::<Value>();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.pending.insert(id, tx);
            let stdin = inner.stdin.as_mut().ok_or("sidecar sin canal de escritura")?;
            let line = serde_json::to_string(&json!({ "id": id, "method": method, "params": params }))
                .map_err(|e| format!("serializar request: {e}"))?;
            if let Err(e) = stdin.write_all(format!("{line}\n").as_bytes()).and_then(|()| stdin.flush()) {
                inner.pending.remove(&id);
                return Err(format!("escribiendo al sidecar: {e}"));
            }
        }
        let wait = async {
            rx.await.map_err(|_| "el sidecar terminó antes de responder".to_string())
        };
        // El `open` puede descargar el navegador: margen mucho mayor (igual que Tauri).
        let timeout = if method == "open" {
            Duration::from_secs(900)
        } else {
            Duration::from_secs(180)
        };
        use cosmic::iced::futures::future::{select, Either};
        use cosmic::iced::futures::FutureExt;
        let delay = futures_timer::Delay::new(timeout)
            .map(|_| Err::<Value, String>("timeout del sidecar".to_string()))
            .boxed();
        let resp = match select(delay, wait.boxed()).await {
            Either::Left((Err(e), _)) | Either::Right((Err(e), _)) => {
                self.inner.lock().unwrap().pending.remove(&id);
                return Err(e);
            }
            Either::Left((Ok(v), _)) | Either::Right((Ok(v), _)) => v,
        };
        log_line(&format!("[resp] {method} id={id} ok={}", resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false)));
        Ok(resp)
    }

    /// Request JSON-RPC: `result` del sidecar o Err con su error (transporte incluido).
    pub async fn request(self: Arc<Self>, method: &str, params: Value) -> Result<Value, String> {
        let resp = self.request_raw(method, params).await?;
        let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if ok {
            Ok(resp.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(resp
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("error desconocido del sidecar")
                .to_string())
        }
    }

    /// Cierre ordenado: EOF en stdin hace que el sidecar cierre Chromium y salga.
    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        if inner.child.is_none() {
            return;
        }
        inner.stdin.take();
        let mut child = inner.child.take().unwrap();
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
        for (_, tx) in inner.pending.drain() {
            let _ = tx.send(json!({ "type": "response", "id": 0, "ok": false, "error": "sidecar detenido" }));
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Lanza el proceso sidecar (mismas reglas que Tauri: binario junto al exe en
/// producción, bun/node con el TS en desarrollo).
fn spawn_child() -> Result<(Child, ChildStdin, ChildStdout), String> {
    let root = crate::db::project_root();

    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();
    if let Ok(bin) = std::env::var("YATT_SIDECAR") {
        candidates.push((bin, Vec::new()));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["yatt-sidecar", "yatt-sidecar-x86_64-unknown-linux-gnu"] {
                let path = dir.join(name).with_extension(std::env::consts::EXE_EXTENSION);
                if path.exists() {
                    candidates.push((path.display().to_string(), Vec::new()));
                }
            }
        }
    }
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
            .current_dir(if base.exists() { base.clone() } else { root.clone() })
            .env("YATT_ROOT", &root)
            // Los pasos db_* del engine resuelven la base por env (appdb.ts).
            .env("YATT_APP_DB", root.join("yatt.db"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
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

/// Log del puente en `yatt-sidecar.log` (payloads cortados a 2000 chars).
fn log_line(msg: &str) {
    const MAX: usize = 2000;
    let truncated = if msg.len() > MAX { &msg[..msg.floor_char_boundary(MAX)] } else { msg };
    let path = crate::db::project_root().join("yatt-sidecar.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", truncated);
    }
}

fn rotate_log_if_needed() {
    let path = crate::db::project_root().join("yatt-sidecar.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 1_000_000 {
            let _ = std::fs::write(&path, b"");
        }
    }
}

/// Lee stdout línea a línea: respuestas resuelven oneshots; eventos van al
/// canal de la subscription. EOF => `sidecar_exited` + falla de pendings.
fn read_loop(stream: ChildStdout, inner: Arc<Mutex<Inner>>, events: mpsc::UnboundedSender<Value>) {
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                log_line(&format!("[bridge] error leyendo stdout: {e}"));
                break;
            }
        };
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match msg.get("type").and_then(|v| v.as_str()) {
            Some("response") => {
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if let Some(tx) = inner.lock().unwrap().pending.remove(&id) {
                        let _ = tx.send(msg.clone());
                    }
                }
            }
            Some("event") => {
                let _ = events.unbounded_send(msg.clone());
            }
            _ => {}
        }
    }
    log_line("[bridge] stdout EOF: el sidecar terminó");
    let _ = events.unbounded_send(json!({ "type": "event", "name": "sidecar_exited" }));
    let _ = events.unbounded_send(
        json!({ "type": "event", "name": "browser_status", "data": { "open": false } }),
    );
    let mut guard = inner.lock().unwrap();
    for (_, tx) in guard.pending.drain() {
        let _ = tx.send(json!({ "type": "response", "id": 0, "ok": false, "error": "el sidecar terminó" }));
    }
}
