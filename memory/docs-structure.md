---
name: docs-structure
description: Estructura de documentación profunda de YATT y dónde documentar cada cosa
type: pattern
---

# Estructura de documentación (creada 2026-09-19)

**What**: Documentación profunda consolidada en 4 archivos: `ARCHITECTURE.md` (raíz, los 4 subsistemas + persistencia + flujos), `docs/protocolo-sidecar.md` (26 métodos JSON-RPC, eventos, CLI), `docs/mcp-server.md` (35 tools, 3 recursos, 5 prompts, arquitectura interna del MCP), `docs/formato-tests-reportes.md` (formato v1 + reportes).

**Why**: El usuario pidió documentación mucho más abarcativa (arquitectura y MCP no estaban documentados en detalle).

**Where**: ARCHITECTURE.md, docs/*.md; enlazados desde README.md, CLAUDE.md y mcp/README.md.

**Learned**:
- El MCP tiene exactamente **35** tools (los READMEs decían "~34").
- El esquema SQLite está triplicado a mano (src-tauri/src/db.rs, sidecar/src/db.ts, mcp/src/db.ts) — invariante manual al tocar el esquema.
- `test_run` del MCP corre por CLI one-shot, NO por el sidecar del browser en vivo.
- Explorar con subagentes sdd-explore en paralelo (core vs MCP) y luego escribir docs dio muy buen resultado.
