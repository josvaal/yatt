/**
 * Export de un test YATT a código Playwright o Jest (RF-24).
 *
 * Genera un spec TypeScript lineal y legible: cada paso se emite como su
 * sentencia real (`await page.locator(...).click()`), los bloques
 * if/repeat/for_each/run_flow como control flow nativo y los sub-flujos
 * (RF-21) como funciones nombradas. Es un punto de partida sólido para CI:
 * se puede ajustar a mano.
 *
 * Formatos:
 * - "playwright": test runner oficial (@playwright/test).
 * - "jest": Jest + jest-environment-playwright (page/browser globales).
 */

import type { Step, TestFile } from "@/lib/yatt";
import { ENV_DEFAULT, resolveVars } from "@/lib/vars";

export type ExportFormat = "playwright" | "jest";

const js = (s: string) => JSON.stringify(s);

/** Sanitiza un nombre a identificador TS seguro para funciones de sub-flujo. */
const flowFn = (name: string) =>
  "flow_" + (name || "flujo").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();

/** Normaliza un nombre de baseline/captura. */
const shotName = (s: Step) =>
  ((s.baseline ?? s.value ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "captura");

/** Emisor de líneas con indentación. */
class Writer {
  private out: string[] = [];
  private depth = 0;
  push(line = "") {
    this.out.push(line.length ? "  ".repeat(this.depth) + line : "");
  }
  indent(fn: () => void) {
    this.depth++;
    fn();
    this.depth--;
  }
  text() {
    return this.out.join("\n");
  }
}

interface GenCtx {
  format: ExportFormat;
  /** Expresión de vars vigente en el ámbito de emisión ("VARS" o "vars"). */
  varsExpr: string;
  /** Página activa ("page" o "pg" si el test usa pestañas). */
  page: string;
  /** URL del test (fallback de goto sin valor). */
  url: string;
}

/** Expresión literal para un valor con `{{var}}` resueltas en runtime. */
function valExpr(raw: string | undefined, ctx: GenCtx): string {
  if (raw === undefined) return "undefined";
  const lit = js(raw);
  return /\{\{[\w.-]+\}\}/.test(raw) ? `t(${lit}, ${ctx.varsExpr})` : lit;
}

/** Como valExpr, pero con fallback literal cuando el valor falta (evita `x ?? y` inalcanzable). */
function valExprOr(raw: string | undefined, fallback: string, ctx: GenCtx): string {
  return raw === undefined ? js(fallback) : valExpr(raw, ctx);
}

/** Emite las sentencias de un paso (hoja o bloque) al writer. */
function emitStep(w: Writer, s: Step, ctx: GenCtx) {
  const pg = ctx.page;
  const sel = () => valExpr(s.selector, ctx);
  const loc = () => `${pg}.locator(${sel()})`;
  const comment = s.label ? `// ${s.label}\n` : "";
  const emit = (line: string) => {
    if (comment) w.push();
    w.push(line);
  };

  switch (s.action) {
    case "if": {
      if (comment) w.push();
      w.push(`{`);
      w.indent(() => {
        if (s.selector) {
          w.push(`const cond = (await ${pg}.locator(${sel()}).count()) > 0;`);
        } else {
          w.push(`const cond = !!${valExpr(s.value, ctx)} && ${valExpr(s.value, ctx)} !== "false" && ${valExpr(s.value, ctx)} !== "0";`);
        }
        w.push(`if (cond) {`);
        w.indent(() => emitSteps(w, s.children ?? [], ctx));
        if ((s.elseChildren ?? []).length > 0) {
          w.push(`} else {`);
          w.indent(() => emitSteps(w, s.elseChildren ?? [], ctx));
        }
        w.push(`}`);
      });
      w.push(`}`);
      break;
    }
    case "repeat": {
      if (comment) w.push();
      w.push(`{`);
      w.indent(() => {
        w.push(`const times = Math.max(0, Math.floor(Number(${valExpr(s.times != null ? String(s.times) : undefined, ctx)}) || 0));`);
        w.push(`for (let i = 0; i < times; i++) {`);
        w.indent(() => emitSteps(w, s.children ?? [], ctx));
        w.push(`}`);
      });
      w.push(`}`);
      break;
    }
    case "for_each": {
      if (comment) w.push();
      const itemVar = s.itemVar || "item";
      w.push(`{`);
      w.indent(() => {
        w.push(`const items = ${valExprOr(s.list, "", ctx)}.split(",").map((x) => x.trim()).filter(Boolean);`);
        w.push(`for (const ${itemVar} of items) {`);
        w.indent(() => {
          w.push(`const vars = { ...${ctx.varsExpr}, ${js(itemVar)}: ${itemVar} };`);
          emitSteps(w, s.children ?? [], { ...ctx, varsExpr: "vars" });
        });
        w.push(`}`);
      });
      w.push(`}`);
      break;
    }
    case "run_flow": {
      if (comment) w.push();
      const fn = flowFn(s.flow ?? "");
      const withVars = Object.entries(s.withVars ?? {});
      if (withVars.length === 0) {
        emit(`await ${fn}(${pg}, ${ctx.varsExpr});`);
      } else {
        w.push(`{`);
        w.indent(() => {
          w.push(`const vars = { ...${ctx.varsExpr} };`);
          for (const [k, src] of withVars) {
            const exact = /^\{\{\s*([\w.-]+)\s*\}\}$/.exec(src ?? "");
            w.push(`vars[${js(k)}] = ${exact ? `${ctx.varsExpr}[${js(exact[1])}]` : valExpr(src, ctx)};`);
          }
          w.push(`await ${fn}(${pg}, vars);`);
        });
        w.push(`}`);
      }
      break;
    }
    case "open_tab":
      emit(`${pg} = await ${pg}.context().newPage();`);
      if (s.value) emit(`await ${pg}.goto(${valExpr(s.value, ctx)}, { waitUntil: "domcontentloaded" });`);
      break;
    case "switch_tab":
      emit(`${pg} = ${pg}.context().pages()[Number(${valExpr(s.value, ctx)})];`);
      break;
    case "close_tab": {
      if (comment) w.push();
      w.push(`{`);
      w.indent(() => {
        w.push(`const pages = ${pg}.context().pages();`);
        w.push(`const idx = ${s.value === undefined || s.value === "" ? `pages.indexOf(${pg})` : `Number(${valExpr(s.value, ctx)})`};`);
        w.push(`const closing = pages[idx];`);
        w.push(`if (closing === ${pg}) ${pg} = pages.filter((x) => x !== closing)[pages.length - 2];`);
        w.push(`await closing.close();`);
      });
      w.push(`}`);
      break;
    }
    case "capture_screenshot":
      emit(`await ${pg}.screenshot({ path: "baselines/${shotName(s)}.png", fullPage: ${!!s.fullPage} });`);
      break;
    case "assert_screenshot":
      if (ctx.format === "playwright") {
        emit(`await expect(${pg}).toHaveScreenshot("${shotName(s)}.png", { maxDiffPixelRatio: ${Math.max(0, Number(s.tolerance) || 0) / 100}, fullPage: ${!!s.fullPage} });`);
      } else {
        // toHaveScreenshot es de @playwright/test; en Jest se guarda la captura y
        // la comparación visual queda como trabajo manual.
        emit(`// Assert visual omitido: toHaveScreenshot requiere @playwright/test.`);
        emit(`await ${pg}.screenshot({ path: "baselines/${shotName(s)}.png", fullPage: ${!!s.fullPage} });`);
      }
      break;
    default: {
      const lines: string[] = [];
      switch (s.action) {
        case "click": lines.push(`await ${loc()}.click({ timeout: 5000 });`); break;
        case "dblclick": lines.push(`await ${loc()}.dblclick({ timeout: 5000 });`); break;
        case "hover": lines.push(`await ${loc()}.hover({ timeout: 5000 });`); break;
        case "type": lines.push(`await ${loc()}.fill(${valExpr(s.value, ctx)}, { timeout: 5000 });`); break;
        case "clear": lines.push(`await ${loc()}.clear({ timeout: 5000 });`); break;
        case "upload": lines.push(`await ${loc()}.setInputFiles(${valExprOr(s.value, "", ctx)}, { timeout: 5000 });`); break;
        case "select_option": lines.push(`await ${loc()}.selectOption(${valExpr(s.value, ctx)});`); break;
        case "check": lines.push(`await ${loc()}.check({ timeout: 5000 });`); break;
        case "press_key":
          if (s.selector) lines.push(`await ${loc()}.press(${valExpr(s.value, ctx) === "undefined" ? `"Enter"` : valExpr(s.value, ctx)}, { timeout: 5000 });`);
          else lines.push(`await ${pg}.keyboard.press(${valExpr(s.value, ctx) === "undefined" ? `"Enter"` : valExpr(s.value, ctx)});`);
          break;
        case "wait_visible": lines.push(`await ${loc()}.waitFor({ state: "visible", timeout: 10000 });`); break;
        case "scroll_to_element": lines.push(`await ${loc()}.scrollIntoViewIfNeeded();`); break;
        case "assert_visible": lines.push(`await expect(${loc()}).toBeVisible();`); break;
        case "assert_hidden": lines.push(`await expect(${loc()}).toBeHidden();`); break;
        case "assert_text": lines.push(`await expect(${loc()}).toContainText(${valExpr(s.value, ctx)});`); break;
        case "assert_value": lines.push(`await expect(${loc()}).toHaveValue(${valExpr(s.value, ctx)});`); break;
        case "assert_attribute": lines.push(`await expect(${loc()}).toHaveAttribute(${valExpr(s.attribute, ctx)}, ${valExpr(s.value, ctx)});`); break;
        case "goto": lines.push(`await ${pg}.goto(${valExprOr(s.value, ctx.url, ctx)}, { waitUntil: "domcontentloaded", timeout: 30000 });`); break;
        case "wait": lines.push(`await ${pg}.waitForTimeout(Math.max(0, Number(${valExpr(s.value, ctx)}) || 500));`); break;
        case "screenshot": lines.push(`await ${pg}.screenshot({ type: "png" });`); break;
        default:
          throw new Error(`acción no soportada en el export: ${s.action}`);
      }
      if (comment) w.push();
      for (const l of lines) w.push(l);
    }
  }
}

/** Emite una secuencia de pasos. */
function emitSteps(w: Writer, steps: Step[], ctx: GenCtx) {
  for (const s of steps) emitStep(w, s, ctx);
}

/** Recolecta sub-flujos (RF-21) con detección de ciclos. Devuelve nombre → pasos. */
async function collectFlows(
  doc: TestFile,
  loadFlow: (name: string) => Promise<string>,
): Promise<Record<string, Step[]>> {
  const flows: Record<string, Step[]> = {};
  const loaded = new Set<string>();
  const pending = new Set<string>();
  const queue: string[] = [];

  const enqueue = (steps: Step[], from: string) => {
    for (const s of steps) {
      if (s.action !== "run_flow" || !s.flow) continue;
      if (loaded.has(s.flow)) continue;
      if (pending.has(s.flow)) throw new Error(`sub-flujo circular en el export: ${from} → ${s.flow}`);
      queue.push(s.flow);
      enqueue(s.children ?? [], s.flow);
    }
  };

  enqueue(doc.steps ?? [], doc.name || "raíz");
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i];
    if (loaded.has(name)) continue;
    pending.add(name);
    const fdoc = JSON.parse(await loadFlow(name)) as TestFile;
    loaded.add(name);
    pending.delete(name);
    flows[name] = fdoc.steps ?? [];
    enqueue(fdoc.steps ?? [], name);
  }
  return flows;
}

/** True si el árbol de pasos usa pestañas (open/switch/close_tab). */
function usesTabs(steps: Step[]): boolean {
  return steps.some(
    (s) =>
      s.action === "open_tab" || s.action === "switch_tab" || s.action === "close_tab" ||
      usesTabs(s.children ?? []) || usesTabs(s.elseChildren ?? []),
  );
}

/** Registra los sub-flujos como funciones con sus pasos, en orden de dependencia. */
function emitFlowFunctions(w: Writer, flows: Record<string, Step[]>, ctx: GenCtx) {
  for (const [name, steps] of Object.entries(flows)) {
    w.push(`/** Sub-flujo "${name}" (embebido desde la biblioteca de YATT). */`);
    w.push(`async function ${flowFn(name)}(${ctx.page}: Page, vars: Record<string, string> = VARS): Promise<void> {`);
    w.indent(() => emitSteps(w, steps, { ...ctx, varsExpr: "vars" }));
    w.push(`}`);
    w.push();
  }
}

/**
 * Genera el spec TypeScript (formato lineal) para el test y sus sub-flujos.
 */
export async function buildSpec(
  doc: TestFile,
  loadFlow: (name: string) => Promise<string>,
  format: ExportFormat = "playwright",
): Promise<string> {
  const flows = await collectFlows(doc, loadFlow);
  const hasTabs = usesTabs(doc.steps ?? []) || Object.values(flows).some((f) => usesTabs(f));
  const pg = hasTabs ? "pg" : "page";
  const url = doc.url || "about:blank";
  const ctx: GenCtx = { format, varsExpr: "VARS", page: pg, url };

  const testTitle = `${doc.name || "mi-test"} (exportado de YATT)`;
  const vars = resolveVars(doc.variables ?? [], ENV_DEFAULT, {});

  const body = new Writer();
  if (hasTabs) body.push(`let pg: Page = page;`);
  body.push(`await ${pg}.goto(${js(url)}, { waitUntil: "domcontentloaded", timeout: 30000 });`);
  emitSteps(body, doc.steps ?? [], ctx);

  const flowsW = new Writer();
  emitFlowFunctions(flowsW, flows, ctx);
  const flowsCode = flowsW.text();

  if (format === "jest") {
    return `// Generado por YATT (RF-24). Target: Jest + jest-environment-playwright.
// Requiere: npm i -D jest jest-environment-playwright
// y en jest.config: testEnvironment: "jest-environment-playwright".
import { describe, expect, it } from "@jest/globals";
import type { Page } from "playwright";

declare const page: Page;

// Variables del test con sus valores por defecto (entorno default de YATT).
const VARS: Record<string, string> = ${JSON.stringify(vars, null, 2)};

// Interpola {{variable}} con los valores de VARS (o del ámbito recibido).
function t(value: string, vars?: Record<string, string>): string;
function t(value: string | undefined, vars?: Record<string, string>): string | undefined;
function t(value: string | undefined, vars: Record<string, string> = VARS): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

${flowsCode}describe(${js(doc.name || "mi-test")}, () => {
  it(${js(testTitle)}, async () => {
${body
  .text()
  .split("\n")
  .map((l) => (l ? "    " + l : l))
  .join("\n")}
  });
});
`;
  }

  return `// Generado por YATT (RF-24). Requiere: npm i -D @playwright/test && npx playwright install chromium
import { test, expect, type Page } from "@playwright/test";

// Variables del test con sus valores por defecto (entorno default de YATT).
const VARS: Record<string, string> = ${JSON.stringify(vars, null, 2)};

// Interpola {{variable}} con los valores de VARS (o del ámbito recibido).
function t(value: string, vars?: Record<string, string>): string;
function t(value: string | undefined, vars?: Record<string, string>): string | undefined;
function t(value: string | undefined, vars: Record<string, string> = VARS): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

${flowsCode}test(${js(testTitle)}, async ({ page }) => {
${body
  .text()
  .split("\n")
  .map((l) => (l ? "  " + l : l))
  .join("\n")}
});
`;
}
