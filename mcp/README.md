# YATT MCP — integración de YATT con IA

Servidor [MCP](https://modelcontextprotocol.io) de YATT: un asistente de IA
(claude, Claude Desktop, Cursor, Zed, cualquier cliente MCP) puede **gestionar
tests, correrlos en headless, leer reportes y controlar un navegador en vivo
viendo screenshots** — todo 100 % local, sin telemetría ni servicios externos.

El server es un cliente del motor existente de YATT (el sidecar Node/Playwright):
no reimplementa nada del runner, reutiliza la misma base de datos (`yatt.db`),
los mismos archivos (`tests/`, `reports/`, `exports/`) y los mismos módulos de
validación/export/reportes del frontend.

## Qué puede hacer (~34 tools)

| Área | Tools |
|---|---|
| **Tests** | `test_list` · `test_get` · `test_create` · `test_update` · `test_delete` · `test_rename` · `test_duplicate` · `test_validate` · `test_export_playwright` |
| **Runner** | `test_run` (headless, env, overrides, reporte) · `test_run_dataset` (data-driven por filas) |
| **Navegador en vivo** | `browser_open` · `browser_close` · `browser_status` · `browser_preview` (**screenshot que la IA ve**) · `browser_eval` (JS) · `browser_run_step` · `browser_condition` · `browser_scroll` · `browser_click_at` · `tab_open/list/switch/close` · `session_save/list/delete` |
| **Reportes** | `report_list` · `report_get` · `report_delete` |
| **Meta** | `ping` · `schema` · `baseline_list` · `baseline_get` (imagen) |

**Recursos**: `yatt://schema` (formato del test), `yatt://tests/{nombre}`,
`yatt://reports/{nombre}`.
**Prompts**: `crear-test`, `diagnosticar-reporte`, `explorar-pagina`, `exportar-spec`.

## Instalación

```bash
cd mcp
bun install
```

El server necesita el repo (motor en `sidecar/`) y los binarios de Chromium de
Playwright ya instalados (`cd sidecar && bunx playwright install chromium`).

## Configurarlo con un cliente MCP

El comando es `bun run /ruta/a/yatt/mcp/src/server.ts` (con `cwd` en `mcp/`
o usando `--root` explícito). El server detecta la raíz del repo automáticamente.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "yatt": {
      "command": "bun",
      "args": ["run", "/home/usuario/Proyectos/yatt/mcp/src/server.ts"],
      "cwd": "/home/usuario/Proyectos/yatt/mcp"
    }
  }
}
```

**Claude Code / Cursor / Zed**: mismo patrón (`command` + `args`).
Si el repositorio está en otra ruta o querés otra raíz de datos:

```json
{ "command": "bun", "args": ["run", "…/mcp/src/server.ts", "--root", "/ruta/al/repo"] }
```

### Modo HTTP (clientes web/remotos)

```bash
bun run mcp/src/server.ts --http --port 3191 [--root /ruta/al/repo]
```

## Uso típico (hablándole a la IA)

> "Creá un test de login contra https://fe.ejemplo.com: abrí el navegador,
> explorá la página, creá el test con test_create y corrélo con test_run.
> Si falla, leé el reporte y corregí."

La IA sigue este flujo por sí sola: `schema` → `browser_open`/`browser_preview`
(ve la página) → `browser_eval` (elige selectores) → `test_create` →
`test_run` → `report_get` en caso de fallo → `test_update` → re-correr.

## Cómo corre los tests

- **Corridas headless**: spawns uno-a-uno del CLI del sidecar (`sidecar/src/cli.ts`),
  aisladas, con timeout por paso y Ctrl+C limpio. El resultado se convierte al
  formato `RunReport` de la app y se guarda en la BD + `reports/<slug>.json|.html`.
- **Navegador en vivo**: un sidecar de larga vida (single-browser) hablado por
  JSON-RPC, igual que la app. Headless por defecto.

## Notas y límites

- **Mientras la app de escritorio está abierta**, los cambios hechos por MCP
  aparecen al recargar/reiniciar (la app no tiene watcher de archivos aún).
- `browser_eval` ejecuta JavaScript arbitrario **sobre la página bajo prueba**:
  es una herramienta local del usuario; no hay egress de red salvo el de la
  propia página bajo prueba.
- El server solo escribe dentro de la raíz de datos (BD, `tests/`, `reports/`,
  `exports/`) y las sesiones/baselines del Sidecar.
- Pasos de estructura (`if`/`repeat`/`for_each`/`run_flow`) se ejecutan con
  `test_run` (el motor), no con `browser_run_step` (que es de hoja).

## Desarrollo

```bash
bun run test/smoke.ts    # smoke end-to-end (spawnea el server con raíz efímera)
bun run typecheck        # tsc del directorio mcp/
```

Estructura:

```
src/
  server.ts      entrada (stdio por defecto; --http, --root)
  root.ts        resolución de la raíz del repo/datos
  db.ts          bún:sqlite + espejos (misma invariante BD+archivo de la app)
  sidecar.ts     cliente JSON-RPC del motor (spawn, cola, timeouts)
  run.ts         runner headless (cli.ts) + dataset + reportes
  schema.ts      documentación del formato (recurso y tool schema)
  tools/         unos tool por área
  resources.ts, prompts.ts
test/smoke.ts    smoke test con Client del SDK
```