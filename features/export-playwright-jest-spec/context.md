# Contexto — Export Playwright/Jest

## Descubrimiento central: Playwright YA existe en ambos lados

Un solo generador compartido alimenta a UI y MCP:

- **Generador**: `src/lib/export.ts` → `buildPlaywrightSpec(doc, loadFlow)` (RF-24).
  Genera un spec TS autocontenido: pasos embebidos como datos + `runSteps` con switch
  por acción; soporta if/repeat/for_each/run_flow/pestañas/screenshots/asserts;
  embebe sub-flujos (RF-21) con detección de ciclos; variables resueltas a entorno default.
- **UI**: `src/pages/editor.tsx` (~L670) botón "Exportar código" (`editor.export`) →
  `handleExport` en `src/editor/context.tsx` (~L1249) → `buildPlaywrightSpec` →
  `exportPlaywright(`${safe}.spec.ts`, spec)` (`src/lib/yatt.ts` L254, comando Tauri
  `export_save` en `src-tauri/src/storage.rs` L112) → escribe `exports/<nombre>.spec.ts`.
- **MCP**: tool `test_export_playwright` (`mcp/src/tools/tests.ts` L210) importa el MISMO
  `buildPlaywrightSpec` desde `../../../src/lib/export.ts`; con `write: true` escribe en
  `exports/<nombre>.spec.ts`.

## Qué falta (gap real)

1. **Jest**: no existe ningún generador Jest. Decisión clave: Jest puro no maneja browser;
   el target realista es Jest + preset Playwright (`jest-playwright/jest-environment-playwright`,
   `expect` de jest o `expect-playwright`).
2. **Elección de formato**: UI tiene un solo botón fijo a Playwright; MCP tiene una tool fija.
   Falta el parámetro/selector de formato (`playwright | jest`).

## Archivos relevantes

| Archivo | Rol |
|---|---|
| `src/lib/export.ts` | Generador compartido `buildPlaywrightSpec` — punto de extensión |
| `src/editor/context.tsx` L1249-1263 | `handleExport` de la UI |
| `src/pages/editor.tsx` L670-680 | Botón "Exportar código" |
| `src/lib/yatt.ts` L254 | `exportPlaywright` → Tauri `export_save` (generic: guarda cualquier content) |
| `src/lib/i18n.tsx` L60-62, L293-295 | Strings es/en del export |
| `src-tauri/src/storage.rs` L110-120 | `export_save` (no requiere cambios: es agnóstico de formato) |
| `mcp/src/tools/tests.ts` L210-240 | Tool `test_export_playwright` |
| `mcp/test/smoke.ts` L173-174 | Smoke que verifica `@playwright/test` en el spec |

## Convenciones aplicables (CLAUDE.md)

- No tocar `src-tauri/gen/`, `dist/`, `node_modules/`, ni espejos (`tests/`, `reports/`,
  `baselines/`, `sessions/`) — `exports/` sí es destino legítimo de la app.
- Frontend compila con `bun run build` (tsc + vite); MCP/sidecar corren TS directo con bun.
- La BD es fuente de verdad; `exports/` es artefacto portátil solo-fichero (sin espejo BD,
  igual que hoy con Playwright).
- Comentarios/artefactos técnicos en español neutro (así está escrito `export.ts`).

## E2E: limitación conocida

La UI es Tauri; `exportPlaywright` usa `invoke()` que NO existe en Chromium puro.
`bun run dev` (vite) sirve la UI en browser pero el click en "Exportar" terminaría en
error de Tauri API. La verificación E2E navegable real requiere la app Tauri; en browser
se puede verificar hasta el botón/selector de formato (render + tooltip), no el archivo
resultante. Alternativa E2E real: el MCP (`test_export_*`) sí es verificable punta a punta
(headless, sin Tauri).
