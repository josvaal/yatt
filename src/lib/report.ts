import { ACTION_LABELS, type StepAction } from "@/lib/yatt";

export type RunStatus = "ok" | "fail" | "skipped" | "stopped";

export interface RunRecord {
  index: number;
  action: StepAction;
  selector?: string;
  value?: string;
  attribute?: string;
  status: RunStatus;
  ms?: number;
  error?: string;
  screenshot?: string;
}

export interface SetTestResult {
  name: string;
  ok: boolean;
  ms: number;
  fail: number;
  stopped: boolean;
  error?: string;
  steps: RunRecord[];
}

export interface RunReport {
  kind: "test" | "set";
  title: string;
  testName?: string;
  url?: string;
  env?: string;
  headless: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: number;
  fail: number;
  skipped: number;
  stopped: boolean;
  logs: string[];
  steps: RunRecord[];
  tests?: SetTestResult[];
}

/** Nombre de archivo para el reporte: título saneado + marca de tiempo local. */
export function reportSlug(title: string): string {
  const base =
    title
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "corrida";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMs(ms?: number): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es", { dateStyle: "short", timeStyle: "medium" });
}

const STATUS_META: Record<RunStatus, { label: string; cls: string }> = {
  ok: { label: "ok", cls: "chip-ok" },
  fail: { label: "falló", cls: "chip-fail" },
  skipped: { label: "saltado", cls: "chip-skip" },
  stopped: { label: "detenido", cls: "chip-stop" },
};

function recordRow(rec: RunRecord): string {
  const meta = STATUS_META[rec.status];
  const label = ACTION_LABELS[rec.action] ?? rec.action;
  return `
  <div class="row ${rec.status}">
    <span class="num">${rec.index}</span>
    <div class="body">
      <div class="line">
        <span class="label">${esc(label)}</span>
        ${rec.value !== undefined ? `<span class="val">“${esc(rec.value)}”</span>` : ""}
        ${rec.selector ? `<span class="sel">${esc(rec.selector)}</span>` : ""}
        ${rec.attribute ? `<span class="attr">[${esc(rec.attribute)}]</span>` : ""}
      </div>
      <div class="time">${fmtMs(rec.ms)}</div>
      ${rec.error ? `<pre class="err">${esc(rec.error)}</pre>` : ""}
      ${rec.screenshot ? `<img src="data:image/png;base64,${rec.screenshot}" alt="Evidencia del fallo" />` : ""}
    </div>
    <span class="chip ${meta.cls}">${meta.label}</span>
  </div>`;
}

function headerInfo(r: RunReport): string {
  return `
    <div class="meta">
      <span>${esc(r.kind === "set" ? "Set de tests" : "Test")}</span>
      <span>${esc(fmtDate(r.startedAt))}</span>
      <span>duración ${fmtMs(r.durationMs)}</span>
      ${r.env ? `<span>entorno ${esc(r.env)}</span>` : ""}
      ${r.url ? `<span class="mono">${esc(r.url)}</span>` : ""}
    </div>
    <div class="counts">
      <span class="c-ok">${r.ok} ok</span>
      <span class="c-fail">${r.fail} fallo${r.fail === 1 ? "" : "s"}</span>
      ${r.skipped ? `<span class="c-skip">${r.skipped} saltado${r.skipped === 1 ? "" : "s"}</span>` : ""}
      ${r.stopped ? `<span class="c-stop">detenida</span>` : ""}
    </div>`;
}

/** Reporte HTML autocontenido (imágenes embebidas, sin dependencias externas). */
export function buildReportHtml(r: RunReport): string {
  const setRows = (r.tests ?? [])
    .map(
      (t) => `
    <div class="trow ${t.ok ? "ok" : "fail"}">
      <span class="tname">${esc(t.name)}</span>
      <span class="ttime">${t.steps.length} pasos · ${t.fail} fallo${t.fail === 1 ? "" : "s"} · ${fmtMs(t.ms)}</span>
      ${t.error ? `<pre class="err">${esc(t.error)}</pre>` : ""}
      <span class="chip ${t.ok ? "chip-ok" : "chip-fail"}">${t.ok ? "ok" : "falló"}${t.stopped ? " · detenido" : ""}</span>
    </div>`,
    )
    .join("");

  const stepsBlock = (records: RunRecord[]): string =>
    records.length === 0
      ? `<p class="empty">Sin pasos ejecutados.</p>`
      : records.map(recordRow).join("");

  const setStepsHtml = (r.tests ?? [])
    .map(
      (t) => `
    <h3 class="test-title">${esc(t.name)} <span class="tmeta">${t.steps.length} paso${t.steps.length === 1 ? "" : "s"} · ${t.fail} fallo${t.fail === 1 ? "" : "s"} · ${fmtMs(t.ms)}</span></h3>
    <div class="test-steps">${stepsBlock(t.steps)}</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(r.title)} · YATT</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #14171f; color: #e8eaf0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding: 24px 32px; border-bottom: 1px solid #2a2f3a; background: #181c26; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: #9aa3b2; font-size: 12.5px; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .counts { display: flex; gap: 14px; margin-top: 10px; font-weight: 600; }
  .c-ok { color: #7bd88f; } .c-fail { color: #f87171; } .c-skip { color: #e3c565; } .c-stop { color: #f59e0b; }
  main { max-width: 900px; margin: 0 auto; padding: 24px 32px 64px; }
  h2 { font-size: 15px; margin: 26px 0 10px; color: #c6cdd9; }
  .row { display: flex; gap: 12px; align-items: flex-start; border: 1px solid #2a2f3a; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; background: #1b1f29; }
  .row.fail { border-color: rgba(248, 113, 113, 0.45); }
  .row .num { font-size: 12px; color: #7a8292; width: 22px; text-align: center; margin-top: 2px; }
  .row .body { flex: 1; min-width: 0; }
  .row .line { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .row .label { font-weight: 600; }
  .row .val, .row .sel, .row .attr { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; color: #9fd0ff; }
  .row .time { font-size: 11.5px; color: #7a8292; margin-top: 2px; }
  .err { margin: 8px 0 0; padding: 8px 10px; background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.25); border-radius: 8px; color: #fca5a5; font: 12px ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .row img { max-width: 100%; margin-top: 8px; border: 1px solid #2a2f3a; border-radius: 8px; }
  .chip { padding: 2px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .chip-ok { background: rgba(123, 216, 143, 0.15); color: #7bd88f; }
  .chip-fail { background: rgba(248, 113, 113, 0.15); color: #f87171; }
  .chip-skip { background: rgba(227, 197, 101, 0.15); color: #e3c565; }
  .chip-stop { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .trow { display: flex; gap: 12px; align-items: center; border: 1px solid #2a2f3a; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
  .trow.fail { border-color: rgba(248, 113, 113, 0.45); }
  .trow .tname { flex: 1; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .trow .ttime { color: #7a8292; font-size: 12.5px; }
  .test-title { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font-size: 13px; margin: 18px 0 8px; color: #c6cdd9; }
  .test-title .tmeta { font-size: 11.5px; color: #7a8292; font-weight: 400; }
  .test-steps { margin-bottom: 6px; }
  .empty { color: #9aa3b2; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: #9aa3b2; font-size: 13px; }
  pre.logs { margin: 8px 0 0; padding: 12px; background: #10131a; border: 1px solid #2a2f3a; border-radius: 8px; font: 12px ui-monospace, Menlo, Consolas, monospace; color: #9aa3b2; white-space: pre-wrap; max-height: 320px; overflow: auto; }
  footer { margin-top: 40px; color: #565e6e; font-size: 12px; text-align: center; }
</style></head>
<body>
  <header>
    <h1>${esc(r.title)}</h1>
    ${headerInfo(r)}
  </header>
  <main>
    ${r.tests ? `<h2>Tests del set</h2>${setRows}` : ""}
    ${r.tests ? `<h2>Pasos por test</h2>${setStepsHtml}` : `<h2>Pasos</h2>${stepsBlock(r.steps)}`}
    ${r.logs.length ? `<details><summary>Logs del sidecar (${r.logs.length})</summary><pre class="logs">${esc(r.logs.join("\n"))}</pre></details>` : ""}
    <footer>Generado por YATT · Yet Another Testing Tool</footer>
  </main>
</body></html>`;
}

/** Reporte JSON: mismo contenido que el HTML, listo para parsear por otras herramientas. */
export function buildReportJson(r: RunReport): string {
  return JSON.stringify(r, null, 2);
}