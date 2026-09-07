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

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
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

/** Aplica (o verifica ya aplicados) los parches. Backups .orig solo la primera vez. */
function applyPatches(): void {
  const targets: Array<[string, (p: string, s: string) => string]> = [
    ["package.js", patchPackageJson],
    ["serverRegistry.js", patchPackageJson],
    ["coreBundle.js", (p, s) => patchBrowsersJson(p, patchPackageJson(p, patchInProcessDownload(p, s)))],
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
  const target = getArg("--target"); // ej. bun-windows-x64; default: host
  const outfile = getArg("--outfile");
  if (!outfile) fail("falta --outfile");

  applyPatches();

  const entry = resolve(scriptDir, "../src/index.ts");
  const cmd = ["build", "--compile"];
  if (target) cmd.push(`--target=${target}`);
  cmd.push(entry, `--outfile=${resolve(scriptDir, "..", outfile)}`);
  console.log(`[build-sidecar] bun ${cmd.join(" ")}`);
  const proc = Bun.spawn(["bun", ...cmd], { cwd: resolve(scriptDir, ".."), stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) fail(`bun build terminó con código ${code}`);
  console.log(`[build-sidecar] listo: ${outfile}`);
}

main();
