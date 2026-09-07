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
  chromium: [chromium.executablePath],
  firefox: [firefox.executablePath],
  webkit: [webkit.executablePath],
};

/** True si el motor dado tiene TODOS sus ejecutables descargados. */
export function browserInstalled(engine: string): boolean {
  const paths = ENGINE_EXECUTABLES[engine];
  if (!paths) return true; // motor desconocido: dejar que playwright falle con su mensaje
  return paths.every((p) => {
    try {
      return existsSync(p());
    } catch {
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
  const bundle = (await import("playwright-core/lib/coreBundle")) as unknown as {
    registry: {
      installBrowsersForNpmInstall: (browsers: string[]) => Promise<void>;
    };
  };
  try {
    await bundle.registry.installBrowsersForNpmInstall(["chromium", "chromium-headless-shell"]);
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
