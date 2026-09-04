import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Ctx } from "../ctx.ts";
import { SCHEMA_DOC } from "../schema.ts";
import { text } from "./tests.ts";

export function registerMetaTools(server: McpServer, ctx: Ctx): void {
  const { store } = ctx;

  server.registerTool(
    "ping",
    {
      description: "Comprueba que el servidor MCP y el motor (sidecar) responden.",
      inputSchema: z.object({}),
    },
    async () => {
      const sidecar = await ctx.sidecar
        .req("ping", {}, 15000)
        .then(() => true)
        .catch(() => false);
      return text({ ok: true, pid: process.pid, sidecarAlive: sidecar, root: ctx.root });
    },
  );

  server.registerTool(
    "schema",
    {
      description:
        "Documentación completa del formato de test de YATT (esquema v1): campos, acciones, variables, dataset y guía de uso. Leela antes de crear tests.",
      inputSchema: z.object({}),
    },
    async () => text(SCHEMA_DOC),
  );

  server.registerTool(
    "baseline_list",
    {
      description: "Lista las imágenes de referencia guardadas (asserts visuales).",
      inputSchema: z.object({}),
    },
    async () => {
      const baselines = store.baselineList();
      return text({ count: baselines.length, baselines });
    },
  );

  server.registerTool(
    "baseline_get",
    {
      description: "Devuelve una imagen de referencia como PNG (para comparar visualmente).",
      inputSchema: z.object({ name: z.string() }),
    },
    async (args) => {
      const png = store.baselineGet(args.name);
      if (!png) throw new Error(`la imagen base "${args.name}" no existe`);
      return {
        content: [
          { type: "text" as const, text: `Imagen base: ${args.name}` },
          { type: "image" as const, data: toBase64(png), mimeType: "image/png" },
        ],
      };
    },
  );
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}