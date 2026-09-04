/**
 * Prueba manual profunda del MCP de YATT (más allá del smoke): variables y
 * entornos, estructuras (if/repeat/for_each), sub-flujos (run_flow), dataset
 * real con filas, baselines visuales (captura + asserts), sesiones con
 * cookies, scroll/click_at, casos de error y el transporte HTTP end-to-end.
 *
 *   cd mcp && bun run test/manual.ts
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let failures = 0;
function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(tmpdir(), `yatt-mcp-manual-${process.pid}-${Date.now()}`);
mkdirSync(ROOT, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>YATT Manual</title></head><body>
<h1>YATT Manual</h1>
<input id="username" placeholder="usuario"><button id="submit" type="button">Entrar</button>
<p id="result">sin resultado</p>
<div id="secret">visible</div>
<ul id="items"><li class="item">uno</li><li class="item">dos</li><li class="item">tres</li></ul>
<div style="height:4000px"></div>
<p id="bottom">fondo</p>
<script>
document.getElementById("submit").onclick = () => {
  document.getElementById("result").textContent = document.getElementById("username").value;
};
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url?.startsWith("/other")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Otra página</title><h1>Otra página</h1>");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PAGE);
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/`;

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/server.ts", "--root", ROOT],
    cwd: MCP_DIR,
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "yatt-manual", version: "0.1.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: 240000 });
  const textOf = (res: unknown) =>
    contentOf(res).filter((c) => c.type === "text").map((c) => String(c.text ?? "")).join("\n");
  const contentOf = (res: unknown) =>
    ((res as { content?: unknown }).content ?? []) as Array<Record<string, unknown>>;
  const jsonOf = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(textOf(await call(name, args)));
  const isErr = (res: unknown) => (res as { isError?: boolean }).isError === true;

  // Página y vars-test compartidos por varias secciones.
  const varsTestSteps = [
    { action: "goto", value: base },
    { action: "type", selector: "#username", value: "{{usuario}}" },
    { action: "click", selector: "#submit" },
    { action: "assert_text", selector: "#result", value: "{{usuario}}" },
  ];

  try {
    // ============ 1. Validación: normaliza ids de pasos anidados ============
    const v = await jsonOf("test_validate", {
      content: {
        schemaVersion: 1,
        steps: [
          { action: "repeat", times: 2, children: [{ action: "wait", value: "0.1" }] },
          { action: "if", selector: "#x", elseChildren: [{ action: "wait", value: "0.1" }] },
        ],
      },
    });
    check("validate normaliza ids", v.ok === true && v.doc.steps === 2);

    // ============ 2. Variables + entornos + overrides ============
    await call("test_create", {
      name: "vars-test",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "vars-test",
        url: base,
        steps: varsTestSteps,
        variables: [{ name: "usuario", type: "text", values: { default: "default-user", prod: "prod-user" } }],
        envs: ["dev", "prod"],
      }),
    });
    const runProd = await jsonOf("test_run", { name: "vars-test", env: "prod" });
    check("env prod interpola {{usuario}}", runProd.fail === 0 && runProd.ok === 4, `ok=${runProd.ok}`);
    const runOvr = await jsonOf("test_run", {
      name: "vars-test",
      env: "dev",
      overrides: { usuario: "override-user" },
    });
    check("override gana sobre entorno", runOvr.fail === 0 && runOvr.ok === 4);

    // ============ 3. Estructuras: repeat / for_each / if ============
    await call("test_create", {
      name: "struct-test",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "struct-test",
        url: base,
        steps: [
          { action: "goto", value: base },
          { action: "repeat", times: 2, children: [{ action: "type", selector: "#username", value: "R" }, { action: "wait", value: "0.1" }] },
          { action: "for_each", list: "a,b", itemVar: "letra", children: [{ action: "type", selector: "#username", value: "{{letra}}" }] },
          { action: "click", selector: "#submit" },
          { action: "assert_text", selector: "#result", value: "b" },
          { action: "if", selector: "#secret", children: [{ action: "wait", value: "0.1" }], elseChildren: [{ action: "wait", value: "0.1" }] },
          { action: "if", selector: "#no-existe", children: [{ action: "wait", value: "0.1" }], elseChildren: [{ action: "wait", value: "0.2" }] },
        ],
      }),
    });
    const rs = await jsonOf("test_run", { name: "struct-test" });
    const blockSummary = rs.steps.filter((s: Record<string, unknown>) => s.summary);
    check("struct: todo verde", rs.fail === 0, `ok=${rs.ok} fail=${rs.fail}`);
    // 4 bloques: repeat, for_each y 2× if (cada bloque suma 1 registro con resumen).
    check("struct: bloques con resumen", blockSummary.length === 4, `${blockSummary.length}`);

    // ============ 4. Sub-flujos (run_flow) + export con flujo embebido ============
    await call("test_create", {
      name: "sub-form",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "sub-form",
        steps: [
          { action: "type", selector: "#username", value: "flow" },
          { action: "click", selector: "#submit" },
        ],
      }),
    });
    await call("test_create", {
      name: "flow-main",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "flow-main",
        url: base,
        steps: [
          { action: "goto", value: base },
          { action: "run_flow", flow: "sub-form" },
          { action: "assert_text", selector: "#result", value: "flow" },
        ],
      }),
    });
    const rf = await jsonOf("test_run", { name: "flow-main" });
    // goto + run_flow (bloque) + sus 2 pasos embebidos + assert = 5 registros.
    check("run_flow: todo verde", rf.fail === 0 && rf.ok === 5, `ok=${rf.ok} fail=${rf.fail}`);
    const expFlow = await jsonOf("test_export_playwright", { name: "flow-main" });
    check("export embebe el sub-flujo", expFlow.spec.includes("sub-form") && expFlow.spec.includes("@playwright/test"));

    // ============ 5. Dataset real (filas de overrides) ============
    const ds = await jsonOf("test_run_dataset", {
      name: "vars-test",
      rows: [{ usuario: "a@x.com" }, { usuario: "b@y.com" }],
    });
    check("dataset: 2 filas corridas", ds.rows.length === 2, `${ds.rows.length}`);
    check("dataset: todas en verde", ds.rows.every((r: Record<string, unknown>) => r.fail === 0 && r.ok === 4) && ds.fail === 0);

    // ============ 6. Baselines visuales (captura + assert) ============
    await call("test_create", {
      name: "visual-cap",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "visual-cap",
        url: base,
        steps: [
          { action: "goto", value: base },
          { action: "capture_screenshot", value: "vbase" },
        ],
      }),
    });
    const rc = await jsonOf("test_run", { name: "visual-cap" });
    check("captura baseline", rc.fail === 0);
    const bl = await jsonOf("baseline_list");
    check("baseline_list incluye vbase", bl.baselines.includes("vbase"));
    const bg = await call("baseline_get", { name: "vbase" });
    const bgImage = contentOf(bg).some((c) => c.type === "image");
    check("baseline_get devuelve imagen", bgImage === true && isErr(bg) === false);
    await call("test_create", {
      name: "visual-assert",
      content: JSON.stringify({
        schemaVersion: 1,
        name: "visual-assert",
        url: base,
        steps: [
          { action: "goto", value: base },
          { action: "assert_screenshot", baseline: "vbase", tolerance: 1 },
        ],
      }),
    });
    const ra = await jsonOf("test_run", { name: "visual-assert" });
    check("assert_screenshot contra vbase", ra.fail === 0, `fail=${ra.fail}`);

    // ============ 7. Navegador: evidencia en fallo, scroll, click_at, cookies/sesión ============
    await jsonOf("browser_open", { url: base });
    const failStep = await call("browser_run_step", { step: { action: "assert_hidden", selector: "#secret" } });
    const failText = textOf(failStep);
    const failImage = contentOf(failStep).some((c) => c.type === "image");
    check("paso fallido: error + evidencia imagen", failText.includes('"ok": false') && failImage === true, failText.slice(0, 90));
    const sc = await jsonOf("browser_scroll", { dy: 600 });
    check("scroll avanza", sc.scrollY > 0, `scrollY=${sc.scrollY}`);
    await jsonOf("browser_run_step", { step: { action: "type", selector: "#username", value: "T" } });
    const rect = await jsonOf("browser_eval", {
      expression: "(() => { const r = document.getElementById('submit').getBoundingClientRect(); return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)}; })()",
    });
    await jsonOf("browser_click_at", { x: rect.value.x, y: rect.value.y });
    const afterClick = await jsonOf("browser_eval", { expression: "document.getElementById('result').textContent" });
    check("click_at en coordenadas funciona", afterClick.value === "T", String(afterClick.value));
    await jsonOf("browser_eval", { expression: "document.cookie = 'yattman=1; path=/'" });
    await jsonOf("session_save", { name: "man-ses" });
    await jsonOf("browser_close");
    // La sesión se restaura al abrir; la cookie se lee en el origen real
    // (document.cookie en about:blank es SecurityError por diseño).
    await jsonOf("browser_open", { url: base, session: "man-ses" });
    const cookie = await jsonOf("browser_eval", { expression: "document.cookie" });
    check("sesión restaura cookies", String(cookie.value).includes("yattman=1"), String(cookie.value));
    const tabs2 = await jsonOf("tab_open", { url: base + "other" });
    check("tab_open con otra página", tabs2.tabs.length === 2 && tabs2.tabs[1].url.includes("/other"));
    const evalErr = await call("browser_eval", { expression: "undefinedVar.otraCosa" });
    check("eval con error → isError", isErr(evalErr) === true);

    // ============ 8. Casos de error de gestión ============
    const updMissing = await call("test_update", { name: "no-existe", content: { steps: [] } });
    check("update de test inexistente falla", isErr(updMissing) === true);
    const renCollision = await call("test_rename", { name: "vars-test", newName: "struct-test" });
    check("rename a nombre existente falla", isErr(renCollision) === true);
    const badName = await call("test_create", { name: "a/b", content: { steps: [] } });
    check("nombre con / rechazado", isErr(badName) === true);
    const overwrite = await call("test_create", {
      name: "vars-test",
      overwrite: true,
      content: JSON.stringify({ schemaVersion: 1, name: "vars-test", url: base, steps: varsTestSteps }),
    });
    check("create con overwrite:true reemplaza", isErr(overwrite) === false);
    const getMissing = await call("test_get", { name: "fantasma" });
    check("get de test inexistente falla", isErr(getMissing) === true);

    // ============ 9. Archivo real del repo ============
    const real = await import("node:fs").then((f) => f.readFileSync(join(MCP_DIR, "..", "tests", "mi-test.yatt.json"), "utf8"));
    const rv = await jsonOf("test_validate", { content: real, name: "mi-test" });
    check("valida mi-test.yatt.json real", rv.ok === true && rv.doc.steps === 7, `steps=${rv.doc.steps}`);

    // ============ 10. Transporte HTTP end-to-end ============
    const httpPort = 32000 + (Date.now() % 1000);
    const httpProc = spawn("bun", ["run", "src/server.ts", "--http", "--port", String(httpPort), "--root", ROOT], {
      cwd: MCP_DIR,
      stdio: ["ignore", "ignore", "pipe"],
    });
    await new Promise((r) => setTimeout(r, 1500));
    const httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`));
    const httpClient = new Client({ name: "yatt-http", version: "0.1.0" });
    try {
      await httpClient.connect(httpTransport);
      const hp = await httpClient.callTool({ name: "ping", arguments: {} });
      const hpText = contentOf(hp as unknown).map((c) => String(c.text ?? "")).join("");
      check("HTTP: ping responde", hpText.includes('"ok": true'), hpText.slice(0, 80));
      const hl = await httpClient.callTool({ name: "test_list", arguments: {} });
      const hlText = contentOf(hl as unknown).map((c) => String(c.text ?? "")).join("");
      check("HTTP: test_list funciona", hlText.includes("vars-test"));
    } finally {
      await httpClient.close();
      httpProc.kill();
    }

    // ============ Limpieza ============
    for (const name of ["vars-test", "struct-test", "flow-main", "sub-form", "visual-cap", "visual-assert"]) {
      await call("test_delete", { name });
    }
    const finalList = await jsonOf("test_list");
    check("limpieza completa", finalList.tests.length === 0);

    // baselines del smoke manual limpias (raíz efímera, no importa)
  } catch (err) {
    console.error("EXCEPCIÓN en la prueba manual:", err);
    failures++;
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(ROOT, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nManual MCP: TODO VERDE" : `\nManual MCP: ${failures} FALLOS`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Manual MCP falló:", err);
  rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
});