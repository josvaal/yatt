/**
 * Sidecar de YATT — controla Chromium vía Playwright.
 *
 * Protocolo: JSON-RPC ligero por líneas (newline-delimited) sobre stdin/stdout
 * con el proceso host (Rust/Tauri):
 *
 *   request  → {"id": 1, "method": "open", "params": {...}}   (stdin)
 *   response → {"type":"response","id":1,"ok":true,"result":{...}}  (stdout)
 *   response → {"type":"response","id":1,"ok":false,"error":"..."}  (stdout)
 *   event    → {"type":"event","name":"action_captured","data":{...}} (stdout, push)
 *
 * Ejecutar en dev:  bun run sidecar/index.ts   (o node, que soporta type stripping)
 */

import { createInterface } from "node:readline/promises";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { HELPER_JS, type Step } from "./interaction.ts";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let interactionOn = false;

// Nombres de variables del editor: se inyectan en la barra flotante para poder
// insertar {{nombre}} al grabar un valor, y se actualizan en vivo con
// `toolbar_vars` sin reabrir el navegador.
let toolbarVars: string[] = [];

// Sincronización ventana → viewport (solo modo visible): cuando el usuario
// redimensiona la ventana de Chromium, el layout de la página debe seguirlo.
let resizeTimer: ReturnType<typeof setInterval> | null = null;
let cdp: CDPSession | null = null;
let prevOuterW = 0;
let prevOuterH = 0;
let appliedOuterW = 0;
let appliedOuterH = 0;
let chromeW = 0;
let chromeH = 0;

function send(obj: unknown) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {
    /* el host cerró el pipe (la app está saliendo); se ignora */
  }
}

// Si la app muere antes de cerrar el pipe de forma ordenada, no tire el sidecar.
process.stdout.on("error", () => {});

function respond(id: number, ok: boolean, extra: Record<string, unknown> = {}) {
  send({ type: "response", id, ok, ...extra });
}

function emit(name: string, data: Record<string, unknown>) {
  send({ type: "event", name, data });
}

function stepLabel(step: Step): string {
  const target = step.selector ? ` · ${step.selector}` : "";
  return `${step.action}${step.value !== undefined ? ` "${step.value}"` : ""}${target}`;
}

async function executeStep(step: Step, p: Page, withScreenshot: boolean) {
  const t0 = Date.now();
  const fail = async (err: unknown) => {
    let screenshot: string | null = null;
    if (withScreenshot) {
      try {
        screenshot = (await p.screenshot({ type: "png" })).toString("base64");
      } catch {
        screenshot = null;
      }
    }
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ok: false, error: msg, ms: Date.now() - t0, ...(screenshot ? { screenshot } : {}) };
  };

  try {
    switch (step.action) {
      case "click":
        await p.locator(step.selector!).click({ timeout: 5000 });
        break;
      case "dblclick":
        await p.locator(step.selector!).dblclick({ timeout: 5000 });
        break;
      case "hover":
        await p.locator(step.selector!).hover({ timeout: 5000 });
        break;
      case "type":
        await p.locator(step.selector!).fill(step.value ?? "", { timeout: 5000 });
        break;
      case "clear":
        await p.locator(step.selector!).clear({ timeout: 5000 });
        break;
      case "upload": {
        const path = step.value ?? "";
        if (!path) throw new Error("upload: falta la ruta del archivo (usa una variable tipo 'archivo' con {{nombre}})");
        await p.locator(step.selector!).setInputFiles(path, { timeout: 5000 });
        break;
      }
      case "select_option":
        try {
          await p.locator(step.selector!).selectOption(step.value ?? "", { timeout: 5000 });
        } catch {
          // Fallback: interpretar el valor capturado como texto visible de la opción.
          await p.locator(step.selector!).selectOption({ label: step.value ?? "" }, { timeout: 5000 });
        }
        break;
      case "check":
        await p.locator(step.selector!).check({ timeout: 5000 });
        break;
      case "press_key":
        if (step.selector) {
          await p.locator(step.selector).press(step.value ?? "Enter", { timeout: 5000 });
        } else {
          await p.keyboard.press(step.value ?? "Enter");
        }
        break;
      case "wait_visible":
        await p.locator(step.selector!).waitFor({ state: "visible", timeout: 10000 });
        break;
      case "scroll_to_element": {
        // Scroll determinista: sincroniza en el momento y verifica el resultado,
        // sin la espera de "reposo" de scrollIntoViewIfNeeded (frágil).
        const inView = await p
          .locator(step.selector!)
          .evaluate((el: Element) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            return r.top >= 0 && r.bottom <= vh && r.width > 0;
          })
          .catch(() => false);
        if (!inView) throw new Error(`scroll al elemento: no se pudo llevar a la vista (${step.selector})`);
        break;
      }
      case "assert_visible": {
        const visible = await p.locator(step.selector!).isVisible().catch(() => false);
        if (!visible) throw new Error(`assert visible: el elemento no está visible (${step.selector})`);
        break;
      }
      case "assert_hidden": {
        const visible = await p.locator(step.selector!).isVisible().catch(() => false);
        if (visible) throw new Error(`assert oculto: el elemento está visible (${step.selector})`);
        break;
      }
      case "assert_text": {
        const text = (await p.locator(step.selector!).textContent({ timeout: 5000 }).catch(() => "")) ?? "";
        if (!text.includes(step.value ?? "")) {
          throw new Error(`assert texto: se esperaba "${step.value}" pero el texto es "${text.trim().slice(0, 60)}"`);
        }
        break;
      }
      case "assert_value": {
        const val = await p.locator(step.selector!).inputValue({ timeout: 5000 }).catch(() => "");
        if (val !== step.value) {
          throw new Error(`assert valor: se esperaba "${step.value}" pero el valor es "${val}"`);
        }
        break;
      }
      case "assert_attribute": {
        const attr = await p
          .locator(step.selector!)
          .getAttribute(step.attribute ?? "", { timeout: 5000 })
          .catch(() => null);
        if (attr !== step.value) {
          throw new Error(`assert atributo ${step.attribute ?? "?"}: se esperaba "${step.value}" pero es "${attr ?? "(sin atributo)"}"`);
        }
        break;
      }
      case "goto":
        await p.goto(step.value || "about:blank", { waitUntil: "domcontentloaded", timeout: 30000 });
        break;
      case "wait":
        await p.waitForTimeout(Math.max(0, Number(step.value) || 500));
        break;
      case "screenshot":
        return { ok: true, ms: Date.now() - t0, screenshot: (await p.screenshot({ type: "png" })).toString("base64") };
      default:
        return await fail(new Error("acción desconocida: " + step.action));
    }
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return await fail(err);
  }
}

/**
 * Registra el helper como init script: Playwright lo ejecuta al inicio de cada
 * navegación del frame principal, sin carreras de addScriptTag (evita el error
 * "execution context was destroyed" en páginas que redirigen). El segundo
 * script solo propaga la lista de variables, que se re-registra al cambiarla.
 */
function registerToolbarInit(p: Page) {
  p.addInitScript((vars: string[]) => {
    (window as any).__yattVars = vars;
  }, toolbarVars).catch(() => {
    /* registración best-effort; no debe fallar */
  });
  p.addInitScript({ content: HELPER_JS }).catch(() => {
    /* registración best-effort; no debe fallar */
  });
}

/**
 * Una pasada de sincronización: consulta el tamaño real de la ventana del SO por
 * CDP, descuenta el marco (autocalibrado) y aplica el viewport con
 * `page.setViewportSize` (nativo de Playwright, así screenshot y preview siguen
 * siendo consistentes). Solo aplica cuando la ventana lleva un tick sin cambios,
 * para no pelear con el arrastre del usuario.
 */
async function syncVisibleWindow(p: Page) {
  if (!cdp) return;
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget", {});
    const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
    if (!bounds || bounds.windowState === "minimized") return;
    // La ventana debe estar estable durante al menos un tick.
    if (bounds.width !== prevOuterW || bounds.height !== prevOuterH) {
      prevOuterW = bounds.width;
      prevOuterH = bounds.height;
      return;
    }
    if (bounds.width === appliedOuterW && bounds.height === appliedOuterH) return;
    if (chromeW === 0) {
      const vp = p.viewportSize();
      chromeW = Math.max(0, bounds.width - (vp?.width ?? bounds.width));
      chromeH = Math.max(0, bounds.height - (vp?.height ?? bounds.height));
    }
    const w = Math.max(320, bounds.width - chromeW);
    const h = Math.max(200, bounds.height - chromeH);
    await p.setViewportSize({ width: w, height: h });
    appliedOuterW = bounds.width;
    appliedOuterH = bounds.height;
  } catch {
    /* la ventana aún no está disponible; se reintenta en el siguiente tick */
  }
}

function startResizeSync(p: Page) {
  stopResizeSync();
  p.context()
    .newCDPSession(p)
    .then((s) => {
      cdp = s;
    })
    .catch(() => {
      cdp = null;
    });
  resizeTimer = setInterval(() => syncVisibleWindow(p), 400);
}

function stopResizeSync() {
  if (resizeTimer) {
    clearInterval(resizeTimer);
    resizeTimer = null;
  }
  cdp = null;
  prevOuterW = 0;
  prevOuterH = 0;
  appliedOuterW = 0;
  appliedOuterH = 0;
}

async function openBrowser(params: { url?: string; headless?: boolean; viewport?: { width: number; height: number }; variables?: string[] }) {
  await closeBrowser();
  toolbarVars = Array.isArray(params.variables) ? params.variables.map(String) : [];
  browser = await chromium.launch({ headless: params.headless ?? false });
  context = await browser.newContext({
    viewport: params.viewport ?? { width: 1280, height: 800 },
  });
  page = await context.newPage();

  // El helper como init script: presente en cada navegación del frame principal.
  registerToolbarInit(page);

  // El canal desde la página: __yattRecord(step) → se ejecuta y se publica el evento.
  await page.exposeFunction("__yattRecord", async (step: unknown) => {
    const s = step as Step;
    const r = await executeStep(s, page!, true);
    emit("action_captured", { step: { ...s, label: s.label ?? stepLabel(s) }, result: { ok: r.ok, error: r.error, ms: r.ms } });
    return { ok: r.ok, error: r.error };
  });
  // Selector capturado en modo re-grabado (start_grab); se publica como evento.
  await page.exposeFunction("__yattGrabResult", (sel: unknown) => {
    emit("grab_result", { selector: String(sel ?? "") });
  });

  interactionOn = true;
  if (params.url) {
    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } else {
    // Sin URL: fuerza una navegación mínima para que corran los init scripts.
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  }
  if (!params.headless) {
    startResizeSync(page);
  }
  emit("browser_status", { open: true, headless: params.headless ?? false, url: params.url ?? "" });
}

async function closeBrowser() {
  stopResizeSync();
  if (browser) {
    await withTimeout(browser.close(), 6000, "cierre del browser").catch(() => {
      emit("log", { level: "warn", message: "browser.close() tardó más de 6s; se fuerza el estado cerrado" });
    });
  }
  browser = null;
  context = null;
  page = null;
  interactionOn = false;
  emit("browser_status", { open: false });
}

/** Payload de la preview: screenshot del viewport + estado de scroll y url. */
async function previewPayload(p: Page) {
  const info = await withTimeout(
    p.evaluate(() => ({
      url: location.href,
      title: document.title,
      scrollY: window.scrollY,
      maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      width: window.innerWidth,
      height: window.innerHeight,
    })),
    5000,
    "evaluate de preview",
  ).catch(() => ({
    url: "",
    title: "",
    scrollY: 0,
    maxScrollY: 0,
    width: 1280,
    height: 800,
  }));
  const shot = await withTimeout(p.screenshot({ type: "png" }), 10000, "screenshot de preview").catch(() => null);
  return { ...info, screenshot: shot ? shot.toString("base64") : null };
}

/** Watchdog: garantiza que una operación nunca deje el protocolo sin respuesta. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout interno: ${label}`)), ms),
    ),
  ]);
}

async function handleRequest(id: number, method: string, params: Record<string, unknown>) {
  try {
    switch (method) {
      case "ping":
        respond(id, true, { result: { ok: true, pid: process.pid } });
        break;
      case "open":
        await openBrowser(params as { url?: string; headless?: boolean; viewport?: { width: number; height: number }; variables?: string[] });
        respond(id, true, { result: { open: true } });
        break;
      case "close":
        await closeBrowser();
        respond(id, true, { result: { open: false } });
        break;
      case "run_step": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto (ejecuta 'open' primero)" });
          return;
        }
        const step = params.step as Step;
        const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : 40000;
        const r = await withTimeout(executeStep(step, page, true), timeoutMs, "ejecución del paso");
        respond(id, r.ok, r.ok ? { result: r } : { error: r.error, result: r });
        break;
      }
      case "eval": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto (ejecuta 'open' primero)" });
          return;
        }
        const r = await withTimeout(page.evaluate(String(params.expression ?? "")), 8000, "evaluate de eval");
        respond(id, true, { result: r });
        break;
      }
      case "preview": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto (ejecuta 'open' primero)" });
          return;
        }
        respond(id, true, { result: await previewPayload(page) });
        break;
      }
      case "scroll_by": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await page.mouse.wheel(Number(params.dx ?? 0), Number(params.dy ?? 0));
        await new Promise((r) => setTimeout(r, 80));
        respond(id, true, { result: await previewPayload(page) });
        break;
      }
      case "scroll_to": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await page.evaluate(
          ([px, py]) => {
            const sx = Math.max(0, Math.min(px, document.documentElement.scrollWidth - window.innerWidth));
            const sy = Math.max(0, Math.min(py, document.documentElement.scrollHeight - window.innerHeight));
            window.scrollTo(sx, sy);
          },
          [Number(params.x ?? 0), Number(params.y ?? 0)],
        );
        await new Promise((r) => setTimeout(r, 80));
        respond(id, true, { result: await previewPayload(page) });
        break;
      }
      case "click_at": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await page.mouse.click(Number(params.x ?? 0), Number(params.y ?? 0));
        await new Promise((r) => setTimeout(r, 120));
        respond(id, true, { result: await previewPayload(page) });
        break;
      }
      case "start_grab": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        // El binding __yattGrabResult se registra una sola vez en openBrowser
        // (Playwright lo re-aplica tras cada navegación).
        await withTimeout(
          page.evaluate(() => {
            (globalThis as any).__yattGrab = true;
            if ((globalThis as any).__yattSetStatus) {
              (globalThis as any).__yattSetStatus("re-grabando: clic en el elemento (Esc cancela)", "warn");
            }
          }),
          5000,
          "evaluate de start_grab",
        );
        respond(id, true, { result: { active: true } });
        break;
      }
      case "toolbar_vars": {
        toolbarVars = Array.isArray(params.variables) ? params.variables.map(String) : [];
        // Para las próximas navegaciones: re-registra el init de variables.
        if (context) {
          context
            .addInitScript((vars: string[]) => {
              (window as any).__yattVars = vars;
            }, toolbarVars)
            .catch(() => {
              /* registración best-effort */
            });
        }
        if (page) {
          await withTimeout(
            page.evaluate((list: string[]) => {
              if ((globalThis as any).__yattSetVars) {
                (globalThis as any).__yattSetVars(list);
              } else {
                (globalThis as any).__yattVars = list;
              }
            }, toolbarVars),
            5000,
            "evaluate de toolbar_vars",
          ).catch(() => {
            /* el navegador se cerró a mitad de camino */
          });
        }
        respond(id, true, { result: { ok: true } });
        break;
      }
      case "window_sync_now": {
        if (!page) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await syncVisibleWindow(page);
        respond(id, true, { result: await previewPayload(page) });
        break;
      }
      case "window_resize": {
        if (!page || !cdp) {
          respond(id, false, { error: "el navegador visible no está disponible" });
          return;
        }
        try {
          const { windowId } = await cdp.send("Browser.getWindowForTarget", {});
          await cdp.send("Browser.setWindowBounds", {
            windowId,
            bounds: {
              width: Number(params.width),
              height: Number(params.height),
              windowState: "normal",
            },
          });
          await new Promise((r) => setTimeout(r, 400));
          await syncVisibleWindow(page); // registra el nuevo tamaño
          await new Promise((r) => setTimeout(r, 450));
          await syncVisibleWindow(page); // aplica el viewport tras asentarse
          respond(id, true, { result: await previewPayload(page) });
        } catch (e) {
          respond(id, false, { error: String(e) });
        }
        break;
      }
      case "status":
        respond(id, true, { result: { open: !!browser, url: page ? page.url() : null, interaction: interactionOn } });
        break;
      default:
        respond(id, false, { error: "método desconocido: " + method });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    respond(id, false, { error: msg });
  }
}

async function start() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  emit("sidecar_ready", { pid: process.pid });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req: { id?: unknown; method?: unknown; params?: unknown };
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const id = typeof req.id === "number" ? req.id : -1;
    const method = typeof req.method === "string" ? req.method : "";
    const params = (req.params && typeof req.params === "object" ? req.params : {}) as Record<string, unknown>;
    await handleRequest(id, method, params);
  });
  rl.on("close", () => {
    closeBrowser().finally(() => process.exit(0));
  });
}

function shutdown() {
  closeBrowser().finally(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (import.meta.main) {
  start();
}

export { start };