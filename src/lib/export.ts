/**
 * Export de un test YATT a código Playwright (RF-24).
 *
 * Genera un spec TypeScript autocontenido: reimplementa la ejecución de los
 * pasos (incluidos condicionales, bucles, sub-flujos y pestañas) con el mismo
 * orden semántico que el runner de YATT, embebiendo los sub-flujos como datos.
 * Es un punto de partida sólido para CI: se puede ajustar a mano.
 */

import type { Step, TestFile } from "@/lib/yatt";
import { ENV_DEFAULT, resolveVars } from "@/lib/vars";

const js = (s: string) => JSON.stringify(s);

/** Recorre el árbol de pasos (children/elseChildren) aplicando una visita. */
function walkSteps(steps: Step[], visit: (s: Step) => void) {
  for (const s of steps) {
    visit(s);
    walkSteps(s.children ?? [], visit);
    walkSteps(s.elseChildren ?? [], visit);
  }
}

/** Genera el cuerpo (líneas de código) para un paso hoja o bloque. */
function genStep(s: Step, depth: number): string[] {
  const ind = "    ".repeat(Math.min(depth + 2, 12));
  const out: string[] = [];
  const push = (line: string) => out.push(ind + line);

  const sel = (expr: string) => `ctx.page.locator(${expr})`;

  switch (s.action) {
    case "if":
      push(`case "if": {`);
      push(`  const cond = resolveStep(step, vars);`);
      push(`  let truthy: boolean;`);
      push(`  if (cond.selector) truthy = (await ctx.page.locator(cond.selector).count()) > 0;`);
      push(`  else truthy = !!cond.value && cond.value !== "false" && cond.value !== "0";`);
      push(`  const branch = truthy ? step.children ?? [] : step.elseChildren ?? [];`);
      push(`  await runSteps(ctx, branch, depth + 1, vars);`);
      push(`  break;`);
      push(`}`);
      break;
    case "repeat":
      push(`case "repeat": {`);
      push(`  const times = Math.max(0, Math.floor(Number(step.times) || 0));`);
      push(`  for (let i = 1; i <= times; i++) await runSteps(ctx, step.children ?? [], depth + 1, vars);`);
      push(`  break;`);
      push(`}`);
      break;
    case "for_each":
      push(`case "for_each": {`);
      push(`  const listVal = (interp(step.list, vars) ?? "").trim();`);
      push(`  const items = listVal.split(",").map((x) => x.trim()).filter(Boolean);`);
      push(`  for (const item of items) {`);
      push(`    await runSteps(ctx, step.children ?? [], depth + 1, { ...vars, [step.itemVar ?? "item"]: item });`);
      push(`  }`);
      push(`  break;`);
      push(`}`);
      break;
    case "run_flow":
      push(`case "run_flow": {`);
      push(`  const flow = interp(step.flow, vars) ?? "";`);
      push(`  if (!(flow in ctx.flows)) throw new Error(\`sub-flujo "\${flow}" no embebido en el spec\`);`);
      push(`  const fvars: Record<string, string> = { ...vars };`);
      push(`  for (const [k, src] of Object.entries(step.withVars ?? {})) {`);
      push(`    fvars[k] = /^\\{\\{[\\w.-]+\\}\\}$/.test(src) ? interp(src, vars) : (src in vars ? vars[src] : src);`);
      push(`  }`);
      push(`  await runSteps(ctx, ctx.flows[flow], depth + 1, fvars);`);
      push(`  break;`);
      push(`}`);
      break;
    case "open_tab":
      push(`case "open_tab": {`);
      push(`  ctx.page = await ctx.page.context().newPage();`);
      push(`  if (step.value) await ctx.page.goto(step.value, { waitUntil: "domcontentloaded" });`);
      push(`  break;`);
      push(`}`);
      break;
    case "switch_tab":
      push(`case "switch_tab": {`);
      push(`  const ps = ctx.page.context().pages();`);
      push(`  ctx.page = ps[Number(step.value)];`);
      push(`  break;`);
      push(`}`);
      break;
    case "close_tab":
      push(`case "close_tab": {`);
      push(`  const ps = ctx.page.context().pages();`);
      push(`  if (ps.length <= 1) throw new Error("no se puede cerrar la única pestaña");`);
      push(`  const idx = step.value === undefined || step.value === "" ? ps.indexOf(ctx.page) : Number(step.value);`);
      push(`  if (ctx.page === ps[idx]) ctx.page = ps.filter((x) => x !== ps[idx])[ps.length - 2];`);
      push(`  await ps[idx].close();`);
      push(`  break;`);
      push(`}`);
      break;
    case "capture_screenshot":
      push(`case "capture_screenshot": {`);
      push(`  const name = (step.value ?? step.baseline ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "captura";`);
      push(`  await ctx.page.screenshot({ path: \`baselines/\${name}.png\`, fullPage: !!step.fullPage });`);
      push(`  break;`);
      push(`}`);
      break;
    case "assert_screenshot":
      push(`case "assert_screenshot": {`);
      push(`  const name = (step.baseline ?? step.value ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "captura";`);
      push(`  const tol = Math.max(0, Number(step.tolerance) || 0) / 100;`);
      push(`  await expect(ctx.page).toHaveScreenshot(\`\${name}.png\`, { maxDiffPixelRatio: tol, fullPage: !!step.fullPage });`);
      push(`  break;`);
      push(`}`);
      break;
    default: {
      // Acciones hoja: un `case` con sus sentencias y `break`.
      const L = sel(js(`\${interp(step.selector, vars)}`));
      const lines: string[] = [];
      switch (s.action) {
        case "click":
          lines.push(`await ${L}.click({ timeout: 5000 });`);
          break;
        case "dblclick":
          lines.push(`await ${L}.dblclick({ timeout: 5000 });`);
          break;
        case "hover":
          lines.push(`await ${L}.hover({ timeout: 5000 });`);
          break;
        case "type":
          lines.push(`await ${L}.fill(\`\${interp(step.value, vars) ?? ""}\`, { timeout: 5000 });`);
          break;
        case "clear":
          lines.push(`await ${L}.clear({ timeout: 5000 });`);
          break;
        case "upload":
          lines.push(`await ${L}.setInputFiles(\`\${interp(step.value, vars)}\`, { timeout: 5000 });`);
          break;
        case "select_option":
          lines.push(`await ${L}.selectOption(\`\${interp(step.value, vars)}\`, { timeout: 5000 });`);
          break;
        case "check":
          lines.push(`await ${L}.check({ timeout: 5000 });`);
          break;
        case "press_key":
          if (s.selector) lines.push(`await ${L}.press(\`\${interp(step.value, vars) || "Enter"}\`, { timeout: 5000 });`);
          else lines.push(`await ctx.page.keyboard.press(\`\${interp(step.value, vars) || "Enter"}\`);`);
          break;
        case "wait_visible":
          lines.push(`await ${L}.waitFor({ state: "visible", timeout: 10000 });`);
          break;
        case "scroll_to_element":
          lines.push(`await ${L}.scrollIntoViewIfNeeded();`);
          break;
        case "assert_visible":
          lines.push(`await expect(${L}).toBeVisible();`);
          break;
        case "assert_hidden":
          lines.push(`await expect(${L}).toBeHidden();`);
          break;
        case "assert_text":
          lines.push(`await expect(${L}).toContainText(\`\${interp(step.value, vars)}\`);`);
          break;
        case "assert_value":
          lines.push(`await expect(${L}).toHaveValue(\`\${interp(step.value, vars)}\`);`);
          break;
        case "assert_attribute":
          lines.push(`await expect(${L}).toHaveAttribute(\`\${interp(step.attribute, vars)}\`, \`\${interp(step.value, vars)}\`);`);
          break;
        case "goto":
          lines.push(`await ctx.page.goto(\`\${interp(step.value, vars) || url}\`, { waitUntil: "domcontentloaded", timeout: 30000 });`);
          break;
        case "wait":
          lines.push(`await ctx.page.waitForTimeout(Math.max(0, Number(interp(step.value, vars)) || 500));`);
          break;
        case "screenshot":
          lines.push(`await ctx.page.screenshot({ type: "png" });`);
          break;
        default:
          push(`throw new Error("acción no soportada en el export: " + step.action);`);
      }
      push(`case ${js(s.action)}:`);
      for (const l of lines) push("  " + l);
      push(`  break;`);
      break;
    }
  }
  return out;
}

/** Genera el spec TypeScript completo para el test y sus sub-flujos. */
export async function buildPlaywrightSpec(
  doc: TestFile,
  loadFlow: (name: string) => Promise<string>,
): Promise<string> {
  // Recolecta sub-flujos (RF-21) embebidos, con detección de ciclos.
  const flows: Record<string, Step[]> = {};
  const loaded = new Set<string>();
  const pending = new Set<string>();
  const queue: string[] = [];

  const enqueue = (steps: Step[], from: string) => {
    walkSteps(steps, (s) => {
      if (s.action !== "run_flow" || !s.flow) return;
      if (loaded.has(s.flow)) return;
      if (pending.has(s.flow)) throw new Error(`sub-flujo circular en el export: ${from} → ${s.flow}`);
      queue.push(s.flow);
    });
  };

  enqueue(doc.steps ?? [], doc.name || "raíz");
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i];
    if (loaded.has(name)) continue;
    pending.add(name);
    const raw = await loadFlow(name);
    const fdoc = JSON.parse(raw) as TestFile;
    loaded.add(name);
    pending.delete(name);
    flows[name] = fdoc.steps ?? [];
    enqueue(fdoc.steps ?? [], name);
  }

  const testTitle = `${doc.name || "mi-test"} (exportado de YATT)`;
  const stepsJson = JSON.stringify(doc.steps ?? [], null, 2)
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
  const flowsJson = JSON.stringify(flows, null, 2)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
  const vars = resolveVars(doc.variables ?? [], ENV_DEFAULT, {});
  const varsJson = JSON.stringify(vars, null, 2)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");

  // Cuerpo del switch (un case por paso, en orden) + cerrar el switch.
  const bodyLines: string[] = [];
  for (const s of doc.steps) {
    bodyLines.push(`  switch (step.action) {`);
    bodyLines.push(...genStep(s, 0));
    bodyLines.push(`  default:`);
    bodyLines.push(`    throw new Error("acción desconocida: " + step.action);`);
    bodyLines.push(`  }`);
  }

  return `// Generado por YATT (RF-24). Requiere: npm i -D @playwright/test && npx playwright install chromium
import { test, expect, type Page } from "@playwright/test";

interface FlowStep {
  action: string;
  selector?: string;
  value?: string;
  attribute?: string;
  children?: FlowStep[];
  elseChildren?: FlowStep[];
  times?: number;
  list?: string;
  itemVar?: string;
  flow?: string;
  withVars?: Record<string, string>;
  baseline?: string;
  tolerance?: number;
  fullPage?: boolean;
}

// Sub-flujos (RF-21) embebidos como datos: se ejecutan en la misma página.
const FLOWS: Record<string, FlowStep[]> = ${flowsJson};

const STEPS: FlowStep[] = ${stepsJson};

// Variables del test con sus valores por defecto (entorno default).
const VARS: Record<string, string> = ${varsJson};

const url = ${js(doc.url || "about:blank")};

function interp(value: string | undefined, vars: Record<string, string>): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}
function resolveStep(step: FlowStep, vars: Record<string, string>): FlowStep {
  return {
    ...step,
    value: interp(step.value, vars),
    selector: interp(step.selector, vars),
    attribute: interp(step.attribute, vars),
    list: interp(step.list, vars),
    flow: interp(step.flow, vars),
  };
}

interface RunCtx {
  page: Page;
  flows: Record<string, FlowStep[]>;
}

async function runSteps(ctx: RunCtx, steps: FlowStep[], depth: number, vars: Record<string, string>): Promise<void> {
  for (const step of steps) {
    if (depth > 12) throw new Error("máximo de profundidad de bloques superado");
${bodyLines.map((l) => "    " + l).join("\n")}
  }
}

test(${js(testTitle)}, async ({ page }) => {
  const ctx: RunCtx = { page, flows: FLOWS };
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await runSteps(ctx, STEPS, 0, { ...VARS });
});
`;
}