# Arquitectura — YATT

> YATT (Yet Another Testing Tool): app de escritorio para testing de UI
> interactivo — apuntás acciones sobre un Chromium real y el test se construye
> y valida paso a paso, sin escribir código.

Docs complementarias: [protocolo del sidecar](docs/protocolo-sidecar.md) ·
[servidor MCP](docs/mcp-server.md) · [formato de tests y reportes](docs/formato-tests-reportes.md)

## Vista de alto nivel

```
┌────────────────────────────────────────────────────────────┐
│                       YATT (Tauri 2)                       │
│                                                             │
│  ┌────────────────────┐    ┌────────────────────────────┐   │
│  │  Frontend React 19 │    │   Core Rust (Tauri)        │   │
│  │  - Editor de pasos │    │   - Commands (IPC)         │   │
│  │  - Toolbar flotante│    │   - Gestión de sets/JSON   │   │
│  │  - Variables/envs. │    │   - Orquestación sidecar   │   │
│  │  - Runner UI/rep.  │    │   - Spawn/kill Chromium    │   │
│  └─────────┬──────────┘    └────────────┬───────────────┘   │
│            │      (Tauri IPC: invoke / event)               │
│            ▼                              ▼                 │
│  ┌────────────────────────────────────────────────────┐     │
│  │            Playwright sidecar (Node)               │     │
│  │   JSON-RPC sobre stdin/stdout (proceso hijo)       │     │
│  │   - Abre/pausa/cierra browser (visible | headless) │     │
│  │   - Ejecuta pasos y asserts sobre Chromium         │     │
│  │   - Captura selectores, screenshots, evidencia     │     │
│  └────────────────────────────────────────────────────┘     │
│                       │  Chrome DevTools Protocol            │
│                       ▼                                      │
│              ┌──────────────────┐                            │
│              │     Chromium     │  (ventana propia o         │
│              │   (Playwright)   │   headless + preview)      │
│              └──────────────────┘                            │
└────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
   ┌───────────────────┐        ┌──────────────────────┐
   │ SQLite yatt.db +  │        │ Reports: JSON + HTML │
   │ espejos: tests/,  │        │ screenshots, logs,   │
   │ reports/, baselines/│      │ tiempos              │
   └───────────────────┘        └──────────────────────┘

  En paralelo, el servidor MCP (mcp/) habla con el MISMO sidecar y la
  MISMA yatt.db para que un asistente de IA use YATT sin la app.
```

## Los cuatro subsistemas

### 1. Frontend (React 19 + Vite + Tailwind 4 + shadcn/ui)

- **Sin router**: la navegación es por estado (`PageId` en
  `src/editor/context.tsx`): `editor | variables | data | run | reports`.
- **`EditorContext`** (Context + hooks, sin Redux): un solo store con ~90
  miembros — árbol de pasos, estados por paso, preview, variables/entornos,
  dataset, flags de corrida y **refs de control de flujo** (pausa con
  promise-gate, stop, paso-a-paso, re-grabado pendiente, logs ≤300).
  Helpers recursivos sobre el árbol (`findStepRec`, `mapStepRec`, ...).
- **Páginas** (`src/pages/`): `editor.tsx` (árbol de pasos, preview viva,
  motor/viewport/tz/geo, pestañas, sesiones, export), `run.tsx` (corrida con
  pausa/stop/paso-a-paso/timeout), `reports.tsx` (corrida de set + historial),
  `variables.tsx` (CRUD de variables y entornos), `data.tsx` (CSV data-driven).
- **`src/lib/`**: `yatt.ts` (cliente del bridge: tipos de las 28 acciones +
  `request()` único sobre `invoke("sidecar_request")` + listeners),
  `vars.ts` (interpolación `{{var}}` pura), `report.ts` (RunReport + HTML
  autocontenido, compartido con el MCP), `import.ts` (validación al importar),
  `export.ts` (spec Playwright/Jest), `i18n.tsx` (es/en, ~230 claves).
- **Eventos del sidecar** por un único canal Tauri (`yatt://event`):
  `action_captured`, `browser_status`, `tabs_changed`, `sidecar_ready`,
  `browser_install_*`, `log`, `grab_result`, `sidecar_exited/error`.

### 2. Core Rust (Tauri 2, `src-tauri/src/`)

- **Comandos IPC** (`storage.rs`): `test_save/list/load/delete`,
  `report_save/list/delete/path`, `baseline_list`, `export_save`,
  `sidecar_request`, `sidecar_stop`. `sanitize(name)` rechaza vacío,
  separadores y `..`.
- **Puente JSON-RPC** (`sidecar.rs`): spawn del sidecar (candidatos:
  `$YATT_SIDECAR` → binario junto al ejecutable → `bun run` → `node`),
  `read_loop` por línea que resuelve pendejos por `id` (oneshot) y re-emite
  eventos al frontend; timeouts 900 s (`open`) / 180 s (resto); shutdown
  limpio cerrando stdin (el sidecar ve EOF → cierra Chromium → exit 0) con
  kill a los 5 s. Log en `yatt-sidecar.log` (podado a 1 MB).
- **SQLite** (`db.rs`): conexión única `Mutex<Connection>`, WAL,
  busy_timeout 5000. En arranque: `migrate()` (importa ficheros legacy sin
  fila) y `resync()` (materializa filas sin espejo). Sesiones viven **solo**
  en BD.

### 3. Sidecar Playwright (Node, `sidecar/src/`)

- **`index.ts`**: servidor JSON-RPC por líneas (ver
  [protocolo](docs/protocolo-sidecar.md) — 26 métodos, watchdog interno
  `withTimeout` por operación). Un browser por proceso.
- **`engine.ts`**: ejecución de las 28 acciones con Playwright, screenshots de
  evidencia en éxito y fallo, runner de bloques (`if/repeat/for_each/run_flow`),
  interpolación de variables. Compartido entre bridge y CLI.
- **`interaction.ts`**: barra flotante inyectada en la página (JS + CSS
  shadcn-like, iconos lucide inline, draggable, posición en sessionStorage).
  Modelo "acción primero, objetivo después": intercepta el próximo clic,
  calcula el selector (`data-testid` → `#id` → CSS corto único → path capado
  a 5 niveles, ignorando el DOM propio), pide valor inline si la acción lo
  requiere (autocompleta asserts con el valor actual), ejecuta el paso real y
  reporta ok/error a la barra. `Esc` cancela.
- **`db.ts`**: acceso del sidecar a la **misma `yatt.db`** (escribe solo
  `sessions` y `baselines`). **`appdb.ts`**: conexión de solo lectura a la BD
  de la **app bajo prueba** (SQLite readonly o Postgres con `BEGIN READ ONLY`,
  guardia `select|with|explain|pragma`).
- **`cli.ts`**: runner headless para CI con flags (`--browser --env
  --override --timeout --app-db --report --json --log`) y exit codes 0/1/2.

### 4. Servidor MCP (`mcp/`)

35 tools + 3 recursos + 5 prompts para asistentes de IA. Habla con el **mismo**
sidecar y la **misma** `yatt.db`; las corridas headless van por el CLI
one-shot. Detalle completo: [docs/mcp-server.md](docs/mcp-server.md).

## Persistencia

- **`yatt.db`** (SQLite, WAL, raíz de datos = `$YATT_ROOT` > repo en dev):
  tablas `tests`, `reports`, `baselines` (PNG blob), `sessions`
  `(name PK, content|png|storage_state, updated_at)`. Fuente de verdad.
- **Espejos** en filesystem (git, CLI, "abrir con el SO"):
  `tests/<name>.yatt.json`, `reports/<name>`, `baselines/<name>.png`. Se
  escriben **junto** a la fila BD, nunca solos. Sesiones: solo BD.
- El esquema está duplicado a mano en Rust, sidecar y MCP — mantenerlos
  sincronizados es un invariante manual.

## Flujos clave

1. **Grabación**: `open` → barra flotante inyectada → acción + clic → el paso
   se ejecuta de verdad → evento `action_captured` → paso agregado/reemplazado
   en el árbol con su estado.
2. **Re-grabado**: `start_grab` → próximo clic → `grab_result {selector}` →
   se parcha el selector y se re-ejecuta al instante.
3. **Preview**: ciclo `preview` / `scroll_by` / `click_at` sobre screenshots
   base64; el clic en la imagen mapea a coordenadas reales del viewport.
4. **Corrida**: runner del frontend (recursivo, respeta pausa/stop/paso-a-paso)
   o CLI headless; cada hoja produce `RunRecord` con evidencia; el reporte
   (JSON + HTML) se persiste en BD + espejo.
5. **Sync ventana↔viewport** (visible + chromium): polling CDP cada 400 ms,
   autocalibración del marco, `setViewportSize` solo con la ventana estable.

## Stack y decisiones

| Capa | Tecnología | Justificación |
|---|---|---|
| Shell desktop | Tauri 2 (Rust) | ligero, filesystem y procesos nativos |
| UI | React 19 + Vite + TS + Tailwind 4 + shadcn/ui | rápido y consistente |
| Motor | Playwright (Node) en sidecar | APIs maduras de selector/assert/screenshot; aislable y reiniciable |
| Comunicación | Tauri IPC + JSON-RPC stdio | separa UI ↔ Rust ↔ Node |
| Persistencia | SQLite (fuente de verdad) + espejos JSON/PNG | universal, versionable, CLI-friendly |
| Reportes | JSON + HTML autocontenido (imgs base64) | sin infraestructura |
| Gestión | Bun | repo estándar |

Decisiones clave:

- **Playwright en sidecar Node, no en Rust**: si Chromium se cuelga, se mata y
  relanza el sidecar sin reiniciar la app.
- **Browser en ventana propia**, no embebido en la webview: un Chromium real no
  se incrusta de forma fiable; en headless la UI vive de la preview.
- **BD fuente de verdad + espejo**: git y CLI siguen funcionando; los espejos
  se re-materializan (`resync`) si falta alguno.
- **Selectores decididos al grabar, no al ejecutar**: robustez en captura,
  ejecución determinística (`page.locator` tal cual).
- **100 % local, sin telemetría**: variables sensibles enmascaradas en logs y
  reportes (RNF-05).

## Despliegue

- **Dev**: `bun tauri dev` (sidecar como hijo con `bun run`, debug con
  `YATT_DEBUG=1`).
- **Build**: `bun tauri build` → instaladores nativos; en empaquetado el
  sidecar es binario (`yatt-sidecar`) junto al ejecutable.
- **CI**: runner headless del CLI (`sidecar/src/cli.ts`) — el equipo usa YATT
  para testear YATT.
