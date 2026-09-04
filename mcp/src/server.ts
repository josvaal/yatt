import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Store } from "./db.ts";
import { SidecarClient } from "./sidecar.ts";
import { resolveRoot } from "./root.ts";
import { registerBrowserTools } from "./tools/browser.ts";
import { registerReportTools } from "./tools/reports.ts";
import { registerRunTools } from "./tools/run.ts";
import { registerTestTools } from "./tools/tests.ts";
import { registerMetaTools } from "./tools/meta.ts";
import { registerResources } from "./resources.ts";
import { registerPrompts } from "./prompts.ts";

/**
 * Servidor MCP de YATT (integracion IA).
 *
 * Uso:
 *   bun run mcp/src/server.ts [--http] [--port 3191] [--root /ruta/al/repo]
 *
 * Transporte stdio por defecto (Claude Desktop, Claude Code, Cursor, etc.).
 * Con --http se sirve streamable HTTP para clientes web/remotos.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const http = args.includes("--http");
  const port = (() => {
    const i = args.indexOf("--port");
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 3191;
  })();
  const rootOverride = (() => {
    const i = args.indexOf("--root");
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  })();

  const root = rootOverride ?? resolveRoot();
  const store = new Store(root);
  const sidecar = new SidecarClient(root);

  const server = new McpServer(
    { name: "yatt", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const ctx = { root, store, sidecar };
  registerMetaTools(server, ctx);
  registerTestTools(server, ctx);
  registerRunTools(server, ctx);
  registerBrowserTools(server, ctx);
  registerReportTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);

  const shutdown = async (code = 0) => {
    try {
      await sidecar.close();
    } catch {
      /* ya cerrado */
    }
    try {
      store.close();
    } catch {
      /* ya cerrado */
    }
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  if (http) {
    const { createServer } = await import("node:http");
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const httpServer = createServer((req, res) => {
      // Clientes locales (web, otros procesos): CORS permisivo.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Authorization",
      );
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      void transport.handleRequest(req, res);
    });
    transport.onclose = () => {
      httpServer.close();
      void shutdown(0);
    };
    await server.connect(transport);
    httpServer.listen(port, "127.0.0.1");
    console.error(`YATT MCP escuchando en http://127.0.0.1:${port} (raíz: ${root})`);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`YATT MCP listo (raíz: ${root})`);
}

main().catch((err) => {
  console.error("YATT MCP falló al arrancar:", err);
  process.exit(1);
});