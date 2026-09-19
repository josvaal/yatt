# Plan — Export Playwright/Jest lineal

Generador reescrito a **código lineal legible** (sin JSON embebido ni intérprete),
con salida Playwright (`@playwright/test`) o Jest (`jest-environment-playwright`).

| # | Tarea | Cubre | Test |
|---|-------|-------|------|
| T1 | Reescribir `src/lib/export.ts`: nuevo `buildSpec(doc, loadFlow, format)` con emisión lineal (pasos = sentencias reales, sub-flujos como funciones, `{{var}}` resueltas vía helper `t()`, bloques if/repeat/for_each/run_flow como control flow nativo, pestañas con `let pg`, screenshot/asserts por formato). Elimina `buildPlaywrightSpec` (intérprete). | C3 C6 C7 C8 C10 | script de verificación /tmp: genera ambos formatos para tests reales (simple y con run_flow) y compila con tsc |
| T2 | UI: estado `exportFormat` en `context.tsx`, `handleExport(format)`; Select de formato junto al botón en `editor.tsx` (convención `@/components/ui/select`); i18n es/en. | C4 C5 | build `bun run build` + E2E browser (render del control) |
| T3 | MCP: parámetro `format` (enum, default playwright) en `test_export_playwright`; descripción actualizada; README del MCP. | C3 C9 | `bun run mcp/test/smoke.ts` extendido |
| T4 | Smoke MCP: checks de Jest (describe/it/@jest/globals) y de no-regresión Playwright (@playwright/test). | C1 C3 | smoke.ts verde |
| T5 | E2E MCP punta a punta: export con `write: true` en ambos formatos → archivo existe en `exports/` y compila/parsea. | C3 C10 | evidencia en `features/<slug>/evidence/` |
| T6 | Verificación visual UI (vite + YATT browser): selector visible, opciones, tooltip; medición viewport angosto. | C5 | screenshots `evidence/` |

## Cobertura

- C1 → T4 · C2 → T1+T2 (no-regresión, build) · C3 → T1/T3/T4/T5 · C4 → T2
- C5 → T2/T6 · C6 → T1 · C7 → T1 · C8 → T1 · C9 → T3 · C10 → T1/T5
- Todo caso tiene ≥1 tarea y ≥1 test. Sin casos ❌ previos al cierre.
