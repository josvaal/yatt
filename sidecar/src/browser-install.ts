/**
 * Auto-instalación de navegadores en builds distribuidos.
 *
 * En una máquina de usuario final los navegadores de Playwright no existen
 * (viven en el caché del sistema, p. ej. %LOCALAPPDATA%\ms-playwright).
 * Antes del primer `launch` verificamos los ejecutables y, si falta alguno,
 * lo descargamos usando la misma API que usa el postinstall de Playwright.
 */

import { existsSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

type ProgressFn = (name: string, data: Record<string, unknown>) => void;

/**
 * Ejecutables requeridos por cada motor. El launch headless de chromium usa
 * `chromium-headless-shell` (binario aparte del chromium completo), así que un
 * `open headless:true` necesita ambos descargados.
 */
const ENGINE_EXECUTABLES: Record<string, Array<() => string>> = {
  // BINDEADOS: guardando la referencia sin `.bind()` el `this` se pierde al
  // invocarla y playwright lanza "Cannot read properties of undefined
  // (reading '_initializer')" → el check fallaba siempre → reinstalaba.
  chromium: [chromium.executablePath.bind(chromium)],
  firefox: [firefox.executablePath.bind(firefox)],
  webkit: [webkit.executablePath.bind(webkit)],
};

/** True si el motor dado tiene TODOS sus ejecutables descargados. */
export function browserInstalled(engine: string): boolean {
  const paths = ENGINE_EXECUTABLES[engine];
  if (!paths) return true; // motor desconocido: dejar que playwright falle con su mensaje
  return paths.every((p) => {
    try {
      return existsSync(p());
    } catch (err) {
      // Si la resolución interna lanza (registry roto en el bundle), NO hay
      // que enmudecerlo: sin este log sería invisible y reinstalaría siempre.
      console.error(
        `[yatt] browserInstalled(${engine}): resolución de ejecutable falló:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  });
}

/**
 * Garantiza que el navegador solicitado esté disponible. Sólo auto-instala
 * chromium (el motor por defecto); para otros motores lanza un error claro.
 */
export async function ensureBrowser(
  engine: string,
  emit: ProgressFn,
  existsFn: (engine: string) => boolean = browserInstalled,
): Promise<void> {
  if (existsFn(engine)) return;
  if (engine !== "chromium") {
    throw new Error(
      `El motor '${engine}' no está descargado. Ejecutá 'npx playwright install ${engine}' y volvé a intentar.`,
    );
  }
  emit("browser_install_started", { engine });
  // `registry.install()` es el camino del CLI (`npx playwright install`):
  // lock + descarga + marker. En cambio `installBrowsersForNpmInstall` usa el
  // mecanismo `.links` de npm: registra el paquete instalador y al validar la
  // caché BORRA como "stale" todo navegador cuyo link no resuelva. En un exe
  // standalone el link apunta a rutas del paquete que no existen → borraba e
  // reinstalaba el navegador en cada corrida.
  //
  //registry.install() también corre esa GC al empezar; el escape oficial es
  // PLAYWRIGHT_SKIP_BROWSER_GC. Sin esto, en la máquina del usuario el
  // navegador se descargaba una y otra vez en cada reinicio de la app.
  process.env.PLAYWRIGHT_SKIP_BROWSER_GC = "1";
  // coreBundle exporta el namespace `registry`; la INSTANCIA viva del
  // registro (findExecutable/install) está en `registry.registry`.
  const bundle = (await import("playwright-core/lib/coreBundle")) as unknown as {
    registry: {
      registry: {
        findExecutable: (name: string) => unknown;
        install: (executables: unknown[]) => Promise<void>;
      };
    };
  };
  const registry = bundle.registry.registry;
  const executables = ["chromium", "chromium-headless-shell"]
    .map((name) => registry.findExecutable(name))
    .filter(Boolean);
  if (executables.length === 0) {
    emit("browser_install_failed", { engine, error: "registry sin ejecutables chromium" });
    throw new Error("El registro de Playwright no expone el navegador chromium.");
  }
  try {
    await registry.install(executables);
  } catch (err) {
    emit("browser_install_failed", {
      engine,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      "No se pudo descargar Chromium automáticamente. Revisá la conexión a internet e intentá de nuevo.",
    );
  }
  emit("browser_install_finished", { engine });
}
