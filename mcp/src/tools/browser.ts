import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Ctx } from "../ctx.ts";
import { text } from "./tests.ts";

/** Resultado MCP con una imagen PNG embebida (la IA puede "ver" la página). */
function withImage(meta: unknown, base64: string | undefined) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(meta, null, 2) }];
  const png =
    base64 && base64.length > 0
      ? base64
      : meta && typeof meta === "object" && "screenshot" in meta
        ? String((meta as Record<string, unknown>).screenshot)
        : undefined;
  if (png) content.push({ type: "image", data: png, mimeType: "image/png" });
  return { content };
}

const browserEnum = z.enum(["chromium", "firefox", "webkit"]).optional();

/**
 * Navegador en vivo: un sidecar de larga vida (single-browser) controlado por
 * JSON-RPC, con screenshots que la IA ve. Headless por defecto.
 */
export function registerBrowserTools(server: McpServer, ctx: Ctx): void {
  const req = ctx.sidecar.req.bind(ctx.sidecar) as <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<T>;

  server.registerTool(
    "browser_open",
    {
      description:
        "Abre (o reabre) el navegador controlado. headless=true por defecto; visible solo si hace falta apuntar con la mano.",
      inputSchema: z.object({
        url: z.string().optional().describe("URL inicial (default about:blank)"),
        headless: z.boolean().optional().describe("Modo sin ventana (default true)"),
        viewport: z
          .object({ width: z.coerce.number().optional(), height: z.coerce.number().optional() })
          .optional()
          .describe("Tamaño del viewport (default 1280×800)"),
        browser: browserEnum,
        session: z.string().optional().describe("Nombre de sesión guardada (cookies/localStorage)"),
        timezoneId: z.string().optional(),
        geolocation: z
          .object({ latitude: z.coerce.number(), longitude: z.coerce.number() })
          .optional(),
      }),
    },
    async (args) => {
      const params: Record<string, unknown> = {
        url: args.url ?? "about:blank",
        headless: args.headless !== false,
        variables: [],
      };
      if (args.viewport) params.viewport = args.viewport;
      if (args.browser) params.browser = args.browser;
      if (args.session) params.session = args.session;
      if (args.timezoneId) params.timezoneId = args.timezoneId;
      if (args.geolocation) params.geolocation = args.geolocation;
      const r = await req("open", params);
      return text({ ok: true, ...(r as object) });
    },
  );

  server.registerTool(
    "browser_close",
    {
      description: "Cierra el navegador controlado (limpia la sesión del browser).",
      inputSchema: z.object({}),
    },
    async () => text({ ok: true, ...((await req("close")) as object) }),
  );

  server.registerTool(
    "browser_status",
    {
      description: "Estado del navegador controlado: abierto/cerrado, motor, URL e interacción.",
      inputSchema: z.object({}),
    },
    async () => text(await req("status")),
  );

  server.registerTool(
    "browser_preview",
    {
      description:
        "Captura del viewport actual como imagen PNG (la IA ve la página) + url, título, scroll y dimensiones. Es la herramienta principal de inspección visual.",
      inputSchema: z.object({}),
    },
    async () => {
      const p = (await req("preview")) as Record<string, unknown>;
      const { screenshot, ...meta } = p;
      return withImage(meta, String(screenshot ?? ""));
    },
  );

  server.registerTool(
    "browser_eval",
    {
      description:
        "Ejecuta JavaScript arbitrario en la página actual y devuelve el valor (útil para inspeccionar el DOM, leer textos, contar elementos, probar selectores).",
      inputSchema: z.object({
        expression: z.string().describe("Expresión JS (se evalúa con el resultado devuelto)"),
      }),
    },
    async (args) => {
      const value = await req("eval", { expression: args.expression }, 8000);
      return text({ value: serialize(value) });
    },
  );

  server.registerTool(
    "browser_run_step",
    {
      description:
        "Ejecuta un paso YATT (hoja) en la página actual: click, type, hover, assert_*, goto, wait_visible, etc. Devuelve ok/error, duración y, si falla, un screenshot de evidencia. Pasos de estructura (if/repeat/for_each/run_flow) se corren con test_run, no aquí.",
      inputSchema: z.object({
        step: z
          .record(z.string(), z.unknown())
          .describe("Paso YATT: {action, selector?, value?, attribute?, disabled?}"),
        timeoutMs: z.coerce.number().optional().describe("Timeout en ms (default 40000)"),
      }),
    },
    async (args) => {
      const step = args.step;
      if (!step || typeof step.action !== "string") {
        throw new Error("step debe ser un objeto con action");
      }
      const params = {
        step,
        ...(args.timeoutMs && args.timeoutMs > 0 ? { timeoutMs: args.timeoutMs } : {}),
      };
      try {
        // Step OK: el sidecar responde `result` = StepResult {ok, ms, screenshot?}.
        const r = (await req("run_step", params)) as { ok: boolean; ms?: number; screenshot?: string };
        return withImage(
          { name: step.action, ok: r.ok === true, ms: r.ms },
          String(r.screenshot ?? ""),
        );
      } catch (err) {
        // Step fallido: ok:false con error (+ screenshot de evidencia en data).
        const data = (err as Error & { data?: unknown }).data as
          | { ok?: boolean; error?: string; screenshot?: string }
          | undefined;
        return withImage(
          {
            name: step.action,
            ok: false,
            error: data?.error ?? (err instanceof Error ? err.message : String(err)),
          },
          String(data?.screenshot ?? ""),
        );
      }
    },
  );

  server.registerTool(
    "browser_condition",
    {
      description:
        "Comprueba si existe un elemento en la página (o si se cumple una condición de variable). Devuelve {value: boolean}.",
      inputSchema: z.object({
        selector: z.string().optional().describe("Selector del elemento a comprobar"),
        value: z.string().optional().describe("Alternativa: condición de variable (p. ej. {{estado}} == ok)"),
      }),
    },
    async (args) =>
      text(
        await req("condition", {
          ...(args.selector !== undefined ? { selector: args.selector } : {}),
          ...(args.value !== undefined ? { value: args.value } : {}),
        }),
      ),
  );

  server.registerTool(
    "browser_scroll",
    {
      description:
        "Desplaza la página verticalmente (dy en píxeles, positivo hacia abajo) y devuelve la preview actualizada.",
      inputSchema: z.object({ dy: z.coerce.number().describe("Píxeles a desplazar") }),
    },
    async (args) => {
      const p = (await req("scroll_by", { dy: args.dy })) as Record<string, unknown>;
      const { screenshot, ...meta } = p;
      return withImage(meta, String(screenshot ?? ""));
    },
  );

  server.registerTool(
    "browser_click_at",
    {
      description:
        "Clic en coordenadas del viewport (x, y en píxeles CSS). Devuelve la preview actualizada. Preferí browser_run_step con selector para pasos reproducibles.",
      inputSchema: z.object({ x: z.coerce.number(), y: z.coerce.number() }),
    },
    async (args) => {
      const p = (await req("click_at", { x: args.x, y: args.y })) as Record<string, unknown>;
      const { screenshot, ...meta } = p;
      return withImage(meta, String(screenshot ?? ""));
    },
  );

  server.registerTool(
    "tab_open",
    {
      description: "Abre una pestaña nueva (opcionalmente con URL) y devuelve la lista de pestañas.",
      inputSchema: z.object({ url: z.string().optional() }),
    },
    async (args) => text((await req("tab_open", args.url ? { url: args.url } : {})) as object),
  );

  server.registerTool(
    "tab_list",
    {
      description: "Lista las pestañas abiertas: índice, activa, título y URL.",
      inputSchema: z.object({}),
    },
    async () => text((await req("tab_list")) as object),
  );

  server.registerTool(
    "tab_switch",
    {
      description: "Cambia a la pestaña con el índice dado (0-based).",
      inputSchema: z.object({ index: z.coerce.number().describe("Índice de la pestaña (ver tab_list)") }),
    },
    async (args) => text((await req("tab_switch", { index: args.index })) as object),
  );

  server.registerTool(
    "tab_close",
    {
      description: "Cierra una pestaña (por índice; sin índice cierra la activa).",
      inputSchema: z.object({ index: z.coerce.number().optional() }),
    },
    async (args) =>
      text((await req("tab_close", args.index !== undefined ? { index: args.index } : {})) as object),
  );

  server.registerTool(
    "session_save",
    {
      description:
        "Guarda el estado de sesión actual (cookies/localStorage) con un nombre, para tests con autenticación previa.",
      inputSchema: z.object({ name: z.string() }),
    },
    async (args) => text((await req("session_save", { name: args.name })) as object),
  );

  server.registerTool(
    "session_list",
    {
      description: "Lista las sesiones guardadas.",
      inputSchema: z.object({}),
    },
    async () => text({ sessions: await req("session_list") }),
  );

  server.registerTool(
    "session_delete",
    {
      description: "Borra una sesión guardada.",
      inputSchema: z.object({ name: z.string() }),
    },
    async (args) => text((await req("session_delete", { name: args.name })) as object),
  );
}

/** Serializa cualquier valor devuelto por eval a un texto seguro y acotado. */
function serialize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[profundidad máxima]";
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string") return (value as string).length > 8000 ? (value as string).slice(0, 8000) + "…" : value;
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function") return "[función]";
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => serialize(v, depth + 1));
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[k] = serialize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}