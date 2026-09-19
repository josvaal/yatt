# Formato de tests y reportes — referencia v1

## Archivo de test (`tests/<nombre>.yatt.json`, `schemaVersion: 1`)

La **base SQLite (`yatt.db`) es fuente de verdad**; el archivo JSON es espejo
versionable. Ambos se escriben juntos siempre (invariante de `test_save` /
`upsertTest`).

```jsonc
{
  "schemaVersion": 1,
  "name": "01-login-ciudadano",
  "url": "http://localhost:4200/login",   // URL inicial
  "headless": false,
  "steps": [ /* Step[] (árbol, ver abajo) */ ],
  "variables": [
    { "name": "email", "type": "text",
      "values": { "default": "a@b.dev", "dev": "..." } }
    // type: "text" | "number" | "option" | "file"
    // "options": [...] solo si type === "option"
  ],
  "envs": ["dev", "prod"],                 // entornos adicionales (default implícito)
  "dataset": { "columns": ["usuario"], "rows": [{ "usuario": "ana" }] }  // opcional
}
```

La config de browser (motor, viewport, timezone, geo, sesión) **no** va en el
JSON: se elige al abrir el navegador en la UI. El CLI la recibe por flags y el
runner de sets fuerza headless.

### Paso (Step)

| Campo | Aplica a | Descripción |
|---|---|---|
| `id` | todos | UUID |
| `action` | todos | una de las 28 acciones |
| `selector` / `value` / `attribute` | hojas | objetivo / dato / nombre de atributo |
| `disabled` | todos | paso pausado (se salta en corridas) |
| `label` | todos | etiqueta visible |
| `children` / `elseChildren` | `if` | cuerpo y rama else |
| `times` | `repeat` | iteraciones |
| `list` / `itemVar` | `for_each` | filas de dataset y nombre de la variable de item |
| `flow` / `withVars` | `run_flow` | test sub-flujo y variables a inyectar |
| `baseline` / `tolerance` / `fullPage` | `assert_screenshot` | baseline, % de tolerancia, captura full-page |
| `sql` / `expect` / `timeout` / `interval` | `db_assert`, `db_wait` | consulta y expectativa (`rows`\|`empty`\|`value`) |

### Las 28 acciones

**Interacción** (timeout de acción 5 s): `click`, `dblclick`, `hover`, `type`
(fill), `clear`, `upload` (ruta local al sidecar), `select_option` (por value,
fallback por label), `check`, `press_key`, `wait_visible` (10 s),
`scroll_to_element`.

**Asserts**: `assert_visible`, `assert_hidden`, `assert_text` (**includes**),
`assert_value` (inputValue exacto), `assert_attribute` (exacto),
`assert_screenshot` (mismo tamaño exigido; falla si % de píxeles con canal
diferente >32 supera `tolerance`).

**Navegación / espera**: `goto` (domcontentloaded 30 s), `wait` (ms, default 500),
`screenshot`, `open_tab`, `switch_tab`, `close_tab`.

**Visual**: `capture_screenshot` (crea baseline en BD + espejo `baselines/`),
`assert_screenshot`.

**Estructura** (contenedores): `if` (condición vía `condition`: selector
visible o expresión de variables), `repeat`, `for_each`, `run_flow` (guard de
ciclos, máx. 8 niveles).

**Base de datos**: `db_assert`, `db_wait` (polling, timeout default 10 s,
interval 0.5 s) — sobre la BD de la app bajo prueba.

### Variables e interpolación

- Token: `{{nombre}}` (regex `{{\s*[\w.-]+\s*}}`), válido en `value`,
  `selector`, `attribute` y `sql`. Se resuelve **al ejecutar**, nunca se toca
  el paso.
- Orden de resolución: override de corrida → valor del entorno activo →
  `default` → `""`.
- Nombres válidos: `/^[\w.-]+$/` sin dígito inicial. CSV del dataset: cabecera
  = nombres de variables; celda vacía cae al valor del entorno.
- **Enmascaramiento de sensibles (RNF-05)**: si un error contiene el valor de
  una variable cuyo nombre matchea
  `/(pass|pwd|secret|token|api[_-]?key|clave)/i`, el valor se reemplaza por
  `{{nombre}}` en logs y reportes.

### Importación / exportación

- **Import**: `parseImportedTest` valida `schemaVersion` (entero ≥1; solo ≤1
  soportado, futuras se rechazan), exige `steps[]`, normaliza recursivamente
  garantizando `id`, tolerante con variables/envs/dataset.
- **Export** (RF-24): `buildSpec` genera un `.spec.ts` Playwright o Jest:
  pasos como sentencias reales de Playwright, bloques como control flow
  nativo, sub-flujos como funciones `flow_<name>`, `{{var}}` resueltas en
  runtime con un helper `t(literal, VARS)`.

## Reportes (`reports/<slug>-<YYYYMMDD>-<HHMMSS>.json|.html`)

```jsonc
{
  "kind": "test" | "set",
  "title": "01-login-ciudadano · YATT",
  "testName": "01-login-ciudadano",      // solo kind "test"
  "url": "...", "env": "default", "headless": true,
  "startedAt": "ISO", "finishedAt": "ISO", "durationMs": 4757,
  "ok": 13, "fail": 0, "skipped": 0, "stopped": false,
  "logs": ["..."],                        // logs del sidecar (≤300 líneas)
  "steps": [ /* RunRecord[] */ ],
  "tests": [ /* solo kind "set": {name, ok, ms, fail, stopped, error?, steps[]} */ ]
}
```

`RunRecord`: `{index, action, selector?, value?, attribute?, status:
"ok"|"fail"|"skipped"|"stopped", ms?, error?, screenshot? (PNG base64),
depth?, summary?}` — `summary` describe el desenlace de bloques (p. ej.
`"sí · 2 ok"`).

El **HTML** es autocontenido y oscuro: imágenes base64 embebidas, indentación
por `depth`, `<details>` con logs. Los reportes de set se auto-guardan; los de
test individual se guardan desde la página Ejecución. Generados por
`src/lib/report.ts` (compartido con el MCP).
