/**
 * CLI headless de YATT (RF-28) — para CI y uso en terminal.
 *
 * Uso:
 *   bun run sidecar/src/cli.ts run tests/mi-test.yatt.json [opciones]
 *
 * Opciones:
 *   --browser chromium|firefox|webkit   motor (default chromium)
 *   --headed                             ventana visible (default headless)
 *   --env <nombre>                       entorno de variables (default "default")
 *   --override clave=valor               sobrescribe una variable (repetible)
 *   --timeout <segundos>                 timeout por paso (default 40)
 *   --url <url>                          sobrescribe la URL inicial del test
 *   --report <ruta.html>                 escribe el reporte HTML
 *   --json <ruta.json>                   escribe el reporte JSON
 *   --log                                imprime cada paso en stdout
 *
 * Códigos de salida: 0 = todo ok · 1 = hubo fallos o se detuvo · 2 = error de uso/archivo
 */

import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium, firefox, webkit, type Page } from "playwright";
import { runTestSteps, type RunOutcome, type Step } from "./engine.ts";

const ENGINES: Record<string, { launch: typeof chromium.launch }> = {
  chromium: { launch: chromium.launch.bind(chromium) },
  firefox: { launch: firefox.launch.bind(firefox) },
  webkit: { launch: webkit.launch.bind(webkit) },
};

interface Options {
  browser: string;
  headless: boolean;
  env: string;
  overrides: Record<string, string>;
  timeoutMs: number;
  url?: string;
  report?: string;
  json?: string;
  log: boolean;
}

function usage(): string {
  return `YATT · CLI headless (RF-28)
Uso: yatt run <test.yatt.json> [opciones]
  --browser chromium|firefox|webkit   motor (default chromium)
  --headed                            ventana visible (default headless)
  --env <nombre>                      entorno de variables (default "default")
  --override clave=valor              sobrescribe una variable (repetible)
  --timeout <segundos>                timeout por paso (default 40)
  --url <url>                         sobrescribe la URL inicial
  --report <ruta.html>                escribe el reporte HTML
  --json <ruta.json>                  escribe el reporte JSON
  --log                                imprime cada paso
Códigos: 0 ok · 1 fallos/detenido · 2 error de uso o archivo`;
}

function parseArgs(argv: string[]): { cmd: string; file: string; opts: Options } | null {
  const cmd = argv[0];
  const file = argv[1];
  if (cmd !== "run" || !file) return null;
  const opts: Options = { browser: "chromium", headless: true, env: "default", overrides: {}, timeoutMs: 40000, log: false };
  let k = 2;
  const next = () => argv[++k];
  while (k < argv.length) {
    const a = argv[k];
    switch (a) {
      case "--browser":
        opts.browser = next();
        break;
      case "--headed":
        opts.headless = false;
        break;
      case "--headless":
        opts.headless = true;
        break;
      case "--env":
        opts.env = next();
        break;
      case "--override": {
        const kv = next();
        const idx = kv.indexOf("=");
        if (idx <= 0) throw new Error("--override espera clave=valor");
        opts.overrides[kv.slice(0, idx)] = kv.slice(idx + 1);
        break;
      }
      case "--timeout":
        opts.timeoutMs = Math.max(1, Number(next()) || 40) * 1000;
        break;
      case "--url":
        opts.url = next();
        break;
      case "--report":
        opts.report = next();
        break;
      case "--json":
        opts.json = next();
        break;
      case "--log":
        opts.log = true;
        break;
      default:
        throw new Error("opción desconocida: " + a);
    }
    k++;
  }
  if (!(opts.browser in ENGINES)) throw new Error(`navegador desconocido: ${opts.browser} (chromium|firefox|webkit)`);
  return { cmd, file, opts };
}

const ENV_DEFAULT = "default";

function resolveVars(variables: Array<{ name: string; values?: Record<string, string> }>, env: string, overrides: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const v of variables ?? []) {
    const ov = overrides[v.name];
    out[v.name] = ov !== undefined && ov !== "" ? ov : (v.values?.[env] ?? v.values?.[ENV_DEFAULT] ?? "");
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(out: RunOutcome, meta: Record<string, string>): string {
  const rows = out.records
    .map((r) => {
      const chip = { ok: ["chip-ok", "ok"], fail: ["chip-fail", "falló"], skipped: ["chip-skip", "saltado"], stopped: ["chip-stop", "detenido"] }[r.status] ?? ["", r.status];
      return `
    <div class="row ${r.status}">
      <span class="num">${r.index}</span>
      <div class="body">
        <div class="line"><span class="label">${esc(r.action)}</span>${r.summary ? `<span class="sum">${esc(r.summary)}</span>` : ""}${r.value !== undefined ? `<span class="val">“${esc(r.value)}”</span>` : ""}${r.selector ? `<span class="sel">${esc(r.selector)}</span>` : ""}</div>
        <div class="time">${r.ms ?? "—"} ms</div>
        ${r.error ? `<pre class="err">${esc(r.error)}</pre>` : ""}
        ${r.screenshot ? `<img src="data:image/png;base64,${r.screenshot}" alt="Evidencia del paso" />` : ""}
      </div>
      <span class="chip ${chip[0]}">${chip[1]}</span>
    </div>`;
    })
    .join("");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>${esc(meta.title)} · YATT</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #14171f; color: #e8eaf0; font: 14px/1.5 system-ui, sans-serif; }
  header { padding: 24px 32px; border-bottom: 1px solid #2a2f3a; background: #181c26; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: #9aa3b2; font-size: 12.5px; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 32px 64px; }
  .row { display: flex; gap: 12px; align-items: flex-start; border: 1px solid #2a2f3a; border-radius: 10px; padding: 12px 14px; margin: 8px 0; background: #1b1f29; }
  .row.fail { border-color: rgba(248, 113, 113, 0.45); }
  .row .num { font-size: 12px; color: #7a8292; width: 22px; text-align: center; margin-top: 2px; }
  .row .body { flex: 1; min-width: 0; }
  .row .line { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .row .label { font-weight: 600; }
  .row .sum { color: #9aa3b2; font-size: 12px; }
  .row .val, .row .sel { font-family: ui-monospace, monospace; font-size: 12.5px; color: #9fd0ff; }
  .row .time { font-size: 11.5px; color: #7a8292; margin-top: 2px; }
  .err { margin: 8px 0 0; padding: 8px 10px; background: rgba(248,113,113,.08); border: 1px solid rgba(248,113,113,.25); border-radius: 8px; color: #fca5a5; font: 12px ui-monospace, monospace; white-space: pre-wrap; }
  .row img { max-width: 100%; margin-top: 8px; border: 1px solid #2a2f3a; border-radius: 8px; }
  .chip { padding: 2px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .chip-ok { background: rgba(123,216,143,.15); color: #7bd88f; }
  .chip-fail { background: rgba(248,113,113,.15); color: #f87171; }
  .chip-skip { background: rgba(227,197,101,.15); color: #e3c565; }
  .chip-stop { background: rgba(245,158,11,.15); color: #f59e0b; }
</style></head>
<body>
  <header><h1>${esc(meta.title)}</h1>
    <div class="meta"><span>archivo ${esc(meta.file)}</span><span>motor ${esc(meta.browser)}</span><span>entorno ${esc(meta.env)}</span><span>${esc(meta.date)}</span><span>duración ${meta.duration}s</span></div>
    <div style="margin-top:10px;font-weight:600"><span style="color:#7bd88f">${out.ok} ok</span> · <span style="color:#f87171">${out.fail} fallo${out.fail === 1 ? "" : "s"}</span>${out.skipped ? ` · ${out.skipped} saltados` : ""}${out.stopped ? " · detenida" : ""}</div>
  </header>
  <main>${rows || '<p style="color:#9aa3b2">Sin pasos ejecutados.</p>'}</main>
</body></html>`;
}

async function main() {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error("Error: " + (err instanceof Error ? err.message : String(err)));
    console.error(usage());
    process.exit(2);
  }
  if (!parsed) {
    console.error(usage());
    process.exit(2);
  }
  const { file, opts } = parsed;

  let doc: { name?: string; url?: string; steps?: Step[]; variables?: Array<{ name: string; values?: Record<string, string> }> };
  try {
    if (!existsSync(file)) throw new Error(`el archivo no existe: ${file}`);
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error("Error leyendo el test: " + (err instanceof Error ? err.message : String(err)));
    process.exit(2);
  }
  if (!Array.isArray(doc.steps)) {
    console.error("Error: el archivo no tiene una lista de steps");
    process.exit(2);
  }

  // Ctrl+C detiene limpiamente (RNF-08).
  let ctrlC = false;
  process.on("SIGINT", () => {
    ctrlC = true;
    console.error("\nDeteniendo…");
  });

  const vars = resolveVars(doc.variables ?? [], opts.env, opts.overrides);
  const flowsPath = dirname(file);
  // Sub-flujos (RF-21): junto al test o en tests/ relativo a la carpeta actual.
  const flows = async (name: string) => {
    const candidates = [join(flowsPath, `${name}.yatt.json`), join(process.cwd(), "tests", `${name}.yatt.json`)];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const fdoc = JSON.parse(readFileSync(p, "utf8"));
      return { steps: (fdoc.steps ?? []) as Step[] };
    }
    return null;
  };

  const startedAt = Date.now();
  const holder = { page: null as unknown as Page };
  try {
    const launcher = ENGINES[opts.browser];
    const browser = await launcher.launch({ headless: opts.headless });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    holder.page = await context.newPage();
    const url = opts.url ?? doc.url ?? "about:blank";
    await holder.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const out = await runTestSteps(holder, doc.steps!, vars, {
      flows,
      stepTimeoutMs: opts.timeoutMs,
      shouldStop: () => ctrlC,
    });

    const duration = ((Date.now() - startedAt) / 1000).toFixed(2);
    if (opts.log) {
      for (const r of out.records) {
        const mark = r.status === "ok" ? "✓" : r.status === "fail" ? "✗" : "·";
        console.log(`${mark} ${r.action}${r.selector ? ` ${r.selector}` : ""}${r.value !== undefined ? ` "${r.value}"` : ""}${r.error ? ` — ${r.error}` : ""}`);
      }
    }
    console.log(
      `\nResultado: ${out.ok} ok · ${out.fail} fallos · ${out.skipped} saltados${out.stopped ? " · DETENIDA" : ""} (${duration} s, motor ${opts.browser}, entorno ${opts.env})`,
    );

    const meta = {
      title: `${doc.name ?? "test"} · YATT`,
      file,
      browser: opts.browser,
      env: opts.env,
      date: new Date().toLocaleString("es"),
      duration,
    };
    if (opts.json) {
      mkdirSync(dirname(opts.json), { recursive: true });
      writeFileSync(opts.json, JSON.stringify({ meta, ...out }, null, 2));
      console.log(`JSON: ${opts.json}`);
    }
    if (opts.report) {
      mkdirSync(dirname(opts.report), { recursive: true });
      writeFileSync(opts.report, buildHtml(out, meta));
      console.log(`Reporte: ${opts.report}`);
    }

    await browser.close();
    process.exit(out.fail > 0 || out.stopped ? 1 : 0);
  } catch (err) {
    console.error("Error durante la corrida: " + (err instanceof Error ? err.message : String(err)));
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}