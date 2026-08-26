mod sidecar;
mod storage;

use tauri::{Emitter, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer fails on NVIDIA drivers ("Failed to create GBM
    // buffer") and the webview renders fully black; fall back to software compositing.
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar::SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_request,
            sidecar::sidecar_stop,
            storage::test_save,
            storage::test_list,
            storage::test_load,
            storage::test_delete,
            storage::report_save,
            storage::report_list,
            storage::report_delete,
            storage::report_path,
        ])
        .setup(|app| {
            // El sidecar se arranca en segundo plano para no bloquear la UI.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = sidecar::spawn(&handle) {
                    let _ = handle.emit(
                        sidecar::EVENT_CHANNEL,
                        serde_json::json!({"type":"event","name":"sidecar_error","data":{"error": e}}),
                    );
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<sidecar::SidecarState>() {
                    sidecar::stop(&state);
                }
            }
        });
}