import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Ctx } from "../ctx.ts";
import { text } from "./tests.ts";

/**
 * Verificación contra la base de datos de la app bajo prueba: consultas de
 * solo lectura vía el sidecar (YATT_APP_DB / --app-db; SQLite o postgres://).
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
        "Ejecuta una consulta de solo lectura (SELECT/WITH/EXPLAIN/PRAGMA) contra la base de datos de la app bajo prueba (definida con YATT_APP_DB o --app-db; SQLite o postgres://). Devuelve {columns, rows, totalRows}; las filas se recortan a 200.",
      inputSchema: z.object({
        sql: z.string().describe("Consulta SQL de solo lectura (SELECT, WITH, EXPLAIN o PRAGMA)"),
      }),
    },
    async (args) => text((await req("db_query", { sql: args.sql }, 30000)) as object),
  );
}
