# Servidor MCP de YATT — referencia completa

Servidor MCP en `mcp/src/` (TypeScript, corre directo con bun) que expone YATT
a asistentes de IA: gestión de tests, runner headless, navegador en vivo con
screenshots visibles, sesiones, baselines y reportes. 100 % local.

## Arranque y transporte

```bash
cd mcp && bun install
bun run mcp/src/server.ts [--http] [--port 3191] [--root /ruta/al/repo]
```

- **stdio** por defecto (Claude Desktop/Code, Cursor, opencode...).
- **`--http`**: HTTP streamable en `127.0.0.1:3191`, sesión por UUID, CORS
  permisivo (`*`), headers soportados: `Content-Type`,
  `MCP-Protocol-Version`, `Mcp-Session-Id`, `Authorization`.
- **Raíz de datos** (`--root` > `$YATT_ROOT` > repo raíz): dónde viven
  `yatt.db`, `tests/`, `reports/`, `exports/`. El motor Playwright siempre se
  toma de `<repo>/sidecar` — la raíz puede ser efímera (smoke tests) sin perder
  el motor.
- Apagado limpio en SIGINT/SIGTERM: cierra sidecar y store.

## Catálogo de tools — 35 en total

### Gestión de tests (`tools/tests.ts`) — 9

| Tool | Params | Devuelve |
|---|---|---|
| `test_list` | — | `{count, tests[]}` |
| `test_get` | `name` | `{name, doc}` — JSON completo (steps, variables, envs, dataset) |
| `test_create` | `content` (string u objeto), `name?`, `overwrite?` | resumen del test creado; valida con `parseImportedTest`; falla si el nombre existe salvo `overwrite` |
| `test_update` | `name`, `content` | reemplazo completo; el test debe existir |
| `test_delete` | `name` | borra fila BD + espejo `tests/<name>.yatt.json` |
| `test_rename` | `name`, `newName` | upsert nuevo + delete viejo (BD y espejos) |
| `test_duplicate` | `name`, `newName?` (default `"<name> (copia)"`) | copia completa |
| `test_validate` | `content`, `name?` | `{ok, doc}` o `{ok:false, error}` — valida sin guardar |
| `test_export_playwright` | `name`, `format?` (`playwright`\|`jest`), `write?` | genera `.spec.ts`; con `write: true` lo guarda en `exports/<name>.spec.ts`; sub-flujos `run_flow` embebidos como funciones |

### Runner (`tools/run.ts`) — 2

| Tool | Params | Devuelve |
|---|---|---|
| `test_run` | `name`, `env?` (default), `overrides?`, `stepTimeoutMs?` (40000), `browser?`, `url?`, `saveReport?` (true) | `RunSummary {ok, fail, skipped, stopped, durationMs, passedPct, steps[], report?}` — el reporte queda en BD + `reports/` |
| `test_run_dataset` | `name`, `rows[]` (≥1), `env?`, `stepTimeoutMs?`, `browser?` | resultado por fila; los overrides de cada fila se mergean sobre los base; **no guarda reporte** |

`overrides` pisan las variables del entorno elegido. Los valores se
coercionan a string para el CLI (`--override k=v`).

### Navegador en vivo (`tools/browser.ts`) — 16

Todas delegan al sidecar de larga vida vía JSON-RPC. Las que devuelven preview
emiten bloques de contenido `image` (PNG base64) para que la IA **vea** la página.

| Tool | Params | Notas |
|---|---|---|
| `browser_open` | `url?`, `headless?` (true), `viewport?` (1280×800), `browser?`, `session?`, `timezoneId?`, `geolocation?` | restaura sesión guardada si se pide |
| `browser_close` | — | limpia la sesión del browser |
| `browser_status` | — | estado del navegador/motor |
| `browser_preview` | — | **tool principal de inspección visual**: meta (url, título, scroll, dimensiones) + PNG |
| `browser_eval` | `expression` | JS en la página; serialización defensiva (profundidad ≤4, strings ≤8000 chars, arrays/objetos capados a 100); timeout 8 s |
| `browser_run_step` | `step {action, selector?, value?...}`, `timeoutMs?` (40000), `vars?` | **solo pasos hoja** (los contenedores van por `test_run`); interpola `{{vars}}`; en fallo devuelve screenshot de evidencia |
| `browser_condition` | `selector?` **o** `value?` (condición de variable `{{estado}} == ok`), `timeoutMs?` (0 = un chequeo), `intervalMs?` (300) | `{value, elapsedMs}` |
| `browser_scroll` | `dy` | scroll + preview actualizada |
| `browser_click_at` | `x, y` (px CSS) | devuelve el selector resuelto (testid → id → CSS) + preview; preferir `browser_run_step` para pasos reproducibles |
| `tab_open` / `tab_list` / `tab_switch` / `tab_close` | `url?` / — / `index` / `index?` | gestión de pestañas |
| `session_save` / `session_list` / `session_delete` | `name` / — / `name` | cookies + localStorage como `storage_state` en BD |

### Reportes (`tools/reports.ts`) — 3

| Tool | Params | Devuelve |
|---|---|---|
| `report_list` | — | `{count, reports[]}` DESC |
| `report_get` | `name` | `RunReport` parseado — `steps[]` con `status ok/fail/skipped`, `error`, `ms` |
| `report_delete` | `name` | BD + archivo `reports/<name>` |

### BD de la app bajo prueba (`tools/db.ts`) — 1

| Tool | Params | Devuelve |
|---|---|---|
| `db_query` | `sql` (solo SELECT/WITH/EXPLAIN/PRAGMA), `db?` (ruta SQLite o `postgres://`; si falta usa `YATT_APP_DB`/`--app-db` del sidecar) | `{columns, rows (≤200), totalRows}` — escrituras rechazadas |

### Meta y baselines (`tools/meta.ts`) — 4

| Tool | Params | Devuelve |
|---|---|---|
| `ping` | — | `{ok, pid, sidecarAlive, root}` |
| `schema` | — | documentación completa del formato de test v1 (markdown) |
| `baseline_list` | — | `{count, baselines[]}` |
| `baseline_get` | `name` | texto + bloque `image` PNG — para comparación visual |

## Recursos MCP — 3

| URI | SIRVE |
|---|---|
| `yatt://schema` | documentación del formato de test v1 |
| `yatt://tests/{name}` | JSON crudo del test guardado |
| `yatt://reports/{name}` | JSON crudo del reporte |

## Prompts — 5

| Prompt | Guía |
|---|---|
| `crear-test` | ciclo completo: schema → explorar con browser → armar doc → `test_validate` → `test_create` → `test_run` → corregir con `report_get` hasta verde |
| `diagnosticar-reporte` | causa raíz del primer fallo → verificar en vivo → propuesta de fix exacto → `test_update` con aprobación |
| `explorar-pagina` | mapeo de UI: open → preview + scroll → recetas `browser_eval` → mapa con selectores robustos recomendados |
| `exportar-spec` | exportar tests a `exports/<name>.spec.ts` |
| `bateria-de-flujos` | batería reutilizable: login una vez con `{{usuario}}`, `session_save` por rol, sub-flujos con `run_flow` + `withVars`, datos con dataset/overrides. Regla de oro: a la 3ª repetición en vivo, test guardado |

## Arquitectura interna

```
asistente IA ──stdio/HTTP── MCP server (mcp/src/server.ts)
                               │ Ctx {root, store, sidecar}
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                           ▼
  Store (bun:sqlite)   SidecarClient (larga vida)   CLI one-shot (por test_run)
  yatt.db (BD+espejo)  browser en vivo JSON-RPC     `cli.ts run` headless
```

- **`test_run` NO usa el sidecar del browser en vivo**: spawnea un proceso CLI
  one-shot por corrida (`bun run src/cli.ts run ...` con cwd `sidecar/` y
  `YATT_ROOT`), lee el outcome de un tmp file y lo mapea al `RunReport` de la
  app (reutiliza `src/lib/report.ts`). Exit codes 0/1 son normales (verde/rojo).
- **Sidecar de navegador**: se spawnea lazy al primer request y queda listo al
  evento `sidecar_ready` (timeout 20 s). Todos los requests pasan por una
  cadena de promesas: es **single-browser**, no se intercalan llamadas. Un
  crash falla los waiters pendientes y el próximo request lo relanza.
- **DB**: el mismo `yatt.db` de la app de escritorio (4 tablas, WAL,
  busy_timeout 5000). Escrituras serializadas por una write-chain propia con el
  invariante **BD = fuente de verdad, archivo = espejo** (escritura conjunta
  atómica). `sanitizeName` replica la sanitización de Rust. El MCP nunca
  escribe `sessions`/`baselines` — esas las maneja el sidecar.
- **Concurrencia con la app de escritorio**: WAL tolera procesos simultáneos,
  pero la app no tiene file-watcher: los cambios hechos por MCP solo aparecen
  en la UI tras recargar/reiniciar.

## Smoke test

`mcp/test/smoke.ts`: ~40 verificaciones end-to-end (inventario de tools,
validación, CRUD + rename/duplicate/export, browser en vivo con imágenes,
`db_query` read-only, pestañas, sesiones, corrida headless + ciclo de vida de
reportes, baselines).

```bash
cd mcp && bun run test/smoke.ts
```
