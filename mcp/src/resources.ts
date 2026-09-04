import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Ctx } from "./ctx.ts";
import { SCHEMA_DOC } from "./schema.ts";

/** Recursos MCP: contenido que el cliente puede leer como contexto. */
export function registerResources(server: McpServer, ctx: Ctx): void {
  const { store } = ctx;

  server.resource(
    "schema",
    "yatt://schema",
    { description: "Documentación del formato de test de YATT (esquema v1)", mimeType: "text/markdown" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: SCHEMA_DOC, mimeType: "text/markdown" }],
    }),
  );

  server.resource(
    "test",
    new ResourceTemplate("yatt://tests/{name}", { list: undefined }),
    { description: "Contenido JSON de un test guardado", mimeType: "application/json" },
    async (uri, variables) => {
      const name = String(variables.name);
      const content = store.testGet(name);
      if (content === null) throw new Error(`el test "${name}" no existe`);
      return { contents: [{ uri: uri.href, text: content, mimeType: "application/json" }] };
    },
  );

  server.resource(
    "report",
    new ResourceTemplate("yatt://reports/{name}", { list: undefined }),
    { description: "Reporte JSON de una corrida (steps con status/error/ms)", mimeType: "application/json" },
    async (uri, variables) => {
      const name = String(variables.name);
      const content = store.reportGet(name);
      if (content === null) throw new Error(`el reporte "${name}" no existe`);
      return { contents: [{ uri: uri.href, text: content, mimeType: "application/json" }] };
    },
  );
}