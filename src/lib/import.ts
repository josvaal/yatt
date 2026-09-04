import type { Dataset, YattVariable } from "@/lib/vars";
import type { Step, TestFile } from "@/lib/yatt";

/** Versión de esquema que la app sabe leer/escribir (ver defaultTest en yatt.ts). */
const CURRENT_SCHEMA_VERSION = 1;

function normalizeStep(raw: unknown, index: number): Step {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`paso ${index + 1}: debe ser un objeto`);
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.action !== "string" || s.action.trim() === "") {
    throw new Error(`paso ${index + 1}: falta la acción`);
  }
  const step = s as unknown as Step;
  return {
    ...step,
    id: typeof step.id === "string" && step.id ? step.id : crypto.randomUUID(),
    action: step.action,
    children: Array.isArray(step.children)
      ? step.children.map((child, i) => normalizeStep(child, i))
      : undefined,
    elseChildren: Array.isArray(step.elseChildren)
      ? step.elseChildren.map((child, i) => normalizeStep(child, i))
      : undefined,
  };
}

function resolveName(docName: unknown, baseName: string): string {
  if (typeof docName === "string" && docName.trim() && !/[\\/]/.test(docName)) {
    return docName.trim();
  }
  const fromFile = baseName
    .trim()
    .replace(/\.yatt\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/[\\/]/g, "")
    .trim();
  return fromFile || "mi-test";
}

function isDataset(raw: unknown): raw is Dataset {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const d = raw as Record<string, unknown>;
  return Array.isArray(d.columns) && Array.isArray(d.rows);
}

/**
 * Valida y normaliza el contenido de un archivo `.yatt.json` para importarlo.
 * Lanza Error con mensajes en español; el documento devuelto está listo para
 * guardarse vía `test_save` (ids de pasos garantizados, incluyendo anidados).
 */
export function parseImportedTest(content: string, baseName: string): TestFile {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("el archivo no es un JSON válido");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("el archivo no es un objeto JSON");
  }
  const obj = raw as Record<string, unknown>;

  const schemaVersion = obj.schemaVersion;
  if (schemaVersion !== undefined) {
    if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new Error(`schemaVersion inválido: ${String(schemaVersion)}`);
    }
    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `schemaVersion ${schemaVersion} no soportada (máxima: ${CURRENT_SCHEMA_VERSION})`,
      );
    }
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error("el archivo no tiene steps");
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: resolveName(obj.name, baseName),
    url: typeof obj.url === "string" ? obj.url : "",
    headless: obj.headless === true,
    steps: obj.steps.map((step, i) => normalizeStep(step, i)),
    variables: Array.isArray(obj.variables) ? (obj.variables as YattVariable[]) : [],
    envs: Array.isArray(obj.envs) ? obj.envs.filter((e): e is string => typeof e === "string") : [],
    dataset: isDataset(obj.dataset) ? obj.dataset : undefined,
  };
}