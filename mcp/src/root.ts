import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resuelve la raíz del proyecto YATT: env YATT_ROOT → flag `--root` → raíz del repo. */
export function resolveRoot(): string {
  const fromEnv = process.env.YATT_ROOT;
  if (fromEnv) return resolve(fromEnv);
  // mcp/src/root.ts → raíz del repo (padre de mcp/).
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * Carpeta del sidecar: los scripts del motor viven SIEMPRE en el repo de YATT
 * (mcp/src/root.ts → ../../sidecar), independientemente de dónde apunte
 * YATT_ROOT (datos: yatt.db, tests/, baselines/…). El MCP puede correr contra
 * una raíz efímera (smoke tests) sin perder el motor.
 */
export const sidecarDir = () => resolve(dirname(fileURLToPath(import.meta.url)), "../../sidecar");

export const testsDir = (root: string) => resolve(root, "tests");
export const reportsDir = (root: string) => resolve(root, "reports");
export const exportsDir = (root: string) => resolve(root, "exports");
export const dbPath = (root: string) => resolve(root, "yatt.db");