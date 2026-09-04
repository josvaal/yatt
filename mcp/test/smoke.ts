/**
 * Smoke test del servidor MCP de YATT.
 *
 * Spawnea el server (mcp/src/server.ts) contra una raíz efímera, sirve una
 * página de prueba en un HTTP local, y ejerce las tools con el Client del SDK.
 *
 *   cd mcp && bun run test/smoke.ts
 */
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let failures = 0;
function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_ROOT = join(tmpdir(), `yatt-mcp-smoke-${process.pid}-${Date.now()}`);
mkdirSync(SMOKE_ROOT, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>YATT Smoke</title></head><body>
<h1>YATT Smoke</h1>
<form id="form">
  <input id="username" name="username" placeholder="usuario">
  <input id="password" name="password" type="password" placeholder="clave">
  <button id="submit" type="button">Entrar</button>
</form>
<p id="result">sin resultado</p>
<script>
document.getElementById("submit").onclick = () => {
  document.getElementById("result").textContent = document.getElementById("username").value;
};
</script>
</body></html>`;

let port = 0;
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PAGE);
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/`;

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/server.ts", "--root", SMOKE_ROOT],
    cwd: MCP_DIR,
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "yatt-smoke", version: "0.1.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
const textOf = (res: unknown) => {
    const content = ((res as { content?: unknown }).content ?? []) as Array<Record<string, unknown>>;
    return content
      .filter((c) => c.type === "text")
      .map((c) => String(c.text ?? ""))
      .join("\n");
  };
  const jsonOf = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse(textOf(await call(name, args)));

  try {
    // ---- Inventario de tools ----
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    check("tools registradas ≥ 25", names.length >= 25, `${names.length} tools`);
    for (const required of ["test_create", "test_run", "browser_preview", "report_get", "schema", "test_run_dataset"]) {
      check(`tool ${required}`, names.includes(required));
    }
    const prompts = await client.listPrompts();
    check("prompts registradas", prompts.prompts.length >= 4, `${prompts.prompts.length}`);

    // ---- Meta y recursos ----
    const ping = await jsonOf("ping");
    check("ping ok", ping.ok === true);
    const schema = textOf(await call("schema"));
    check("schema tool documenta el formato", schema.includes("schemaVersion") && schema.includes("goto"));
    const res = await client.readResource({ uri: "yatt://schema" });
    const res0 = res.contents[0] as { text?: string } | undefined;
    check("recurso yatt://schema", res0?.text?.includes("steps") === true);

    // ---- Validación ----
    const good = await jsonOf("test_validate", {
      content: {
        schemaVersion: 1,
        name: "smoke-test",
        url: base,
        headless: false,
        steps: [
          { action: "goto", value: base },
          { action: "type", selector: "#username", value: "demo" },
          { action: "click", selector: "#submit" },
          { action: "assert_text", selector: "#result", value: "demo" },
        ],
      },
    });
    check("test_validate bueno", good.ok === true && good.doc.steps === 4);
    const bad = await jsonOf("test_validate", { content: "{no es json" });
    check("test_validate malo", bad.ok === false && bad.error.length > 0);
    const future = await jsonOf("test_validate", { content: JSON.stringify({ schemaVersion: 9, steps: [] }) });
    check("test_validate schemaVersion futura", future.ok === false);

    // ---- Crear / listar / leer ----
    const createRes = await call("test_create", {
      content: JSON.stringify({
        schemaVersion: 1,
        name: "smoke-test",
        url: base,
        headless: false,
        steps: [
          { action: "goto", value: base },
          { action: "type", selector: "#username", value: "demo" },
          { action: "click", selector: "#submit" },
          { action: "assert_text", selector: "#result", value: "demo" },
        ],
      }),
    });
    check("test_create", createRes.isError !== true && textOf(createRes).includes('"created": "smoke-test"'));
    const dupRes = await call("test_create", {
      content: { schemaVersion: 1, name: "smoke-test", steps: [] },
    });
    check("test_create duplicado falla", dupRes.isError === true || textOf(dupRes).includes("ya existe"));
    const list = await jsonOf("test_list");
    check("test_list incluye smoke-test", list.tests.includes("smoke-test"));
    const got = await jsonOf("test_get", { name: "smoke-test" });
    check("test_get devuelve el doc", got.doc.name === "smoke-test" && got.doc.steps.length === 4);

    // ---- Update / duplicate / rename / export ----
    const upd = await jsonOf("test_update", {
      name: "smoke-test",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "smoke-test",
        url: base,
        steps: got.doc.steps.concat([{ action: "wait", value: "0.5" }]),
      }),
    });
    check("test_update", upd.ok === true && upd.steps === 5);
    const dup = await jsonOf("test_duplicate", { name: "smoke-test" });
    check("test_duplicate", dup.duplicated === "smoke-test (copia)");
    const ren = await jsonOf("test_rename", { name: "smoke-test (copia)", newName: "smoke-copy" });
    check("test_rename", ren.renamed === "smoke-copy");
    const exp = await jsonOf("test_export_playwright", { name: "smoke-test" });
    check("test_export_playwright", exp.spec.includes("@playwright/test"), `len=${exp.length}`);

    // ---- Navegador en vivo ----
    const opened = await jsonOf("browser_open", { url: base });
    check("browser_open", opened.ok === true);
    const status = await jsonOf("browser_status");
    check("browser_status abierto", status.open === true);
    const preview = await call("browser_preview");
    const previewText = textOf(preview);
    const hasImage = ((preview as { content?: unknown }).content as Array<Record<string, unknown>> | undefined)?.some(
      (c) => c.type === "image" && String(c.data ?? "").length > 100,
    );
    check("browser_preview con imagen", hasImage === true && previewText.includes(base));
    const t = await jsonOf("browser_run_step", { step: { action: "type", selector: "#username", value: "demo" } });
    check("browser_run_step type", t.ok === true);
    const c = await jsonOf("browser_run_step", { step: { action: "click", selector: "#submit" } });
    check("browser_run_step click", c.ok === true);
    const cond = await jsonOf("browser_condition", { selector: "#result" });
    check("browser_condition existe", cond.value === true);
    const ev = await jsonOf("browser_eval", { expression: "document.querySelector('#result').textContent" });
    check("browser_eval lee el DOM", ev.value === "demo", String(ev.value));

    // ---- Pestañas y sesiones ----
    const tabs2 = await jsonOf("tab_open", { url: "about:blank" });
    check("tab_open → 2 pestañas", tabs2.tabs.length === 2);
    const tabsAfterSwitch = await jsonOf("tab_switch", { index: 0 });
    check("tab_switch", tabsAfterSwitch.tabs[0]?.active === true);
    const tabs1 = await jsonOf("tab_close", {});
    check("tab_close", tabs1.tabs.length === 1);
    await jsonOf("session_save", { name: "smoke-ses" });
    const ses = await jsonOf("session_list");
    check("session_save/list", ses.sessions.includes("smoke-ses"));
    await jsonOf("session_delete", { name: "smoke-ses" });

    // ---- Run headless + reportes ----
    const run = await jsonOf("test_run", { name: "smoke-test" });
    // El test se actualizó antes con un paso extra (wait 0.5) → 5 pasos.
    check("test_run pasa", run.fail === 0 && run.ok === 5, `ok=${run.ok} fail=${run.fail}`);
    check("test_run guarda reporte", run.report?.json?.endsWith(".json") === true);
    const reportList = await jsonOf("report_list");
    check("report_list tiene el json", reportList.reports.includes(run.report.json));
    const rep = await jsonOf("report_get", { name: run.report.json });
    check("report_get con forma RunReport", rep.report.kind === "test" && rep.report.ok === 5);
    const resourceRep = await client.readResource({ uri: `yatt://reports/${run.report.json}` });
    const rep0 = resourceRep.contents[0] as { text?: string } | undefined;
    check("recurso yatt://reports/<slug>", rep0?.text?.includes('"kind": "test"') === true);

    // ---- Run con fallo controlado ----
    await call("test_create", {
      name: "smoke-fail",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "smoke-fail",
        url: base,
        steps: [
          { action: "goto", value: base },
          { action: "assert_hidden", selector: "#username" },
        ],
      }),
    });
    const runFail = await jsonOf("test_run", { name: "smoke-fail" });
    check("test_run con fallo", runFail.fail === 1, `fail=${runFail.fail}`);
    await jsonOf("report_delete", { name: runFail.report.json });
    const reportList2 = await jsonOf("report_list");
    check("report_delete", reportList2.reports.includes(runFail.report.json) === false);

    // ---- Baselines (raíz limpia) ----
    const bl = await jsonOf("baseline_list");
    check("baseline_list vacío", bl.count === 0);

    // ---- Limpieza ----
    await call("test_delete", { name: "smoke-test" });
    await call("test_delete", { name: "smoke-fail" });
    await call("test_delete", { name: "smoke-copy" });
    const finalList = await jsonOf("test_list");
    check("test_delete limpia todo", finalList.tests.length === 0);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(SMOKE_ROOT, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nSmoke MCP: TODO VERDE" : `\nSmoke MCP: ${failures} FALLOS`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke MCP falló:", err);
  rmSync(SMOKE_ROOT, { recursive: true, force: true });
  process.exit(1);
});