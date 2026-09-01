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
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import { HELPER_JS } from "./interaction.ts";
import {
  executeLeaf,
  evalConditionOn,
  getDb,
  sanitizeName,
  sessionsDir,
  type Step,
} from "./engine.ts";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let interactionOn = false;
/** Motor (RF-27): chromium (default), firefox o webkit. */
let engineName = "chromium";

// Nombres de variables del editor: se inyectan en la barra flotante para poder
// insertar {{nombre}} al grabar un valor, y se actualizan en vivo con
// `toolbar_vars` sin reabrir el navegador.
let toolbarVars: string[] = [];

// ---- Multi-pestaña (RF-22): `page` es la pestaña activa; el contexto puede
// tener varias (pestañas abiertas por YATT o pop-ups de la app bajo prueba). ----

function allPages(): Page[] {
  return context ? context.pages().filter((p) => !p.isClosed()) : [];
}

function currentPage(): Page | null {
  if (page && !page.isClosed()) return page;
  const ps = allPages();
  return ps.length > 0 ? ps[ps.length - 1] : null;
}

async function tabsPayload() {
  return Promise.all(
    allPages().map(async (p, idx) => ({
      index: idx,
      active: p === page,
      title: await p.title().catch(() => ""),
      url: p.url(),
    })),
  );
}

/** Publica el estado de pestañas (nuevas, cerradas, conmutadas) a la UI. */
function refreshTabs() {
  tabsPayload()
    .then((tabs) => emit("tabs_changed", { tabs }))
    .catch(() => {
      /* contexto cerrado a mitad de camino */
    });
}

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

/** Ejecuta un paso hoja sobre la pestaña activa. El comportamiento vive en el
 *  engine compartido (engine.ts): el mismo código corre en el CLI (RF-28). */
async function executeStep(step: Step, p: Page, withScreenshot: boolean) {
  return executeLeaf(p, step, { screenshot: withScreenshot }, {
    context,
    getCurrent: currentPage,
    setCurrent: (np) => {
      page = np;
    },
    afterTabs: refreshTabs,
    onNewPage: (np) => {
      void exposePageBindings(np);
    },
  });
}

/**
 * Registra el helper como init script del CONTEXTO: Playwright lo ejecuta al
 * inicio de cada navegación de cada página (pestañas y popups), sin carreras de
 * addScriptTag (evita el error "execution context was destroyed"). El segundo
 * script solo propaga la lista de variables, que se re-registra al cambiarla.
 */
function registerToolbarInit() {
  if (!context) return;
  context
    .addInitScript((vars: string[]) => {
      (window as any).__yattVars = vars;
    }, toolbarVars)
    .catch(() => {
      /* registración best-effort; no debe fallar */
    });
  context.addInitScript({ content: HELPER_JS }).catch(() => {
    /* registración best-effort; no debe fallar */
  });
}

/** Bindings por página: el canal desde la página bajo prueba hacia el sidecar.
 *  Se registran por página (no a nivel de contexto) para saber QUÉ pestaña
 *  grabó la acción cuando hay varias. Debe completarse antes de evaluar código
 *  en la página (si no, el primer __yattRecord puede no estar registrado aún). */
function exposePageBindings(p: Page) {
  if ((p as any).__yattBoundPromise) return (p as any).__yattBoundPromise as Promise<void>;
  const prom = (async () => {
    await Promise.all([
      p.exposeFunction("__yattRecord", async (step: unknown) => {
        const s = step as Step;
        const r = await executeStep(s, p, true);
        emit("action_captured", {
          step: { ...s, label: s.label ?? stepLabel(s) },
          result: { ok: r.ok, error: r.error, ms: r.ms },
        });
        return { ok: r.ok, error: r.error };
      }),
      // Selector capturado en modo re-grabado (start_grab); se publica como evento.
      p.exposeFunction("__yattGrabResult", (sel: unknown) => {
        emit("grab_result", { selector: String(sel ?? "") });
      }),
    ]).catch(() => {
      /* registración best-effort: si falla, la pestaña no graba pero no tira el sidecar */
    });
  })();
  (p as any).__yattBoundPromise = prom;
  return prom;
}

/** Hook de cierre de una pestaña: publica la lista actualizada de pestañas. */
function hookPageLifecycle(p: Page) {
  if ((p as any).__yattHooked) return;
  (p as any).__yattHooked = true;
  p.on("close", () => refreshTabs());
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

const ENGINE_LAUNCHERS: Record<string, { launch: typeof chromium.launch; label: string }> = {
  chromium: { launch: chromium.launch.bind(chromium), label: "chromium" },
  firefox: { launch: firefox.launch.bind(firefox), label: "firefox" },
  webkit: { launch: webkit.launch.bind(webkit), label: "webkit" },
};

async function openBrowser(params: {
  url?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  variables?: string[];
  session?: string;
  browser?: string;
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number } | null;
}) {
  await closeBrowser();
  toolbarVars = Array.isArray(params.variables) ? params.variables.map(String) : [];
  engineName = params.browser && params.browser in ENGINE_LAUNCHERS ? params.browser : "chromium";
  browser = await ENGINE_LAUNCHERS[engineName].launch({ headless: params.headless ?? false });
  // Sesión (RF-23): la fuente de verdad es la DB (yatt.db); fallback al fichero
  // legacy sessions/<name>.json pre-migración o si la DB no está disponible.
  const sname = params.session ? sanitizeName(String(params.session)) : "";
  let storageState: string | { cookies: unknown[]; origins: unknown[] } | undefined;
  if (sname) {
    const db = await getDb();
    if (db) {
      const row = db.get("SELECT storage_state FROM sessions WHERE name = ?", [sname]);
      if (row && row.storage_state) {
        try {
          storageState = JSON.parse(String(row.storage_state));
        } catch {
          storageState = undefined;
        }
      }
    }
    if (storageState === undefined) {
      const statePath = join(sessionsDir(), `${sname}.json`);
      if (existsSync(statePath)) storageState = statePath; // Playwright acepta ruta o estado
    }
  }
  context = await browser.newContext({
    viewport: params.viewport ?? { width: 1280, height: 800 },
    ...(storageState ? { storageState } : {}),
    // Entorno simulado (RF-26): zona horaria y geolocalización.
    ...(params.timezoneId ? { timezoneId: params.timezoneId } : {}),
    ...(params.geolocation && typeof params.geolocation.latitude === "number"
      ? { geolocation: params.geolocation, permissions: ["geolocation"] as string[] }
      : {}),
  });

  // El helper como init script del contexto: presente en cada navegación de
  // TODAS las pestañas y popups que abra la app bajo prueba (RF-22).
  registerToolbarInit();

  // Cada página nueva (pestaña o popup) recibe bindings y avisa de su cierre.
  context.on("page", (p) => {
    void exposePageBindings(p).then(() => {
      hookPageLifecycle(p);
      refreshTabs();
    });
  });

  page = await context.newPage();
  await exposePageBindings(page);

  interactionOn = true;
  if (params.url) {
    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } else {
    // Sin URL: fuerza una navegación mínima para que corran los init scripts.
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  }
  // La sincronización de ventana visible usa CDP (solo Chromium).
  if (!params.headless && engineName === "chromium") {
    startResizeSync(page);
  }
  refreshTabs();
  emit("browser_status", { open: true, headless: params.headless ?? false, browser: engineName, url: params.url ?? "" });
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

/**
 * Convierte el error de un launch fallido en texto plano legible. Playwright
 * devuelve carteles ASCII con bordes de caja ("launch: ╔════…║ Host system is
 * missing dependencies…╚════"); aquí se quita el arte ASCII y el prefijo
 * "launch:", para que el banner de la UI muestre la causa real en una línea.
 */
function humanErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lines = raw
    .split("\n")
    .map((l) => l.trim().replace(/^║\s*/, "").replace(/\s*║$/, ""))
    .filter((l) => l && !/^[╔╗╚╝═\s]+$/.test(l));
  return lines.join(" ").replace(/^(browserType\.)?launch:\s*/i, "") || "error desconocido";
}

async function handleRequest(id: number, method: string, params: Record<string, unknown>) {
  try {
    switch (method) {
      case "ping":
        respond(id, true, { result: { ok: true, pid: process.pid } });
        break;
      case "open":
        await openBrowser(params as {
          url?: string;
          headless?: boolean;
          viewport?: { width: number; height: number };
          variables?: string[];
          session?: string;
          browser?: string;
          timezoneId?: string;
          geolocation?: { latitude: number; longitude: number } | null;
        });
        respond(id, true, { result: { open: true } });
        break;
      case "close":
        await closeBrowser();
        respond(id, true, { result: { open: false } });
        break;
      case "run_step": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto (ejecuta 'open' primero)" });
          return;
        }
        const step = params.step as Step;
        const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : 40000;
        const r = await withTimeout(executeStep(step, p, true), timeoutMs, "ejecución del paso");
        respond(id, r.ok, r.ok ? { result: r } : { error: r.error, result: r });
        break;
      }
      case "eval": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto (ejecuta 'open' primero)" });
          return;
        }
        const r = await withTimeout(p.evaluate(String(params.expression ?? "")), 8000, "evaluate de eval");
        respond(id, true, { result: r });
        break;
      }
      case "preview": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto (ejecuta 'open' primero)" });
          return;
        }
        respond(id, true, { result: await previewPayload(p) });
        break;
      }
      case "scroll_by": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await p.mouse.wheel(Number(params.dx ?? 0), Number(params.dy ?? 0));
        await new Promise((r) => setTimeout(r, 80));
        respond(id, true, { result: await previewPayload(p) });
        break;
      }
      case "scroll_to": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await p.evaluate(
          ([px, py]) => {
            const sx = Math.max(0, Math.min(px, document.documentElement.scrollWidth - window.innerWidth));
            const sy = Math.max(0, Math.min(py, document.documentElement.scrollHeight - window.innerHeight));
            window.scrollTo(sx, sy);
          },
          [Number(params.x ?? 0), Number(params.y ?? 0)],
        );
        await new Promise((r) => setTimeout(r, 80));
        respond(id, true, { result: await previewPayload(p) });
        break;
      }
      case "click_at": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await p.mouse.click(Number(params.x ?? 0), Number(params.y ?? 0));
        await new Promise((r) => setTimeout(r, 120));
        respond(id, true, { result: await previewPayload(p) });
        break;
      }
      case "start_grab": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        // El binding __yattGrabResult se registra una sola vez por página
        // (Playwright lo re-aplica tras cada navegación).
        await withTimeout(
          p.evaluate(() => {
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
        if (currentPage()) {
          const p = currentPage()!;
          await withTimeout(
            p.evaluate((list: string[]) => {
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
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        await syncVisibleWindow(p);
        respond(id, true, { result: await previewPayload(p) });
        break;
      }
      case "window_resize": {
        const p = currentPage();
        if (!p || !cdp) {
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
          await syncVisibleWindow(p); // registra el nuevo tamaño
          await new Promise((r) => setTimeout(r, 450));
          await syncVisibleWindow(p); // aplica el viewport tras asentarse
          respond(id, true, { result: await previewPayload(p) });
        } catch (e) {
          respond(id, false, { error: String(e) });
        }
        break;
      }
      case "status":
        respond(id, true, {
          result: { open: !!browser, browser: engineName, url: currentPage()?.url() ?? null, interaction: interactionOn },
        });
        break;

      // ---- Multi-pestaña (RF-22) ----
      case "tab_open": {
        const c = context;
        if (!c) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        const np = await c.newPage();
        await exposePageBindings(np);
        page = np;
        const url = String(params.url ?? "");
        await np.goto(url || "about:blank", { waitUntil: "domcontentloaded", timeout: 30000 });
        refreshTabs();
        respond(id, true, { result: { tabs: await tabsPayload() } });
        break;
      }
      case "tab_list": {
        if (!context) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        respond(id, true, { result: { tabs: await tabsPayload() } });
        break;
      }
      case "tab_switch": {
        const ps = allPages();
        const idx = Number(params.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= ps.length) {
          respond(id, false, { error: `índice de pestaña ${idx} inválido (hay ${ps.length})` });
          return;
        }
        page = ps[idx];
        refreshTabs();
        respond(id, true, { result: { tabs: await tabsPayload() } });
        break;
      }
      case "tab_close": {
        const ps = allPages();
        if (ps.length <= 1) {
          respond(id, false, { error: "no se puede cerrar la única pestaña" });
          return;
        }
        const idx = params.index === undefined ? ps.indexOf(page!) : Number(params.index);
        const target = ps[idx];
        if (!target) {
          respond(id, false, { error: `índice de pestaña ${idx} inválido (hay ${ps.length})` });
          return;
        }
        if (page === target) {
          page = ps.filter((x) => x !== target).pop() ?? null;
        }
        await withTimeout(target.close(), 5000, "cierre de pestaña").catch(() => {});
        refreshTabs();
        respond(id, true, { result: { tabs: await tabsPayload() } });
        break;
      }

      // ---- Condición de `if` (RF-18): existe el elemento, o valor no vacío ----
      case "condition": {
        const p = currentPage();
        if (!p) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        const value = await evalConditionOn(
          p,
          String(params.selector ?? ""),
          String(params.value ?? ""),
        );
        respond(id, true, { result: { value } });
        break;
      }

      // ---- Estado de sesión (RF-23): cookies + localStorage ----
      case "session_save": {
        const c = context;
        if (!c) {
          respond(id, false, { error: "el navegador no está abierto" });
          return;
        }
        const name = sanitizeName(String(params.name ?? ""));
        if (!name) {
          respond(id, false, { error: "falta el nombre de la sesión" });
          return;
        }
        const db = await getDb();
        const state = await c.storageState();
        if (db) {
          db.run(
            "INSERT OR REPLACE INTO sessions (name, storage_state, updated_at) VALUES (?, ?, ?)",
            [name, JSON.stringify(state), Date.now()],
          );
        } else {
          // Legado (sin DB): fichero en sessions/.
          mkdirSync(sessionsDir(), { recursive: true });
          writeFileSync(join(sessionsDir(), `${name}.json`), JSON.stringify(state, null, 2));
        }
        respond(id, true, { result: { ok: true, name } });
        break;
      }
      case "session_list": {
        let names: string[] = [];
        const db = await getDb();
        if (db) {
          names = (db.all("SELECT name FROM sessions ORDER BY name") as { name: unknown }[]).map(
            (r) => String(r.name),
          );
        } else if (existsSync(sessionsDir())) {
          names = readdirSync(sessionsDir())
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.replace(/\.json$/, ""))
            .sort();
        }
        respond(id, true, { result: names });
        break;
      }
      case "session_delete": {
        const name = sanitizeName(String(params.name ?? ""));
        const db = await getDb();
        if (db) {
          db.run("DELETE FROM sessions WHERE name = ?", [name]);
        } else {
          const path = join(sessionsDir(), `${name}.json`);
          if (existsSync(path)) unlinkSync(path);
        }
        respond(id, true, { result: { ok: true } });
        break;
      }
      default:
        respond(id, false, { error: "método desconocido: " + method });
    }
  } catch (err) {
    respond(id, false, { error: humanErrorMessage(err) });
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