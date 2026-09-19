# Verificación — Export Playwright/Jest

## Tabla caso por caso

| ID | Caso | Estado | Evidencia |
|----|------|--------|-----------|
| C1 | Export Playwright MCP (no romper) | ✅ | smoke `test_export_playwright — len=1316` + `export playwright lineal` verde |
| C2 | Export Playwright UI (no romper) | ✅ | `bun run build` (tsc+vite) verde; botón "Exportar código" funciona igual (mismo `export_save` Tauri) |
| C3 | Export Jest por MCP | ✅ | smoke `test_export_playwright format=jest` verde (`@jest/globals` + `describe(/it(`); spec compilado con tsc |
| C4 | Export Jest desde la UI | ✅ | UI: selector en `jest` verificado en browser; handler pasa `format` a `buildSpec`; `export_save` es agnóstico de formato |
| C5 | Elección de formato en la UI | ✅ | E2E browser: dropdown con opciones Playwright/Jest, selección persistida (`value: "jest"`), medición: select 128×28, botón 131×28, sin solaparse |
| C6 | Sub-flujos → funciones en Jest | ✅ | `con-flows.jest.spec.ts` generado desde test con `run_flow` (audit-add-dossier-save) — compila, funciones `flow_*` nombradas |
| C7 | Variables/entorno default | ✅ | `VARS` con defaults + helper `t()` con overloads; interpolación `{{rol}}` visible en spec generado |
| C8 | Acción no soportada | ✅ | generación falla temprano: `Error: acción no soportada en el export: drag` (verificado en script) |
| C9 | Formato inválido en MCP | ✅ | smoke `format inválido` → `MCP error -32602 Input validation error` (zod enum) |
| C10 | El spec generado compila (bug raíz) | ✅ | `tsc --noEmit` OK para los 4 specs (playwright/jest × simple/con-flows) contra tipos reales de playwright; el export VIEJO daba TS2353 en cada paso |
| C11 | Código lineal legible | ✅ | specs en `evidence/`: un `await page.locator(...)` por paso, sin JSON embebido ni intérprete, labels como comentarios |

## Por capa

- **Build front**: `bun run build` (tsc strict + vite) ✅.
- **MCP**: `npm run typecheck` ✅ · `bun run mcp/test/smoke.ts` **TODO VERDE** (incluye 4 checks nuevos de export).
- **Generador**: tsc de los 4 specs generados ✅ (`/tmp/opencode/export-verify/tsconfig.json`, tipos de playwright del sidecar + stub de @jest/globals).
- **E2E UI (YATT browser sobre vite :5199)**: editor con paso → selector de formato visible y funcional (dark y light, desktop y 375px) ✅. Limitación declarada: el click final "Exportar" usa `invoke()` de Tauri, no disponible en Chromium puro — el archivo resultante se verificó por el camino MCP + generación directa con el mismo `buildSpec` que llama la UI (mismo código, mismo resultado).
- **E2E MCP**: `test_export_playwright` con `write: true` escribe `exports/<nombre>.spec.ts` ✅ (regenerado con el código nuevo: `exports/01-login-ciudadano.spec.ts` + `.jest.spec.ts`, copias en `evidence/`).

## Mediciones de navegador (fix visual regla dura)

- Desktop 1280px dark: sin overflow (`scrollWidth == clientWidth == 1280`).
- 375px light: overflow X **preexistente** causado por la barra superior de la app (sw 573px: input de nombre + Guardar + Tests), NO por la fila de export; la fila envuelve bien con `flex-wrap` (select en y=185, mismo renglón del botón).
- Ambos modos de color verificados (dark desktop, light 375px).

## Notas de despliegue

- El servidor MCP de esta sesión sigue corriendo el código viejo (levantó antes del cambio): hay que **reiniciarlo** para que la tool exponga `format`. El smoke valida el código nuevo (spawnea server fresco).
- ⚠️ `fastloop_verify`: `sidecar` falla su tsc por tipos de `playwright-core`/`@types/node` — **preexistente y ajeno** (cero archivos del sidecar tocados: ver `git status`); el sidecar corre TS directo con bun según CLAUDE.md. `mcp` OK, front build OK.

## Cómo reproducir

```bash
bun run build                                   # front
cd mcp && bun run test/smoke.ts                 # MCP + export playwright/jest
# specs generados de muestra: features/export-playwright-jest-spec/evidence/
# UI: bun run dev → editor con ≥1 paso → selector playwright/jest → Exportar código
```
