# YATT — guía rápida para agentes de IA

YATT (Yet Another Testing Tool) es una app de escritorio (Tauri + React) para
crear tests de UI señalando acciones sobre un Chromium real; los tests se
guardan como JSON (`tests/<nombre>.yatt.json`, `schemaVersion: 1`) con espejo
en la base SQLite `yatt.db`.

## MCP server (integración de IA con YATT)

Este repo tiene un **servidor MCP** listo en `mcp/` que expone la herramienta
a asistentes: gestión de tests, runner headless y un **navegador en vivo con
screenshots visibles para la IA** (~34 tools, recursos y prompts).

- Instalación: `cd mcp && bun install`
- Para conectar este agente (u otro cliente MCP) al server:

```bash
bun run /ruta/al/repo/mcp/src/server.ts --root /ruta/al/repo
```

- Manual completo, configs para Claude Desktop / Claude Code / Cursor y el
  catálogo de tools: **`mcp/README.md`**.
- Smoke test end-to-end: `cd mcp && bun run test/smoke.ts` (40 verificaciones).

## Cómo trabajar con YATT desde un agente

1. Si el usuario pide crear/editar tests YATT o explorar una web para testear,
   **usá el MCP server** (`bun run mcp/src/server.ts`) en lugar de editar
   archivos a mano: la tool `schema` documenta el formato exacto, `test_validate`
   valida antes de guardar y `test_run` produce reportes diagnosticables.
2. Regla de oro del formato: la BD es fuente de verdad y `tests/*.yatt.json`
   es el espejo versionable; ambos se escriben juntos (invariante de `test_save`).
3. No toques `src-tauri/gen/`, `dist/`, `node_modules/` ni el contenido de las
   carpetas espejo (`tests/`, `reports/`, `baselines/`, `sessions/`) directamente.
4. El runner real vive en `sidecar/` (Node/Playwright, JSON-RPC por stdio).
   El CLI headless: `bun run sidecar/src/cli.ts run tests/<nombre>.yatt.json`.
5. El frontend compila con `bun run build`; el sidecar y el MCP corren TS
   directo con bun (sin build).