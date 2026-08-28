/**
 * Acceso mínimo a SQLite para el sidecar: `bun:sqlite` cuando el runtime es
 * Bun (dev y CLI) y `node:sqlite` (DatabaseSync) como respaldo si alguien
 * ejecuta el sidecar con Node. Ambos comparten la misma base del sistema
 * (`yatt.db`, WAL) que abre Rust con rusqlite: es la fuente de verdad; las
 * carpetas legacy son espejo.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface YattDb {
  /** Ejecuta una sentencia (INSERT/UPDATE/DELETE/PRAGMA). */
  run(sql: string, params?: unknown[]): void;
  /** Primera fila, o null si no hay. */
  get(sql: string, params?: unknown[]): Record<string, unknown> | null;
  /** Todas las filas. */
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}

/** Esquema idéntico al de src-tauri/src/db.rs. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tests (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS baselines (
    name TEXT PRIMARY KEY,
    png BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    name TEXT PRIMARY KEY,
    storage_state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

/** Abre `yatt.db` con WAL y el esquema del sistema creado si falta. */
export async function openYattDb(path: string): Promise<YattDb> {
  // SQLite no crea carpetas padre (el Rust de la app sí hace create_dir_all).
  mkdirSync(dirname(path), { recursive: true });
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path);
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA busy_timeout=5000");
    db.exec(SCHEMA);
    return {
      run: (sql, p = []) => {
        db.run(sql, ...p);
      },
      get: (sql, p = []) =>
        (db.query(sql).get(...p) as Record<string, unknown> | undefined) ?? null,
      all: (sql, p = []) => db.query(sql).all(...p) as Record<string, unknown>[],
      close: () => db.close(),
    };
  } catch (e) {
    // bun:sqlite no disponible (runtime Node) → node:sqlite experimental.
    console.error("[yatt][db] rama bun:sqlite falló:", e instanceof Error ? e.message : String(e));
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(SCHEMA);
    return {
      run: (sql, p = []) => {
        db.prepare(sql).run(...p);
      },
      get: (sql, p = []) =>
        (db.prepare(sql).get(...p) as Record<string, unknown> | undefined) ?? null,
      all: (sql, p = []) => db.prepare(sql).all(...p) as Record<string, unknown>[],
      close: () => db.close(),
    };
  }
}