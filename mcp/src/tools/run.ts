import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Ctx } from "../ctx.ts";
import { runTestDataset, runTestHeadless } from "../run.ts";
import { coerceOverrides, text } from "./tests.ts";

const browserEnum = z.enum(["chromium", "firefox", "webkit"]).optional().describe("Motor (default chromium)");

export function registerRunTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "test_run",
    {
      description:
        "Corre un test guardado en headless (motor Chromium por defecto) y guarda un reporte en la biblioteca. Parámetros: entorno de variables, overrides por corrida, timeout por paso. Devuelve el resumen con los pasos y el nombre del reporte.",
      inputSchema: z.object({
        name: z.string().describe("Nombre del test guardado"),
        env: z.string().optional().describe('Entorno de variables (default "default")'),
        overrides: z.record(z.string(), z.unknown()).optional().describe("Valores de variables que ganan sobre el entorno"),
        stepTimeoutMs: z.coerce.number().optional().describe("Timeout por paso en ms (default 40000)"),
        browser: browserEnum,
        url: z.string().optional().describe("Sobrescribe la URL inicial"),
        saveReport: z.boolean().optional().describe("Guardar reporte en la biblioteca (default true)"),
      }),
    },
    async (args) => {
      const summary = await runTestHeadless(ctx.store, ctx.root, {
        name: args.name,
        env: args.env,
        overrides: coerceOverrides(args.overrides),
        stepTimeoutMs: args.stepTimeoutMs,
        browser: args.browser,
        url: args.url,
        saveReport: args.saveReport,
      });
      return text(summary);
    },
  );

  server.registerTool(
    "test_run_dataset",
    {
      description:
        "Data-driven: corre un test una vez por fila de overrides y devuelve el resultado de cada fila más totales. No guarda reporte.",
      inputSchema: z.object({
        name: z.string().describe("Nombre del test guardado"),
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe("Lista de filas; una corrida por fila (valores = overrides de variables)"),
        env: z.string().optional(),
        stepTimeoutMs: z.coerce.number().optional(),
        browser: browserEnum,
      }),
    },
    async (args) => {
      const rows = args.rows.map(coerceOverrides);
      const result = await runTestDataset(ctx.store, ctx.root, {
        name: args.name,
        rows,
        env: args.env,
        stepTimeoutMs: args.stepTimeoutMs,
        browser: args.browser,
      });
      return text({
        ...result,
        rows: result.rows.map((r, i) => ({
          row: i + 1,
          overrides: rows[i],
          ok: r.ok,
          fail: r.fail,
          skipped: r.skipped,
          stopped: r.stopped,
          durationMs: r.durationMs,
          passedPct: r.passedPct,
        })),
      });
    },
  );
}