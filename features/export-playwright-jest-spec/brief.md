# Brief — Export a Playwright/Jest (.spec.ts) en MCP y UI

Fecha: 2026-09-18

## Pedido original (verbatim)

> Se podria incluir en yatt del mcp como en la UI que se pueda exportar a playwright o jest con .spec.ts ?

## Requisitos explícitos

1. Poder exportar un test a formato **Playwright** (`.spec.ts`).
2. Poder exportar un test a formato **Jest** (`.spec.ts`).
3. Disponible en el **MCP server** (`mcp/`).
4. Disponible en la **UI** de YATT.

## Decisiones (GATE 1 + ronda 2)

1. **Target Jest = Jest + jest-environment-playwright** (opción a): `describe/it/expect`
   de Jest, navegador vía Playwright (misma librería que ya usa YATT).
2. **Motivo raíz del pedido**: el export actual no se termina usando — el spec generado
   NO compila (TS2353: `id`/`label` embebidos no declarados en `FlowStep`) y es un
   intérprete sobre JSON embebido, difícil de ajustar a mano → la gente escribe los
   specs manualmente. Decidido (opción a): **reescribir el generador a código lineal
   legible** (cada paso = su línea real, sin JSON embebido), con sub-flujos como
   funciones. Cambio estimado ~450 líneas — aprobado por el usuario.
3. **MCP**: parámetro `format: "playwright" | "jest"` (default `playwright`) sobre la
   tool existente `test_export_playwright` — sin breaking change, una sola tool.
4. **UI**: dropdown de formato junto al botón "Exportar código", default Playwright.
