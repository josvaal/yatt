import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Ctx } from "../ctx.ts";
import { text } from "./tests.ts";

/**
 * Verificación contra la base de datos de la app bajo prueba: consultas de
 * solo lectura vía el sidecar. La conexión se pasa por el parámetro `db`
 * (ruta de SQLite o URL "file:" / postgres://); como alternativa se puede
 * preconfigurar el sidecar con YATT_APP_DB / --app-db.
 */
export function registerDbTools(server: McpServer, ctx: Ctx): void {
  const req = ctx.sidecar.req.bind(ctx.sidecar) as <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<T>;

  server.registerTool(
    "db_query",
    {
      description:
        "Ejecuta una consulta de solo lectura (SELECT/WITH/EXPLAIN/PRAGMA) contra la base de datos de la app bajo prueba. Pasá la conexión en `db` (ruta de SQLite o URL 'file:' / postgres://); si no, se usa YATT_APP_DB/--app-db del sidecar. Devuelve {columns, rows, totalRows}; las filas se recortan a 200.",
      inputSchema: z.object({
        sql: z.string().describe("Consulta SQL de solo lectura (SELECT, WITH, EXPLAIN o PRAGMA)"),
        db: z
          .string()
          .optional()
          .describe("Conexión: ruta de SQLite o URL 'file:' / postgres:// (ganá sobre la config global)"),
      }),
    },
    async (args) => text((await req("db_query", { sql: args.sql, db: args.db }, 30000)) as object),
  );
}
