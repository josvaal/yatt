/**
 * Variables, entornos, interpolación y datasets (data-driven).
 *
 * Módulo puro (sin imports de Tauri) para poder testearlo de forma aislada.
 */

export type VarType = "text" | "number" | "option" | "file";

export const ENV_DEFAULT = "default";
export const VAR_TYPES: VarType[] = ["text", "number", "option", "file"];

export interface YattVariable {
  name: string;
  type: VarType;
  /** Lista de opciones válidas cuando type === "option". */
  options?: string[];
  /** Valores por entorno: key = nombre del entorno (o "default"). */
  values: Record<string, string>;
}

export interface Dataset {
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface ResolvedRun {
  vars: Record<string, string>;
  env: string;
}

/** Sustituye {{nombre}} por el valor de la variable (si existe). */
export function interpolate(value: string | undefined, vars: Record<string, string>): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}

export interface StepLike {
  value?: string;
  selector?: string;
  attribute?: string;
}

/** Resuelve los campos interpolables de un paso (value, selector, attribute). */
export function resolveStep<T extends StepLike>(step: T, vars: Record<string, string>): T {
  return {
    ...step,
    value: interpolate(step.value, vars),
    selector: interpolate(step.selector, vars),
    attribute: interpolate(step.attribute, vars),
  };
}

/**
 * Calcula el valor efectivo de cada variable para una corrida:
 * sobrescritura de la corrida ("" = sin sobrescribir) → valor del entorno →
 * default → vacío.
 */
export function resolveVars(
  variables: YattVariable[],
  env: string,
  overrides: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variables) {
    const envVal = v.values?.[env];
    const defVal = v.values?.[ENV_DEFAULT];
    const ov = overrides[v.name];
    out[v.name] = ov !== undefined && ov !== "" ? ov : (envVal ?? defVal ?? "");
  }
  return out;
}

/** Valida el valor de una variable según su tipo; devuelve error o null. */
export function validateVarValue(v: YattVariable, value: string): string | null {
  if (value === undefined || value === null) return null;
  if (v.type === "number" && value.trim() !== "" && !/^-?\d+([.,]\d+)?$/.test(value.trim())) {
    return "debe ser un número";
  }
  if (v.type === "option" && v.options?.length && !v.options.includes(value)) {
    return "debe ser una de las opciones: " + v.options.join(", ");
  }
  return null;
}

/** Parsea CSV simple (comas + comillas): primera fila = nombres de variable. */
export function parseCsv(text: string): Dataset {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { columns: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const columns = parseLine(lines[0]).filter(Boolean);
  const rows = lines.slice(1).map((l) => {
    const vals = parseLine(l);
    const row: Record<string, string> = {};
    columns.forEach((c, i) => {
      row[c] = vals[i] ?? "";
    });
    return row;
  });
  return { columns, rows };
}

/** Nombre de variable válido: solo letras, números, guion bajo y puntos. */
export function validVarName(name: string): boolean {
  return /^[\w.-]+$/.test(name) && !/^\d/.test(name);
}

export function newVariable(name: string, type: VarType = "text"): YattVariable {
  return { name, type, options: type === "option" ? [] : undefined, values: { [ENV_DEFAULT]: "" } };
}