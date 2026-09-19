# Casos — Export Playwright/Jest

| ID | Caso | Fuente | Comportamiento esperado | Verificación | Tipo | Estado |
|----|------|--------|------------------------|--------------|------|
| C1 | Export Playwright por MCP (ya existe, no romper) | pedido | `test_export_playwright` sigue generando spec con `@playwright/test` | `mcp/test/smoke.ts` (ya lo cubre) | unit | ✅ |
| C2 | Export Playwright desde la UI (ya existe, no romper) | pedido | Botón "Exportar código" genera `exports/<nombre>.spec.ts` Playwright | build + manual/E2E limitado | e2e | ✅ |
| C3 | Export Jest por MCP | pedido | Tool MCP genera spec Jest (.spec.ts) válido: `describe/it/expect`, imports de jest, mismas acciones soportadas que Playwright | smoke MCP: el spec generado contiene `describe(`/`it(`/`expect` y compila sintácticamente | unit | ✅ |
| C4 | Export Jest desde la UI | pedido | La UI permite elegir formato y genera `exports/<nombre>.spec.ts` en Jest | build + verificación en app Tauri | e2e | ✅ |
| C5 | Elección de formato en la UI | pedido | El usuario puede elegir playwright vs jest antes de exportar (selector/segundo botón); default no rompe el flujo actual | E2E en browser (render del control) | e2e | ✅ |
| C6 | Test con sub-flujos (run_flow) se exporta a Jest | checklist | Sub-flujos embebidos como datos, con detección de ciclo (mismo comportamiento que Playwright) | unit sobre generador Jest con test que tiene run_flow | unit | ✅ |
| C7 | Test con variables/entorno default | checklist | `{{var}}` interpoladas con valores del entorno default en el spec Jest | unit del generador | unit | ✅ |
| C8 | Acción no soportada en export Jest | checklist | Error claro "acción no soportada en el export" (paridad con Playwright) | unit del generador | unit | ✅ |
| C9 | Formato inválido/desconocido en MCP tool | checklist | Feedback temprano: error de validación del enum `format` | unit MCP (validación de args) | unit | ✅ |
| C10 | El spec generado COMPILA (bug raíz descubierto: TS2353 por `id`/`label` no declarados) | descubierto-diagnóstico | `tsc --noEmit` sobre el spec generado Playwright no da errores de tipos | tsc contra tipos de playwright del sidecar | unit | ✅ |
| C11 | Código lineal legible (decisión GATE: reescritura) | decisión-usuario | Cada paso emite su sentencia real; sin JSON embebido ni intérprete; sub-flujos como funciones nombradas | inspección del spec generado + compilación | unit | ✅ |
