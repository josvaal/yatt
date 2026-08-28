/**
 * Motor de ejecución compartido del sidecar: ejecuta pasos hoja y bloques
 * (Fase 4: if/repeat/for_each/run_flow) sobre una página de Playwright.
 *
 * Lo usan el bridge JSON-RPC (index.ts) y el CLI headless (cli.ts, RF-28),
 * para que el comportamiento de los pasos sea idéntico en la app y en CI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { BrowserContext, Page } from "playwright";
import { openYattDb, type YattDb } from "./db.ts";

export interface Step {
  id?: string;
  action: string;
  selector?: string;
  value?: string;
  attribute?: string;
  disabled?: boolean;
  label?: string;
  children?: Step[];
  elseChildren?: Step[];
  times?: number;
  list?: string;
  itemVar?: string;
  flow?: string;
  withVars?: Record<string, string>;
  baseline?: string;
  tolerance?: number;
  fullPage?: boolean;
}

// Raíz de datos (baselines/sesiones): Rust la inyecta como YATT_ROOT.
const ROOT = process.env.YATT_ROOT || process.cwd();
export const DATA_ROOT = ROOT;
export const baselinesDir = () => join(ROOT, "baselines");
export const sessionsDir = () => join(ROOT, "sessions");

export function sanitizeName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Almacenamiento (SQLite como fuente de verdad + espejos legacy) ----
let yattDb: YattDb | null = null;

/** Apertura perezosa de la DB del sistema, junto a los datos (YATT_ROOT). */
export async function getDb(): Promise<YattDb | null> {
  if (yattDb) return yattDb;
  try {
    yattDb = await openYattDb(join(ROOT, "yatt.db"));
  } catch (e) {
    yattDb = null;
    console.error("[yatt] no se pudo abrir yatt.db:", e instanceof Error ? e.message : String(e));
  }
  return yattDb;
}

/** Bytes de una imagen base: primero la DB (fuente de verdad), luego el espejo. */
async function baselineBytes(name: string): Promise<Buffer | null> {
  const db = await getDb();
  if (db) {
    const row = db.get("SELECT png FROM baselines WHERE name = ?", [name]);
    if (row && row.png) return Buffer.from(row.png as Uint8Array);
  }
  const basePath = join(baselinesDir(), `${name}.png`);
  if (existsSync(basePath)) return readFileSync(basePath);
  return null;
}

export interface StepResult {
  ok: boolean;
  error?: string;
  ms?: number;
  screenshot?: string;
}

/** Contexto de la pestaña activa (RF-22): para abrir/conmutar pestañas. */
export interface LeafContext {
  context: BrowserContext | null;
  getCurrent(): Page | null;
  setCurrent(p: Page): void;
  /** Avisa a la UI cuando cambió el conjunto de pestañas. */
  afterTabs?(): void;
  /** Hook al crear una pestaña nueva (el bridge registra bindings ahí). */
  onNewPage?(p: Page): void;
}

/** Interpola {{nombre}} con el ámbito de variables dado. */
export function interp(value: string | undefined, vars: Record<string, string>): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

function resolve(step: Step, vars: Record<string, string>): Step {
  return {
    ...step,
    value: interp(step.value, vars),
    selector: interp(step.selector, vars),
    attribute: interp(step.attribute, vars),
  };
}

/** Condición de `if` (RF-18): existe el elemento, o valor no vacío. */
export async function evalConditionOn(p: Page, selector?: string, value?: string): Promise<boolean> {
  const sel = (selector ?? "").trim();
  if (sel) return (await p.locator(sel).count()) > 0;
  const v = (value ?? "").trim();
  return v !== "" && v !== "false" && v !== "0";
}

/** Ejecuta una acción hoja sobre la página y devuelve el resultado (con
 *  screenshot de evidencia en caso de fallo cuando se pide). */
export async function executeLeaf(
  p: Page,
  step: Step,
  opts: { screenshotOnError?: boolean },
  ctx: LeafContext,
): Promise<StepResult> {
  const t0 = Date.now();
  const fail = async (err: unknown) => {
    let screenshot: string | null = null;
    if (opts.screenshotOnError) {
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
        if (!path) {
          throw new Error("upload: falta la ruta del archivo (usa una variable tipo 'archivo' con {{nombre}})");
        }
        await p.locator(step.selector!).setInputFiles(path, { timeout: 5000 });
        break;
      }
      case "select_option":
        try {
          await p.locator(step.selector!).selectOption(step.value ?? "", { timeout: 5000 });
        } catch {
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
          throw new Error(
            `assert atributo ${step.attribute ?? "?"}: se esperaba "${step.value}" pero es "${attr ?? "(sin atributo)"}"`,
          );
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

      // ---- Multi-pestaña (RF-22) ----
      case "open_tab": {
        if (!ctx.context) throw new Error("sin navegador abierto");
        const np = await ctx.context.newPage();
        ctx.setCurrent(np);
        ctx.onNewPage?.(np);
        if (step.value) await np.goto(step.value, { waitUntil: "domcontentloaded", timeout: 30000 });
        else await np.goto("about:blank", { waitUntil: "domcontentloaded" });
        ctx.afterTabs?.();
        break;
      }
      case "switch_tab": {
        const ps = ctx.context?.pages().filter((x) => !x.isClosed()) ?? [];
        const idx = Number(step.value);
        if (!Number.isInteger(idx) || idx < 0 || idx >= ps.length) {
          throw new Error(`cambiar pestaña: índice ${step.value} inválido (hay ${ps.length})`);
        }
        ctx.setCurrent(ps[idx]);
        ctx.afterTabs?.();
        break;
      }
      case "close_tab": {
        const ps = ctx.context?.pages().filter((x) => !x.isClosed()) ?? [];
        if (ps.length <= 1) throw new Error("no se puede cerrar la única pestaña");
        const idx = step.value === undefined || step.value === "" ? ps.indexOf(p) : Number(step.value);
        const target = ps[idx];
        if (!target) throw new Error(`cerrar pestaña: índice ${idx} inválido (hay ${ps.length})`);
        if (p === target) {
          ctx.setCurrent(ps.filter((x) => x !== target).pop() ?? ps[0]);
        }
        await target.close().catch(() => {});
        ctx.afterTabs?.();
        break;
      }

      // ---- Asserts visuales (RF-20): imagen base + tolerancia ----
      case "capture_screenshot": {
        const name = sanitizeName(step.value || step.baseline);
        if (!name) throw new Error("capturar imagen base: falta el nombre");
        const buf = await p.screenshot({ type: "png", fullPage: !!step.fullPage });
        const db = await getDb();
        if (db) {
          db.run("INSERT OR REPLACE INTO baselines (name, png, updated_at) VALUES (?, ?, ?)", [
            name,
            buf,
            Date.now(),
          ]);
        }
        // Espejo: lo necesitan el spec exportado a Playwright y la revisión manual.
        mkdirSync(baselinesDir(), { recursive: true });
        writeFileSync(join(baselinesDir(), `${name}.png`), buf);
        break;
      }
      case "assert_screenshot": {
        const name = sanitizeName(step.baseline || step.value);
        if (!name) throw new Error("verificar imagen: falta el nombre de la imagen base");
        const baseBytes = await baselineBytes(name);
        if (!baseBytes) {
          throw new Error(`verificar imagen: falta baselines/${name}.png (ejecuta antes “capturar imagen base”)`);
        }
        const tol = Math.max(0, Number(step.tolerance) || 0) / 100;
        const base = PNG.sync.read(baseBytes);
        const shot = PNG.sync.read(await p.screenshot({ type: "png", fullPage: !!step.fullPage }));
        if (base.width !== shot.width || base.height !== shot.height) {
          throw new Error(
            `verificar imagen: el tamaño cambió (base ${base.width}x${base.height}, actual ${shot.width}x${shot.height})`,
          );
        }
        const a = base.data;
        const b = shot.data;
        let diffPx = 0;
        const total = shot.width * shot.height;
        for (let i = 0; i < a.length; i += 4) {
          const dr = Math.abs(a[i] - b[i]);
          const dg = Math.abs(a[i + 1] - b[i + 1]);
          const db = Math.abs(a[i + 2] - b[i + 2]);
          if (dr > 32 || dg > 32 || db > 32) diffPx++;
        }
        const ratio = diffPx / total;
        if (ratio > tol) {
          throw new Error(
            `verificar imagen: ${(ratio * 100).toFixed(2)}% de píxeles distintos (tolerancia ${(tol * 100).toFixed(2)}%)`,
          );
        }
        break;
      }
      default:
        return await fail(new Error("acción desconocida: " + step.action));
    }
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return await fail(err);
  }
}

// ---- Runner de pruebas completo (usado por el CLI, RF-28) ----

export interface RunRecord {
  index: number;
  action: string;
  selector?: string;
  value?: string;
  attribute?: string;
  status: "ok" | "fail" | "skipped" | "stopped";
  ms?: number;
  error?: string;
  screenshot?: string;
  depth?: number;
  summary?: string;
}

export interface RunOutcome {
  records: RunRecord[];
  ok: number;
  fail: number;
  skipped: number;
  stopped: boolean;
}

export interface RunOptions {
  /** Resuelve un sub-flujo (RF-21) por nombre; null si no existe. */
  flows?: (name: string) => Promise<{ steps?: Step[] } | null>;
  /** Timeout por paso en ms (default 40000). */
  stepTimeoutMs?: number;
  /** Como el runner se detiene limpiamente si devuelve true (Ctrl+C en CI). */
  shouldStop?: () => boolean;
}

/** Ejecuta una lista de pasos (con bloques) contra `holder.page` (la pestaña
 *  activa puede cambiar con open_tab/switch_tab). Acumula el reporte. */
export async function runTestSteps(
  holder: { page: Page },
  steps: Step[],
  vars: Record<string, string>,
  opts: RunOptions = {},
): Promise<RunOutcome> {
  const timeoutMs = opts.stepTimeoutMs && opts.stepTimeoutMs > 0 ? opts.stepTimeoutMs : 40000;

  const state: RunOutcome & { counter: number } = { records: [], ok: 0, fail: 0, skipped: 0, stopped: false, counter: 0 };

  const leafCtx: LeafContext = {
    context: holder.page.context(),
    getCurrent: () => holder.page,
    setCurrent: (p) => {
      holder.page = p;
    },
  };

  async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout interno: ${label}`)), ms)),
    ]);
  }

  async function runList(list: Step[], scope: Record<string, string>, depth: number, flowStack: string[]) {
    for (const step of list) {
      if (opts.shouldStop?.()) {
        state.stopped = true;
        return;
      }
      const resolved = resolve(step, scope);
      const base: RunRecord = {
        index: ++state.counter,
        action: step.action,
        selector: step.selector,
        value: step.value,
        attribute: step.attribute,
        depth,
        status: "ok",
      };
      if (step.disabled) {
        state.records.push({ ...base, status: "skipped" });
        state.skipped++;
        continue;
      }
      if (step.action === "if") {
        let truthy: boolean;
        try {
          truthy = await evalConditionOn(holder.page, resolved.selector, resolved.value);
        } catch (err) {
          const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
          state.records.push({
            ...base,
            status: "fail",
            error: `si: no se pudo evaluar (${msg})`,
          });
          state.fail++;
          continue;
        }
        const branch = truthy ? step.children ?? [] : step.elseChildren ?? [];
        if (branch.length === 0) {
          state.records.push({ ...base, summary: `${truthy ? "condición verdadera" : "condición falsa"} · sin pasos en la rama` });
          state.ok++;
          continue;
        }
        const beforeOk = state.ok;
        const beforeFail = state.fail;
        await runList(branch, scope, depth + 1, flowStack);
        state.records.push({
          ...base,
          summary: `${truthy ? "sí" : "si no"} · ${state.ok - beforeOk} ok${state.fail - beforeFail ? ` · ${state.fail - beforeFail} fallo` : ""}`,
        });
        state.ok++;
        continue;
      }
      if (step.action === "repeat") {
        const times = Math.max(0, Math.floor(Number(step.times) || 0));
        if (times === 0) {
          state.records.push({ ...base, summary: "0 repeticiones" });
          state.ok++;
          continue;
        }
        let iterOk = 0;
        let iterFail = 0;
        for (let i = 1; i <= times; i++) {
          if (opts.shouldStop?.()) {
            state.stopped = true;
            break;
          }
          const bOk = state.ok;
          const bFail = state.fail;
          await runList(step.children ?? [], scope, depth + 1, flowStack);
          iterOk += state.ok - bOk;
          iterFail += state.fail - bFail;
        }
        state.records.push({ ...base, summary: `×${times} · ${iterOk} ok${iterFail ? ` · ${iterFail} fallo` : ""}` });
        state.ok++;
        continue;
      }
      if (step.action === "for_each") {
        const listVal = (interp(step.list, scope) ?? "").trim();
        const items = listVal.split(",").map((s) => s.trim()).filter(Boolean);
        if (items.length === 0) {
          state.records.push({ ...base, summary: "lista vacía · 0 iteraciones" });
          state.ok++;
          continue;
        }
        if (!step.itemVar) {
          state.records.push({ ...base, status: "fail", error: "falta la variable del item" });
          state.fail++;
          continue;
        }
        let iterOk = 0;
        let iterFail = 0;
        for (const item of items) {
          if (opts.shouldStop?.()) {
            state.stopped = true;
            break;
          }
          const bOk = state.ok;
          const bFail = state.fail;
          await runList(step.children ?? [], { ...scope, [step.itemVar]: item }, depth + 1, flowStack);
          iterOk += state.ok - bOk;
          iterFail += state.fail - bFail;
        }
        state.records.push({ ...base, summary: `${items.length} ítem(s) · ${iterOk} ok${iterFail ? ` · ${iterFail} fallo` : ""}` });
        state.ok++;
        continue;
      }
      if (step.action === "run_flow") {
        const flowName = (interp(step.flow, scope) ?? "").trim();
        if (!flowName) {
          state.records.push({ ...base, status: "fail", error: "falta el nombre del sub-flujo" });
          state.fail++;
          continue;
        }
        if (flowStack.includes(flowName)) {
          state.records.push({ ...base, status: "fail", error: `flujo circular: ${flowName}` });
          state.fail++;
          continue;
        }
        if (!opts.flows) {
          state.records.push({ ...base, status: "fail", error: `no hay resolutor de sub-flujos para "${flowName}"` });
          state.fail++;
          continue;
        }
        let fdoc: { steps?: Step[] } | null;
        try {
          fdoc = await opts.flows(flowName);
        } catch (err) {
          const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
          state.records.push({ ...base, status: "fail", error: `no se pudo leer el sub-flujo "${flowName}": ${msg}` });
          state.fail++;
          continue;
        }
        if (!fdoc) {
          state.records.push({ ...base, status: "fail", error: `no se pudo leer el sub-flujo "${flowName}"` });
          state.fail++;
          continue;
        }
        // Variables del flujo: se enriquecen con el mapeo withVars de este paso.
        const fvars: Record<string, string> = { ...scope };
        for (const [k, src] of Object.entries(step.withVars ?? {})) {
          fvars[k] = /^\{\{[\w.-]+\}\}$/.test(src)
            ? interp(src, scope) ?? ""
            : Object.prototype.hasOwnProperty.call(scope, src)
              ? scope[src]
              : src;
        }
        const bOk = state.ok;
        const bFail = state.fail;
        await runList(fdoc.steps ?? [], fvars, depth + 1, [...flowStack, flowName]);
        state.records.push({ ...base, summary: `sub-flujo "${flowName}" · ${state.ok - bOk} ok${state.fail - bFail ? ` · ${state.fail - bFail} fallo` : ""}` });
        state.ok++;
        continue;
      }

      // Hoja: ejecutar contra la pestaña activa.
      const r = await withTimeout(executeLeaf(holder.page, resolved, { screenshotOnError: true }, leafCtx), timeoutMs, "ejecución del paso");
      if (r.ok) {
        state.ok++;
        state.records.push({ ...base, status: "ok", ms: r.ms });
      } else {
        state.fail++;
        state.records.push({ ...base, status: "fail", ms: r.ms, error: r.error, screenshot: r.screenshot });
      }
    }
  }

  await runList(steps, vars, 0, []);
  return state;
}