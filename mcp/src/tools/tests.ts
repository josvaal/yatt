import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { buildPlaywrightSpec } from "../../../src/lib/export.ts";
import { parseImportedTest } from "../../../src/lib/import.ts";
import type { TestFile } from "../../../src/lib/yatt.ts";
import { Store } from "../db.ts";
import type { Ctx } from "../ctx.ts";
import { exportsDir } from "../root.ts";

/** Acepta el contenido de un test como string JSON o como objeto. */
const contentSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

export function coerceOverrides(v: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v ?? {})) {
    out[k] = val === undefined || val === null ? "" : String(val);
  }
  return out;
}

/** Convierte el argumento de un tool (string JSON u objeto) en TestFile validado. */
export function toDoc(content: unknown, name?: string): TestFile {
  const raw = typeof content === "string" ? content : JSON.stringify(content ?? null);
  const doc = parseImportedTest(raw, name ?? "test");
  if (name) doc.name = name;
  return doc;
}

export function docSummary(doc: TestFile): Record<string, unknown> {
  return {
    name: doc.name,
    url: doc.url,
    headless: doc.headless,
    steps: doc.steps.length,
    variables: (doc.variables ?? []).length,
    envs: doc.envs ?? [],
    dataset: doc.dataset
      ? `${doc.dataset.rows.length} filas × ${doc.dataset.columns.length} columnas`
      : null,
  };
}

export function text(parts: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof parts === "string" ? parts : JSON.stringify(parts, null, 2),
      },
    ],
  };
}

const nameArg = z.string().describe("Nombre del test guardado");

export function registerTestTools(server: McpServer, ctx: Ctx): void {
  const { store } = ctx;

  server.registerTool(
    "test_list",
    {
      description: "Lista los tests guardados en la biblioteca de YATT (nombres).",
      inputSchema: z.object({}),
    },
    async () => {
      const tests = store.testList();
      return text({ count: tests.length, tests });
    },
  );

  server.registerTool(
    "test_get",
    {
      description:
        "Obtiene un test guardado como objeto JSON completo (steps, variables, entornos, dataset).",
      inputSchema: z.object({ name: nameArg }),
    },
    async (args) => {
      const name = Store.sanitizeName(args.name);
      const content = store.testGet(name);
      if (content === null) throw new Error(`el test "${name}" no existe`);
      return text({ name, doc: JSON.parse(content) });
    },
  );

  server.registerTool(
    "test_create",
    {
      description:
        "Crea un test nuevo. Acepta el contenido como string JSON o como objeto. Valida el esquema (schemaVersion, steps, acciones). Falla si el nombre ya existe salvo overwrite: true.",
      inputSchema: z.object({
        content: contentSchema.describe("Contenido del test: string JSON u objeto"),
        name: z.string().optional().describe("Nombre con el que se guarda (opcional)"),
        overwrite: z.boolean().optional().describe("Sobrescribir si ya existe (default false)"),
      }),
    },
    async (args) => {
      const doc = toDoc(args.content, args.name);
      if (store.testExists(doc.name) && !args.overwrite) {
        throw new Error(`el test "${doc.name}" ya existe (usá test_update o overwrite: true)`);
      }
      const json = JSON.stringify(doc, null, 2);
      await store.upsertTest(doc.name, json);
      return text({ ok: true, created: doc.name, ...docSummary(doc) });
    },
  );

  server.registerTool(
    "test_update",
    {
      description:
        "Reemplaza el contenido completo de un test existente (misma validación que test_create).",
      inputSchema: z.object({
        name: nameArg.describe("Nombre del test a reemplazar"),
        content: contentSchema.describe("Nuevo contenido: string JSON u objeto"),
      }),
    },
    async (args) => {
      const name = Store.sanitizeName(args.name);
      if (!store.testExists(name)) throw new Error(`el test "${name}" no existe (usá test_create)`);
      const doc = toDoc(args.content, name);
      await store.upsertTest(name, JSON.stringify(doc, null, 2));
      return text({ ok: true, updated: name, ...docSummary(doc) });
    },
  );

  server.registerTool(
    "test_delete",
    {
      description: "Borra un test de la biblioteca (base de datos y archivo tests/<nombre>.yatt.json).",
      inputSchema: z.object({ name: nameArg }),
    },
    async (args) => {
      const name = Store.sanitizeName(args.name);
      if (!store.testExists(name)) throw new Error(`el test "${name}" no existe`);
      await store.deleteTest(name);
      return text({ ok: true, deleted: name });
    },
  );

  server.registerTool(
    "test_rename",
    {
      description: "Renombra un test en la biblioteca (actualiza BD y archivo espejo).",
      inputSchema: z.object({
        name: nameArg.describe("Nombre actual"),
        newName: z.string().describe("Nuevo nombre"),
      }),
    },
    async (args) => {
      const name = Store.sanitizeName(args.name);
      const newName = Store.sanitizeName(args.newName);
      if (name === newName) return text({ ok: true, renamed: name });
      if (store.testExists(newName)) throw new Error(`ya existe un test llamado "${newName}"`);
      const content = store.testGet(name);
      if (content === null) throw new Error(`el test "${name}" no existe`);
      const doc = JSON.parse(content) as TestFile;
      doc.name = newName;
      await store.upsertTest(newName, JSON.stringify(doc, null, 2));
      await store.deleteTest(name);
      return text({ ok: true, renamed: newName });
    },
  );

  server.registerTool(
    "test_duplicate",
    {
      description: 'Duplica un test existente con un nombre nuevo (default "<nombre> (copia)").',
      inputSchema: z.object({
        name: nameArg,
        newName: z.string().optional().describe("Nombre de la copia (opcional)"),
      }),
    },
    async (args) => {
      const name = Store.sanitizeName(args.name);
      const content = store.testGet(name);
      if (content === null) throw new Error(`el test "${name}" no existe`);
      let newName = args.newName ? Store.sanitizeName(args.newName) : `${name} (copia)`;
      if (store.testExists(newName)) throw new Error(`ya existe un test llamado "${newName}"`);
      const doc = JSON.parse(content) as TestFile;
      doc.name = newName;
      await store.upsertTest(newName, JSON.stringify(doc, null, 2));
      return text({ ok: true, duplicated: newName });
    },
  );

  server.registerTool(
    "test_validate",
    {
      description:
        "Valida contenido de test (string JSON u objeto) sin guardarlo. Devuelve {ok: true, doc: resumen} o {ok: false, error}. Útil antes de test_create/test_update.",
      inputSchema: z.object({
        content: contentSchema.describe("Contenido a validar: string JSON u objeto"),
        name: z.string().optional().describe("Nombre sugerido (opcional)"),
      }),
    },
    async (args) => {
      try {
        const doc = toDoc(args.content, args.name);
        return text({ ok: true, doc: docSummary(doc) });
      } catch (err) {
        return text({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  server.registerTool(
    "test_export_playwright",
    {
      description:
        "Genera el código Playwright (spec TypeScript) de un test guardado, con sub-flujos embebidos. Devuelve el contenido; con write: true lo guarda en exports/<nombre>.spec.ts como la app.",
      inputSchema: z.object({
        name: nameArg,
        write: z.boolean().optional().describe("Escribir el archivo en exports/ (default false)"),
      }),
    },
    async (args) => {
      const name = Store.sanitizeName(args.name);
      const content = store.testGet(name);
      if (content === null) throw new Error(`el test "${name}" no existe`);
      const doc = JSON.parse(content) as TestFile;
      const loadFlow = async (flowName: string): Promise<string> => {
        const raw = store.testGet(flowName);
        if (raw === null) throw new Error(`el sub-flujo "${flowName}" no existe en la biblioteca`);
        return raw;
      };
      const spec = await buildPlaywrightSpec(doc, loadFlow);
      let path: string | null = null;
      if (args.write) {
        const dir = exportsDir(ctx.root);
        mkdirSync(dir, { recursive: true });
        path = join(dir, `${name}.spec.ts`);
        writeFileSync(path, spec, "utf8");
      }
      return text({ ok: true, name, length: spec.length, path, spec });
    },
  );
}