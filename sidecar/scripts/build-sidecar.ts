/**
 * Build del sidecar como ejecutable standalone (bun --compile).
 *
 * Playwright-core asume que vive en un node_modules en disco: hace `require()`
 * con rutas computadas desde `__dirname` y descarga navegadores out-of-process
 * vía `fork(libPath(...))`. En un binario compilado esas rutas apuntan a la
 * máquina de build y todo falla en la máquina del usuario. Este script aplica
 * tres parches idempotentes a playwright-core ANTES de compilar:
 *
 *   P1. Inlining de `require(join(packageRoot, "package.json"))` en
 *       package.js, serverRegistry.js y coreBundle.js (se resuelve al JSON
 *       literal en build time).
 *   P2. Inlining de `require(join(packageRoot, "browsers.json"))` en
 *       coreBundle.js (descriptores de navegadores para launch/install).
 *   P3. Reemplazo de `downloadBrowserWithProgressBarOutOfProcess` (fork con
 *       ruta horneada) por una descarga+extracción in-process equivalente,
 *       reutilizando los helpers ya presentes en el bundle.
 *
 * Uso:
 *   bun run scripts/build-sidecar.ts --outfile ../dist/yatt-sidecar
 *   bun run scripts/build-sidecar.ts --target bun-windows-x64 --outfile ../dist/yatt-sidecar.exe
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const core = resolve(scriptDir, "../node_modules/playwright-core");
const lib = join(core, "lib");

const PATCH_TAG = "/*__YATT_PATCHED__*/";

function fail(msg: string): never {
  console.error(`[build-sidecar] ${msg}`);
  process.exit(1);
}

/** P1: reemplaza `require(<expr>.join(packageRoot, "package.json"))` por el JSON literal. */
function patchPackageJson(path: string, source: string): string {
  const pkgJson = readFileSync(join(core, "package.json"), "utf8");
  const re = /require\((?:import_\w+)(?:\.default)?\.join\(packageRoot, "package\.json"\)\)/g;
  if (!re.test(source)) {
    if (source.includes(PATCH_TAG)) return source;
    fail(`patrón P1 no encontrado en ${path}`);
  }
  return source.replace(re, `${PATCH_TAG} ${pkgJson.trim()}`);
}

/** P2: reemplaza `require(<expr>.join(packageRoot, "browsers.json"))` por el JSON literal. */
function patchBrowsersJson(path: string, source: string): string {
  const browsersJson = readFileSync(join(core, "browsers.json"), "utf8");
  const re = /require\((?:import_\w+)(?:\.default)?\.join\(packageRoot, "browsers\.json"\)\)/g;
  if (!re.test(source)) {
    if (source.includes(PATCH_TAG)) return source;
    fail(`patrón P2 no encontrado en ${path}`);
  }
  return source.replace(re, `${PATCH_TAG} ${browsersJson.trim()}`);
}

/**
 * P3: reemplaza el fork out-of-process por descarga+extracción in-process.
 * Misma semántica que oopDownloadBrowserMain.ts: descargar → vaciar dir →
 * extraer zip → chmod +x → escribir marker INSTALLATION_COMPLETE.
 */
function patchInProcessDownload(path: string, source: string): string {
  if (source.includes("YATT_IN_PROCESS_DOWNLOAD")) return source;
  const signature = "function downloadBrowserWithProgressBarOutOfProcess(";
  const anchor = "\nfunction logPolitely(";
  const start = source.indexOf(signature);
  if (start === -1) fail(`firma P3 no encontrada en ${path}`);
  const end = source.indexOf(anchor, start);
  if (end === -1) fail(`ancla P3 no encontrada en ${path}`);

  const replacement = `function downloadBrowserWithProgressBarOutOfProcess(title, browserDirectory, url3, zipPath, executablePath, socketTimeout) {
  // YATT_IN_PROCESS_DOWNLOAD: parche para builds standalone (bun --compile).
  // El fork(libPath(...)) original usa una ruta de build inexistente en la
  // máquina destino, así que descargamos y extraemos en este mismo proceso,
  // replicando oopDownloadBrowserMain.ts.
  const promise = new ManualPromise();
  const progress2 = getDownloadProgress();
  debugLogger.log("install", "downloading in-process (standalone build)");
  debugLogger.log("install", \`-- from url: \${url3}\`);
  debugLogger.log("install", \`-- to location: \${zipPath}\`);
  let downloadedBytes = 0;
  let totalBytes = 0;
  let chunked = false;
  const reportProgress = !getAsBooleanFromENV("PLAYWRIGHT_DOWNLOAD_NO_PROGRESS");
  httpRequest({
    url: url3,
    headers: { "User-Agent": getUserAgent() },
    socketTimeout
  }, (response2) => {
    if (response2.statusCode !== 200) {
      let content = "";
      const handleError = () => {
        response2.resume();
        promise.resolve({ error: new Error(\`Download failed: server returned code \${response2.statusCode}. URL: \${url3}\`) });
      };
      response2.on("data", (chunk) => content += chunk).on("end", handleError).on("error", handleError);
      return;
    }
    chunked = response2.headers["transfer-encoding"] === "chunked";
    totalBytes = parseInt(response2.headers["content-length"] || "0", 10);
    const file = import_fs17.default.createWriteStream(zipPath);
    file.on("finish", async () => {
      if (!chunked && downloadedBytes !== totalBytes) {
        promise.resolve({ error: new Error(\`Download failed: size mismatch, file size: \${downloadedBytes}, expected size: \${totalBytes}. URL: \${url3}\`) });
        return;
      }
      try {
        await removeFolders([browserDirectory]);
        init_extractZip();
        await extractZip(zipPath, { dir: browserDirectory });
        if (executablePath) {
          debugLogger.log("install", \`fixing permissions at \${executablePath}\`);
          await import_fs17.default.promises.chmod(executablePath, 493);
        }
        await import_fs17.default.promises.writeFile(browserDirectoryToMarkerFilePath(browserDirectory), "");
        promise.resolve({ error: null });
      } catch (e) {
        promise.resolve({ error: e });
      }
    });
    file.on("error", (error) => promise.resolve({ error }));
    response2.pipe(file);
    response2.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      if (!chunked && reportProgress)
        progress2(downloadedBytes, totalBytes);
    });
    response2.on("error", (error) => {
      file.close();
      promise.resolve({ error });
    });
  }, (error) => promise.resolve({ error }));
  return promise;
}`;

  return source.slice(0, start) + replacement + source.slice(end);
}

/**
 * P4: transporte WebSocket en vez de pipe para Chromium.
 *
 * Playwright 1.62 lanza Chromium con `--remote-debugging-pipe` y habla con él
 * por los file descriptors 3/4 heredados. El runtime embebido de bun no pasa
 * esos fds extra a procesos hijos en Windows: Chrome arranca, nunca recibe el
 * canal CDP, y el launch termina en "Timeout 180000ms exceeded" con
 * `<launched>` pero sin conexión. En Linux sí funciona (posix_spawn los
 * duplica bien), por eso el bug sólo se ve en el exe de Windows.
 *
 * Cambiamos a `--remote-debugging-port=0` (WebSocket en un puerto local que
 * Playwright lee del stderr, fd 2, que sí funciona) y desactivamos el
 * transporte pipe en la clase base, que es la que Chromium hereda. Firefox ya
 * usa puerto, y WebKit sobrescribe el método: no cambian.
 */
function patchWebSocketTransport(path: string, source: string): string {
  if (source.includes("YATT_WS_TRANSPORT")) {
    // Idempotente: verificar que ambos cambios estén aplicados.
    if (source.includes('push("--remote-debugging-port=0"); /*YATT_WS_TRANSPORT*/'))
      return source;
    fail(`P4 marcado pero incompleto en ${path}`);
  }
  const pushPattern = 'chromeArguments.push("--remote-debugging-pipe");';
  if (!source.includes(pushPattern)) fail(`patrón P4a no encontrado en ${path}`);
  source = source.replace(
    pushPattern,
    'chromeArguments.push("--remote-debugging-port=0"); /*YATT_WS_TRANSPORT*/',
  );
  const supportsPattern = `supportsPipeTransport(options) {
        return true;
      }`;
  if (!source.includes(supportsPattern)) fail(`patrón P4b no encontrado en ${path}`);
  source = source.replace(
    supportsPattern,
    `supportsPipeTransport(options) {
        /*YATT_WS_TRANSPORT*/ return false;
      }`,
  );
  // P4c: el override de Chromium pasa las launch options tal cual, y el
  // helper sólo espera el endpoint si ve el flag en `options.args` (que son
  // los argumentos del USUARIO, no los del proceso). Sin esto, el wsEndpoint
  // queda undefined ("Invalid URL: undefined").
  const readyPattern = "return waitForReadyState(options, browserLogsCollector);";
  if (!source.includes(readyPattern)) fail(`patrón P4c no encontrado en ${path}`);
  source = source.replace(
    readyPattern,
    'return waitForReadyState({ ...options, args: ["--remote-debugging-port=0"] }, browserLogsCollector); /*YATT_WS_TRANSPORT*/',
  );
  return source;
}

/** Aplica (o verifica ya aplicados) los parches. Backups .orig solo la primera vez. */
/** P4 sólo bajo --ws-transport: el transporte WebSocket de bun-compile cuelga
 *  incluso en Linux (<ws connecting> y silencio: el cliente `ws` de bun no
 *  termina el handshake en binarios compilados). Con runtime=node los pipes
 *  funcionan nativamente y P4 no hace falta. Queda el flag por si algún día
 *  hay que revivir bun en Windows. */
function applyPatches(opts: { wsTransport: boolean }): void {
  const targets: Array<[string, (p: string, s: string) => string]> = [
    ["package.js", patchPackageJson],
    ["serverRegistry.js", patchPackageJson],
    [
      "coreBundle.js",
      (p, s) => {
        let out = patchBrowsersJson(p, patchPackageJson(p, patchInProcessDownload(p, s)));
        if (opts.wsTransport) out = patchWebSocketTransport(p, out);
        return out;
      },
    ],
  ];
  for (const [name, patcher] of targets) {
    const path = join(lib, name);
    const origPath = `${path}.orig`;
    if (!existsSync(origPath)) copyFileSync(path, origPath);
    const original = readFileSync(origPath, "utf8");
    const patched = patcher(path, original);
    if (patched !== original) {
      writeFileSync(path, patched);
      console.log(`[build-sidecar] parcheado: ${name}`);
    } else {
      console.log(`[build-sidecar] ya parcheado: ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const hasFlag = (flag: string) => args.includes(flag);
  const runtime = getArg("--runtime") ?? "bun"; // bun | node (SEA)
  const target = getArg("--target"); // ej. bun-windows-x64; default: host
  const outfile = getArg("--outfile");
  if (!outfile) fail("falta --outfile");
  const outPath = resolve(scriptDir, "..", outfile);
  const sidecarDir = resolve(scriptDir, "..");

  if (runtime === "node") {
    // Host SEA: por defecto el node.exe de Windows; --host para probar en el
    // host local (p. ej. el binario de Node de Linux) con el mismo pipeline.
    await buildNodeSea({ outPath, sidecarDir, hostOverride: getArg("--host") });
    return;
  }

  applyPatches({ wsTransport: hasFlag("--ws-transport") });

  const entry = resolve(scriptDir, "../src/index.ts");
  const cmd = ["build", "--compile"];
  if (target) cmd.push(`--target=${target}`);
  cmd.push(entry, `--outfile=${outPath}`);
  console.log(`[build-sidecar] bun ${cmd.join(" ")}`);
  const proc = Bun.spawn(["bun", ...cmd], { cwd: sidecarDir, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) fail(`bun build terminó con código ${code}`);
  console.log(`[build-sidecar] listo: ${outfile}`);
}

/**
 * Build del sidecar como Single Executable Application de Node.
 *
 * Motivación: bun-compile rompe en Windows dos cosas que Playwright necesita
 * (fds 3/4 para --remote-debugging-pipe, y el handshake del cliente `ws`), y
 * la PC destino no tiene Node instalado. SEA incrusta el bundle + los assets
 * del runtime en una copia del binario oficial de Node: un solo .exe, con el
 * runtime que Playwright soporta oficialmente.
 *
 * Los parches P1-P3 siguen siendo necesarios: las rutas horneadas de
 * `__dirname` no existen en la máquina destino, y `fork(libPath(...))` de la
 * descarga apunta a rutas de build.
 *
 * Requiere `sea/node-win.exe` (Node oficial de Windows, sin modificar) y un
 * Node local (>= 20) para generar el blob.
 */
async function buildNodeSea(opts: {
  outPath: string;
  sidecarDir: string;
  hostOverride?: string;
}): Promise<void> {
  const { outPath, sidecarDir } = opts;
  const seaDir = join(sidecarDir, "sea");
  mkdirSync(seaDir, { recursive: true });
  const hostBinary = opts.hostOverride
    ? resolve(scriptDir, "..", opts.hostOverride)
    : join(seaDir, "node-win.exe");
  if (!existsSync(hostBinary)) {
    fail(
      `falta ${hostBinary}: descargá el binario oficial de Node (sin modificar, es el host del SEA) o pasá --host <ruta>`,
    );
  }

  // El bundle debe regenerarse desde los node_modules PRISTINOS (.orig) con
  // P1-P3 pero SIN P4: bajo Node real el transporte pipe funciona.
  applyPatches({ wsTransport: false });

  const bundle = join(seaDir, "bundle.cjs");
  const entry = resolve(scriptDir, "../src/index.ts");
  await run(["bun", "build", "--target=node", "--format=cjs", entry, `--outfile=${bundle}`], sidecarDir);

  const seaConfig = join(seaDir, "sea-config.json");
  writeFileSync(
    seaConfig,
    JSON.stringify(
      {
        main: bundle,
        output: join(seaDir, "sea-prep.blob"),
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  );
  await run(["node", "--experimental-sea-config", seaConfig], sidecarDir);

  // Host: copia del binario oficial de Node + inyección del blob (postject).
  copyFileSync(hostBinary, outPath);
  await run(
    [
      "bunx",
      "postject",
      outPath,
      "NODE_SEA_BLOB",
      join(seaDir, "sea-prep.blob"),
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ],
    sidecarDir,
  );
  console.log(`[build-sidecar] listo (node SEA): ${outPath}`);
}

async function run(cmd: string[], cwd: string): Promise<void> {
  console.log(`[build-sidecar] ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) fail(`"${cmd[0]} ..." terminó con código ${code}`);
}

main();
