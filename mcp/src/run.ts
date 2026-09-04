import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildReportHtml, buildReportJson, reportSlug, type RunRecord, type RunReport } from "../../src/lib/report.ts";
import { sidecarDir } from "./root.ts";
import type { Store } from "./db.ts";

/**
 * Runner headless del MCP: spawns one-shot del CLI del sidecar por corrida
 * (aislamiento, Ctrl+C y timeout por paso del motor). El JSON del CLI
 * (`RunOutcome`) se mapea al `RunReport` de la app y se guarda con la misma
 * invariante que `report_save`: BD + espejo `reports/<slug>.json|.html`.
 */

export interface RunRequest {
  /** Nombre del test guardado (clave en la BD; se corre desde su espejo). */
  name: string;
  env?: string;
  overrides?: Record<string, string>;
  /** Timeout por paso en ms (default 40000, igual que el motor). */
  stepTimeoutMs?: number;
  browser?: "chromium" | "firefox" | "webkit";
  url?: string;
  /** Guarda el reporte en la BD + reports/ (default true). */
  saveReport?: boolean;
}

export interface RunSummary {
  ok: number;
  fail: number;
  skipped: number;
  stopped: boolean;
  durationMs: number;
  /** Porcentaje de pasos en verde (redondeado). */
  passedPct: number;
  steps: RunRecord[];
  report?: { slug: string; json: string; html: string };
  error?: string;
}

/** Forma del JSON que escribe el CLI (RunOutcome del motor + meta). */
interface CliOutcome {
  records?: unknown[];
  ok?: number;
  fail?: number;
  skipped?: number;
  stopped?: boolean;
}

export async function runTestHeadless(store: Store, root: string, req: RunRequest): Promise<RunSummary> {
  const file = join(root, "tests", `${req.name}.yatt.json`);
  if (!existsSync(file)) {
    throw new Error(`el test "${req.name}" no está guardado (crealo con test_create primero)`);
  }

  const tmpJson = join(tmpdir(), `yatt-run-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const args = ["run", "src/cli.ts", "run", file, "--json", tmpJson, "--env", req.env ?? "default"];
  for (const [k, v] of Object.entries(req.overrides ?? {})) {
    args.push("--override", `${k}=${v}`);
  }
  if (req.stepTimeoutMs && req.stepTimeoutMs > 0) {
    args.push("--timeout", String(Math.max(1, Math.round(req.stepTimeoutMs / 1000))));
  }
  if (req.browser && req.browser !== "chromium") args.push("--browser", req.browser);
  if (req.url) args.push("--url", req.url);

  const startedAt = Date.now();
  const { code, stderr } = await spawnCli(root, args);
  const durationMs = Date.now() - startedAt;

  let outcome: CliOutcome | null = null;
  if (existsSync(tmpJson)) {
    try {
      outcome = JSON.parse(readFileSync(tmpJson, "utf8")) as CliOutcome;
    } catch {
      outcome = null;
    }
    rmSync(tmpJson, { force: true });
  }

  if (!outcome) {
    throw new Error(`la corrida falló sin reporte: ${lastLines(stderr)}`);
  }

  const records = (outcome.records ?? []).map((r) => ({ ...(r as RunRecord) }));
  const summary: RunSummary = {
    ok: outcome.ok ?? 0,
    fail: outcome.fail ?? 0,
    skipped: outcome.skipped ?? 0,
    stopped: outcome.stopped === true,
    durationMs,
    passedPct: 0,
    steps: records,
  };
  const total = summary.ok + summary.fail + summary.skipped;
  summary.passedPct = total > 0 ? Math.round((summary.ok / total) * 100) : 0;

  if (req.saveReport !== false) {
    const report: RunReport = {
      kind: "test",
      title: `${req.name} · YATT`,
      testName: req.name,
      url: req.url,
      env: req.env ?? "default",
      headless: true,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(startedAt + durationMs).toISOString(),
      durationMs,
      ok: summary.ok,
      fail: summary.fail,
      skipped: summary.skipped,
      stopped: summary.stopped,
      logs: lastLines(stderr, 20).split("\n"),
      steps: records,
    };
    const slug = reportSlug(report.title);
    const jsonName = `${slug}.json`;
    const htmlName = `${slug}.html`;
    await store.upsertReport(jsonName, buildReportJson(report));
    await store.upsertReport(htmlName, buildReportHtml(report));
    summary.report = { slug, json: jsonName, html: htmlName };
  }

  if (code !== 0 && code !== 1) {
    summary.error = lastLines(stderr);
  }
  return summary;
}

/** Dataset (data-driven): corre el test una vez por fila de overrides. */
export async function runTestDataset(
  store: Store,
  root: string,
  req: RunRequest & { rows: Array<Record<string, string>> },
): Promise<{ rows: RunSummary[]; ok: number; fail: number; stopped: boolean; durationMs: number }> {
  const startedAt = Date.now();
  const rows: RunSummary[] = [];
  let ok = 0;
  let fail = 0;
  let stopped = false;
  for (const row of req.rows) {
    const r = await runTestHeadless(store, root, { ...req, overrides: { ...(req.overrides ?? {}), ...row }, saveReport: false });
    rows.push(r);
    ok += r.ok;
    fail += r.fail;
    stopped = stopped || r.stopped;
  }
  return { rows, ok, fail, stopped, durationMs: Date.now() - startedAt };
}

function spawnCli(root: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", args, {
      cwd: sidecarDir(),
      env: { ...process.env, YATT_ROOT: root },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => reject(new Error(`no se pudo lanzar el motor: ${err.message}`)));
    child.on("exit", (code) => resolve({ code: code ?? 2, stderr }));
  });
}

function lastLines(s: string, n = 8): string {
  return s.split("\n").filter(Boolean).slice(-n).join("\n").trim() || "sin detalles";
}