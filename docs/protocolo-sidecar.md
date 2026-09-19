# Protocolo del sidecar — JSON-RPC por líneas (stdin/stdout)

El sidecar (`sidecar/src/index.ts`) es un proceso Node/Bun de larga vida que
controla Chromium vía Playwright. Es el **único** componente que toca el
navegador. Habla JSON-RPC por líneas con su host (Rust en la app de escritorio,
o el MCP server en modo navegador en vivo).

- Request: `{"id": 1, "method": "open", "params": {...}}`
- Response: `{"type": "response", "id": 1, "ok": true, "result": {...}}` (o
  `"ok": false, "error": "..."`)
- Eventos push: `{"type": "event", "name": "browser_status", "data": {...}}`

## Ciclo de vida

- **Arranque**: el host lo spawnnea con `YATT_ROOT` (raíz de datos) y cwd =
  `sidecar/`. Orden de candidatos en Rust (`src-tauri/src/sidecar.rs`):
  1. `$YATT_SIDECAR` (binario custom)
  2. binario `yatt-sidecar` junto al ejecutable (build empaquetado)
  3. `bun run sidecar/src/index.ts`
  4. `node sidecar/src/index.ts`
- **Shutdown limpio**: al cerrar stdin (EOF del pipe), SIGTERM o SIGINT, el
  sidecar cierra Chromium, cierra su conexión SQLite y sale con código 0. El
  host usa exactamente esto: `sidecar_stop` cierra stdin, espera 5 s y recién
  entonces `kill`.
- **Respawn automático**: `sidecar_request` en Rust re-spawnea el proceso si
  murió. En el MCP, el primer request tras un crash lo relanza.

## Watchdogs (doble capa)

| Capa | Dónde | Qué hace |
|---|---|---|
| Interna | sidecar, `withTimeout(p, ms, label)` | `Promise.race` por operación: ninguna petición queda colgada sin responder |
| Externa | Rust `sidecar_request` | timeout 900 s para `open` (descarga del motor) y 180 s para el resto; al vencer, el pending se rechaza |

## Métodos (completos)

### Navegador

| Método | Params | Result |
|---|---|---|
| `ping` | — | `{ok, pid}` |
| `open` | `{url?, headless?, viewport?, variables?, session?, browser?, timezoneId?, geolocation?}` | `{open: true}` — cierra browser previo, auto-instala el motor si falta, carga `storageState` de la tabla `sessions`, aplica viewport/tz/geo(+permiso), registra init scripts (toolbar + variables) en el **contexto**, sync ventana↔viewport si es visible+chromium |
| `close` | — | `{open: false}` |
| `status` | — | `{open, browser, url, interaction}` |
| `eval` | `{expression}` | resultado de `page.evaluate` (timeout 8 s) |

### Pasos y grabación

| Método | Params | Result |
|---|---|---|
| `run_step` | `{step, timeoutMs?, vars?}` | `StepResult {ok, error?, ms, screenshot?}` — interpola `{{vars}}`, timeout default 40000 |
| `start_grab` | — | `{active: true}` — arma `window.__yattGrab`; el próximo clic emite `grab_result` |
| `toolbar_vars` | `{variables: string[]}` | `{ok}` — re-registra las variables en la barra flotante en vivo |

### Preview interactiva

| Método | Params | Result |
|---|---|---|
| `preview` | — | `PreviewState {url, title, scrollY, maxScrollY, width, height, screenshot?}` |
| `scroll_by` | `{dx, dy}` | PreviewState (mouse.wheel + 80 ms) |
| `scroll_to` | `{x, y}` | PreviewState (clampeado a scrollWidth/Height) |
| `click_at` | `{x, y}` | PreviewState + `{selector, tag}` — resuelve `selectorAtPoint` **antes** de clicar |
| `window_sync_now` | — | PreviewState |
| `window_resize` | `{width, height}` | PreviewState (CDP `Browser.setWindowBounds`) |

### Pestañas

| Método | Params | Result |
|---|---|---|
| `tab_open` | `{url?}` | `{tabs: TabInfo[]}` |
| `tab_list` | — | `{tabs}` |
| `tab_switch` | `{index}` | `{tabs}` |
| `tab_close` | `{index?}` | `{tabs}` — rechaza cerrar la única pestaña |

### Sesiones y BD

| Método | Params | Result |
|---|---|---|
| `session_save` | `{name}` | `{ok, name}` — `storageState()` → tabla `sessions` |
| `session_list` | — | `string[]` |
| `session_delete` | `{name}` | `{ok}` |
| `condition` | `{selector?, value?, timeoutMs?, intervalMs?}` | `{value, elapsedMs}` — polling; base de los bloques `if` |
| `db_query` | `{sql, db?}` | `{columns, rows (≤200), totalRows}` — **solo lectura** (`select/with/explain/pragma`); `db` = SQLite o `postgres://` de la app bajo prueba |

## Eventos emitidos

| Evento | Data | Cuándo |
|---|---|---|
| `sidecar_ready` | `{pid}` | arranque completo |
| `browser_status` | `{open, headless?, browser?, url?}` | al abrir/cerrar/navegar |
| `action_captured` | `{step, result}` | la barra flotante grabó y ejecutó un paso |
| `grab_result` | `{selector}` | re-grabado: el clic capturó un selector nuevo |
| `tabs_changed` | `{tabs}` | apertura/cierre/cambio de pestaña |
| `log` | `{level, message}` | logs del sidecar |
| `browser_install_started / finished / failed` | — | descarga del motor Playwright |
| `sidecar_error` / `sidecar_exited` | — | emitidos por **Rust** en fallos del proceso |

En Rust todos llegan al frontend por un único canal: `yatt://event`. El sidecar
emite multi-pestaña bindings **por página** (`__yattRecord`, `__yattGrabResult`),
lo que permite saber qué pestaña grabó.

## CLI headless (`sidecar/src/cli.ts`)

El mismo motor expone un CLI para CI:

```bash
bun run sidecar/src/cli.ts run <test.yatt.json> [opciones]
  --browser chromium|firefox|webkit   --headed   --env <nombre>
  --override clave=valor (repetible)  --timeout <segundos>  --url <url>
  --app-db <ruta|postgres://>  --report <out.html>  --json <out.json>  --log
```

- Exit codes: `0` ok · `1` fallos/detenido · `2` uso/archivo inválido.
- Sub-flujos (`run_flow`) se resuelven junto al test o en `tests/` relativo al cwd.
- El JSON de salida es `{meta, ...RunOutcome}` (formato propio del CLI, ≠ reporte de la app).
- El MCP (`test_run`) usa este CLI: spawnea un proceso one-shot por corrida.

## Invariantes

- **Un browser por proceso**: el MCP serializa sus requests con una promesa-chain; la app habla con su propio sidecar dedicado.
- El selector se decide **al grabar** (`data-testid` → `#id` → CSS corto único); al ejecutar se usa tal cual con `page.locator()`.
- Los screenshots de evidencia vuelven base64 en el `StepResult`; en fallo siempre hay evidencia.
