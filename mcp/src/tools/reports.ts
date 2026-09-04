import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Ctx } from "../ctx.ts";
import { text } from "./tests.ts";

export function registerReportTools(server: McpServer, ctx: Ctx): void {
  const { store } = ctx;

  server.registerTool(
    "report_list",
    {
      description: "Lista los reportes de corrida guardados (nombres <slug>.json y <slug>.html).",
      inputSchema: z.object({}),
    },
    async () => {
      const reports = store.reportList();
      return text({ count: reports.length, reports });
    },
  );

  server.registerTool(
    "report_get",
    {
      description:
        "Devuelve el contenido de un reporte (JSON analizable). Para diagnosticar fallos, el reporte tiene steps[] con status ok/fail, error y ms.",
      inputSchema: z.object({
        name: z.string().describe('Nombre del reporte (ver report_list, p. ej. "mi-test-YATT-20260902-101500.json")'),
      }),
    },
    async (args) => {
      const name = store.reportGet(args.name);
      if (name === null) throw new Error(`el reporte "${args.name}" no existe (usá report_list)`);
      return text({ name: args.name, report: JSON.parse(name) });
    },
  );

  server.registerTool(
    "report_delete",
    {
      description: "Borra un reporte guardado (BD + archivo en reports/).",
      inputSchema: z.object({ name: z.string() }),
    },
    async (args) => {
      if (store.reportGet(args.name) === null) throw new Error(`el reporte "${args.name}" no existe`);
      await store.deleteReport(args.name);
      return text({ ok: true, deleted: args.name });
    },
  );
}