/**
 * Smoke test de YATT por SECCIONES AISLADAS: cada sección arranca su propio
 * sidecar y cierra al terminar. Así una sección no puede contaminar a la
 * siguiente (el bus de procesos del motor es sensible a demasiada rotación
 * de browsers en una sola sesión).
 *
 * Uso:
 *   bun run test/smoke.ts            # todas las secciones
 *   bun run test/smoke.ts form       # solo una sección
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Logs por stderr (sin buffering) para seguir el progreso en vivo.
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

const cwd = resolve(import.meta.dir, "..");

interface Sidecar {
  req(method: string, params: any, timeoutMs?: number): Promise<any>;
  events: any[];
  child: ChildProcessWithoutNullStreams;
}

function spawnSidecar(): Sidecar {
  const child = spawn("bun", ["run", "src/index.ts"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  const waiters: Record<number, (m: any) => void> = {};
  const events: any[] = [];
  let seq = 1;

  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.type === "response" && typeof m.id === "number" && waiters[m.id]) {
        waiters[m.id](m);
        delete waiters[m.id];
      } else if (m.type === "event") {
        events.push(m);
        console.log("  [event]", m.name, JSON.stringify(m.data ?? {}).slice(0, 140));
      }
    }
  });

  const s: Sidecar = {
    events,
    child,
    req(method: string, params: any, timeoutMs = 60000): Promise<any> {
      const id = seq++;
      return new Promise((resolveP, reject) => {
        const t = setTimeout(() => {
          delete waiters[id];
          reject(new Error(`timeout en ${method}`));
        }, timeoutMs);
        waiters[id] = (m) => {
          clearTimeout(t);
          resolveP(m);
        };
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    },
  };
  return s;
}

interface Section {
  name: string;
  run(s: Sidecar, assert: (cond: boolean, label: string) => void): Promise<void>;
}

let globalFails = 0;
function makeAssert(section: string) {
  return (cond: boolean, label: string) => {
    console.log((cond ? "  ✓ " : "  ✗ FAIL ") + label);
    if (!cond) globalFails++;
  };
}

async function runSection(sec: Section) {
  console.log(`\n=== Sección: ${sec.name} ===`);
  const s = spawnSidecar();
  const assert = makeAssert(sec.name);
  try {
    await sec.run(s, assert);
  } catch (err) {
    console.log("  ✗ FAIL sección abortada:", String(err).slice(0, 200));
    globalFails++;
  } finally {
    s.child.stdin.end();
    await new Promise((r) => setTimeout(r, 300));
    s.child.kill();
  }
}

const URL = "https://example.com";

const core: Section = {
  name: "core",
  async run(s, assert) {
    const ping = await s.req("ping", {});
    assert(ping.ok === true, "ping responde");

    const open = await s.req("open", { url: URL, headless: true });
    assert(open.ok === true, "chromium abre " + URL);

    const click = await s.req("run_step", { step: { action: "click", selector: "h1" } });
    assert(click.ok === true, "click en h1");
    const hover = await s.req("run_step", { step: { action: "hover", selector: "a" } });
    assert(hover.ok === true, "hover en link");
    const shot = await s.req("run_step", { step: { action: "screenshot" } });
    assert(
      shot.ok === true && typeof shot.result?.screenshot === "string" && shot.result.screenshot.length > 1000,
      "screenshot base64 ok",
    );

    const bad = await s.req("run_step", { step: { action: "click", selector: "#no-existe-xyz" } });
    assert(bad.ok === false && typeof bad.error === "string", "fallo controlado: " + String(bad.error).slice(0, 60));
    assert(typeof bad.result?.screenshot === "string" && bad.result.screenshot.length > 0, "evidencia en fallo");

    // Timeout configurable por paso (RF-15): un wait largo con timeout corto corta.
    const timeouts = await s.req("run_step", { step: { action: "wait", value: "3000" }, timeoutMs: 150 });
    assert(
      timeouts.ok === false && String(timeouts.error).includes("timeout"),
      "timeout configurable corta el paso: " + String(timeouts.error).slice(0, 60),
    );

    await s.req("close", {});
    const noPage = await s.req("run_step", { step: { action: "click", selector: "h1" } });
    assert(noPage.ok === false, "run_step sin browser da error claro");
  },
};

const toolbar: Section = {
  name: "toolbar",
  async run(s, assert) {
    await s.req("open", { url: URL, headless: true });

    const before = s.events.length;
    const rec = await s.req("eval", {
      expression: "window.__yattRecord({ action: 'dblclick', selector: 'h1' }).then(r => JSON.stringify(r))",
    });
    assert(rec.ok === true && String(rec.result ?? "").includes('"ok":true'), "__yattRecord ejecuta el paso");
    await new Promise((r) => setTimeout(r, 300));
    const captured = s.events.slice(before).find((e) => e.name === "action_captured");
    assert(captured?.data?.step?.action === "dblclick" && captured?.data?.result?.ok === true, "evento action_captured ok");

    // Flujo armar → clic en el objetivo.
    await s.req("eval", { expression: "document.querySelector('.yatt-a[data-a=\"click\"]').click()" });
    await new Promise((r) => setTimeout(r, 150));
    const before2 = s.events.length;
    await s.req("eval", {
      expression:
        "document.querySelector('h1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 500));
    const capt2 = s.events.slice(before2).find((e) => e.name === "action_captured");
    assert(
      capt2?.data?.step?.action === "click" && capt2?.data?.step?.selector === "h1" && capt2?.data?.result?.ok === true,
      "captura tras armar + clic (selector h1)",
    );

    // Esc cancela la captura armada.
    await s.req("eval", { expression: "document.querySelector('.yatt-a[data-a=\"hover\"]').click()" });
    await new Promise((r) => setTimeout(r, 150));
    const before3 = s.events.length;
    await s.req("eval", {
      expression:
        "document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 150));
    await s.req("eval", {
      expression: "document.querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 400));
    const capt3 = s.events.slice(before3).find((e) => e.name === "action_captured");
    assert(!capt3, "sin captura tras cancelar con Esc");
  },
};

const preview: Section = {
  name: "preview",
  async run(s, assert) {
    await s.req("open", { url: "data:text/html,<div%20style='height:3000px'>alto</div>", headless: true });
    const pv1 = await s.req("preview", {});
    assert(typeof pv1.result?.screenshot === "string" && pv1.result.screenshot.length > 1000, "preview con screenshot");
    assert(pv1.result?.width === 1280 && pv1.result?.height === 800, "viewport 1280x800");
    assert(pv1.result?.maxScrollY >= 2000, "maxScrollY detecta contenido alto");
    const sc = await s.req("scroll_to", { x: 0, y: 5000 });
    assert(sc.ok === true && sc.result?.scrollY >= 2000, "scroll abajo " + sc.result?.scrollY);
    const up = await s.req("scroll_to", { x: 0, y: 0 });
    assert(up.ok === true && up.result?.scrollY === 0, "scroll arriba vuelve a 0");
    const by = await s.req("scroll_by", { dx: 0, dy: -150 });
    assert(by.ok === true, "scroll_by (rueda) ok");
    const cl = await s.req("click_at", { x: 640, y: 400 });
    assert(cl.ok === true && typeof cl.result?.screenshot === "string", "click_at por coordenadas ok");
  },
};

const FORM =
  "data:text/html,<form><input%20id='user'><select%20id='opt'><option%20value='a'>Uno</option><option%20value='b'>Dos</option></select><input%20type='checkbox'%20id='ck'><input%20type='file'%20id='fx'><button%20id='go'>Go</button></form>";

const runStep = (s: Sidecar, action: string, step: Record<string, unknown>) =>
  s.req("run_step", { step: { action, ...step } });

const form: Section = {
  name: "form (RF-04)",
  async run(s, assert) {
    await s.req("open", { url: FORM, headless: true });

    assert((await runStep(s, "type", { selector: "#user", value: "pepe" })).ok === true, "escribir en #user");
    assert((await runStep(s, "assert_value", { selector: "#user", value: "pepe" })).ok === true, "assert valor #user");
    assert((await runStep(s, "select_option", { selector: "#opt", value: "b" })).ok === true, "select opción b");
    assert((await runStep(s, "assert_value", { selector: "#opt", value: "b" })).ok === true, "assert select vale b");
    assert((await runStep(s, "check", { selector: "#ck" })).ok === true, "marcar checkbox");
    assert((await runStep(s, "press_key", { selector: "#user", value: "Control+A" })).ok === true, "tecla Control+A");
    assert((await runStep(s, "clear", { selector: "#user" })).ok === true, "limpiar #user");
    assert((await runStep(s, "assert_value", { selector: "#user", value: "" })).ok === true, "assert #user vacío");
    assert((await runStep(s, "assert_visible", { selector: "#go" })).ok === true, "assert visible #go");
    assert((await runStep(s, "assert_visible", { selector: "#no-existe" })).ok === false, "assert visible inexistente falla");
    assert((await runStep(s, "assert_hidden", { selector: "#no-existe" })).ok === true, "assert oculto inexistente pasa");
    assert((await runStep(s, "assert_text", { selector: "#go", value: "Go" })).ok === true, "assert texto #go");
    assert((await runStep(s, "wait_visible", { selector: "#go" })).ok === true, "esperar visible #go");
    assert((await runStep(s, "scroll_to_element", { selector: "#go" })).ok === true, "scroll al elemento #go");

    const uploadPath = "/tmp/yatt-upload-test.txt";
    writeFileSync(uploadPath, "contenido de prueba");
    assert(
      (await runStep(s, "upload", { selector: "#fx", value: uploadPath })).ok === true,
      "subir archivo al input #fx",
    );
    assert(
      (await runStep(s, "upload", { selector: "#fx", value: "" })).ok === false,
      "upload sin ruta falla con error claro",
    );
  },
};

const grab: Section = {
  name: "grab (re-grabado)",
  async run(s, assert) {
    await s.req("open", { url: FORM, headless: true });

    const sg = await s.req("start_grab", {});
    assert(sg.ok === true, "start_grab activa el modo");
    await new Promise((r) => setTimeout(r, 200));
    await s.req("eval", {
      expression:
        "document.querySelector('#user').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 400));
    const capG = s.events.find((e) => e.name === "grab_result" && e.data?.selector);
    assert(capG?.data?.selector === "#user", "grab_result con selector #user");
    s.events.length = 0;

    const sg2 = await s.req("start_grab", {});
    assert(sg2.ok === true, "segundo start_grab");
    await new Promise((r) => setTimeout(r, 200));
    await s.req("eval", {
      expression:
        "document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 300));
    const capG2 = s.events.find((e) => e.name === "grab_result");
    assert(capG2 && capG2.data?.selector === "", "Esc cancela el re-grabado (selector vacío)");
  },
};

const vars: Section = {
  name: "vars",
  async run(s, assert) {
    await s.req("open", {
      url: "data:text/html,<input%20id='campo'>",
      headless: true,
      variables: ["usuario", "plan"],
    });
    // Espera el montaje de la barra (init script + poll de 15 ms).
    await new Promise((r) => setTimeout(r, 300));

    // Al armar Escribir y elegir el objetivo aparece el desplegable de variables.
    await s.req("eval", { expression: "document.querySelector('.yatt-a[data-a=\"type\"]').click()" });
    await new Promise((r) => setTimeout(r, 150));
    await s.req("eval", {
      expression:
        "document.querySelector('#campo').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 300));
    const opts = await s.req("eval", {
      expression: "JSON.stringify(Array.from(document.querySelectorAll('.yatt-var option')).map((o) => o.value))",
    });
    assert(
      String(opts.result).includes('"usuario"') && String(opts.result).includes('"plan"'),
      "desplegable de variables lista usuario y plan",
    );

    // Elegir una variable inserta {{nombre}} en el campo de valor.
    await s.req("eval", {
      expression:
        "var v = document.querySelector('.yatt-var'); v.value = 'usuario'; v.dispatchEvent(new Event('change', { bubbles: true }));",
    });
    await new Promise((r) => setTimeout(r, 100));
    const val = await s.req("eval", { expression: "document.querySelector('.yatt-inp').value" });
    assert(val.result === "{{usuario}}", "inserta {{usuario}} en el valor");

    // OK captura el paso con el valor interpolable.
    const before = s.events.length;
    await s.req("eval", { expression: "document.querySelector('.yatt-ctxok').click()" });
    await new Promise((r) => setTimeout(r, 500));
    const capt = s.events.slice(before).find((e) => e.name === "action_captured");
    assert(
      capt?.data?.step?.action === "type" && capt?.data?.step?.value === "{{usuario}}",
      "paso type con valor {{usuario}}",
    );

    // toolbar_vars refresca la lista en vivo sin reabrir el navegador.
    await s.req("toolbar_vars", { variables: ["usuario", "nuevo"] });
    await new Promise((r) => setTimeout(r, 200));
    // Vuelve a abrir el panel (armar Escribir + clic en el objetivo) con el nuevo set.
    await s.req("eval", { expression: "document.querySelector('.yatt-a[data-a=\"type\"]').click()" });
    await new Promise((r) => setTimeout(r, 150));
    await s.req("eval", {
      expression:
        "document.querySelector('#campo').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))",
    });
    await new Promise((r) => setTimeout(r, 300));
    const after = await s.req("eval", {
      expression: "JSON.stringify(Array.from(document.querySelectorAll('.yatt-var option')).map((o) => o.value))",
    });
    assert(
      String(after.result).includes('"nuevo"') && !String(after.result).includes('"plan"'),
      "toolbar_vars refresca la lista sin reabrir",
    );

    await s.req("close", {});
  },
};

const SECTIONS: Section[] = [core, toolbar, preview, form, vars, grab];

// Sección opcional (abre una ventana real en el display): se ejecuta solo si se
// pide explícitamente, para no molestar en la suite por defecto.
const windowSync: Section = {
  name: "window-sync",
  async run(s, assert) {
    await s.req("open", { url: "data:text/html,<div%20style='height:3000px'>alto</div>", headless: false });
    await new Promise((r) => setTimeout(r, 900)); // deja que el CDP se conecte
    const ws = await s.req("window_sync_now", {});
    assert(ws.ok === true, "sincronización de ventana responde");

    // Redimensiona la ventana real vía CDP y comprueba que el viewport le sigue
    // (dentro del grosor del marco, que se autoclibra).
    const rs = await s.req("window_resize", { width: 900, height: 620 });
    const vp = rs.result ?? {};
    assert(
      rs.ok === true && typeof vp.width === "number" && vp.width >= 320 && vp.width < 1000,
      "viewport sigue a la ventana tras resize: " + vp.width + "x" + vp.height,
    );
  },
};

const EXTRA_SECTIONS: Section[] = [windowSync];

const only = process.argv[2];
const toRun = only ? [...SECTIONS, ...EXTRA_SECTIONS].filter((s) => s.name === only) : SECTIONS;
if (toRun.length === 0) {
  console.log("Sección desconocida:", only, "· disponibles:", [...SECTIONS, ...EXTRA_SECTIONS].map((s) => s.name).join(", "));
  process.exit(2);
}

for (const sec of toRun) {
  await runSection(sec);
}

console.log(`\nResultado: ${globalFails === 0 ? "TODO OK" : "FALLÓ " + globalFails + " comprobación(es)"}`);
process.exit(globalFails === 0 ? 0 : 1);