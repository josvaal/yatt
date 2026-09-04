import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import { dbPath, reportsDir, testsDir } from "./root.ts";

/**
 * Acceso a yatt.db con el mismo esquema que src-tauri/src/db.rs y
 * sidecar/src/db.ts (tablas tests/reports/baselines/sessions, WAL).
 * La BD es fuente de verdad; los `.yatt.json`/reportes en disco son espejos
 * portables/versionables (invariante que mantiene `test_save` en la app).
 */

export class Store {
  readonly db: Database;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(readonly root: string) {
    mkdirSync(dirname(dbPath(root)), { recursive: true });
    this.db = new Database(dbPath(root));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tests     (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports   (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS baselines (name TEXT PRIMARY KEY, png BLOB NOT NULL,      updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions  (name TEXT PRIMARY KEY, storage_state TEXT NOT NULL, updated_at INTEGER NOT NULL);
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
    `);
  }

  /** Reglas de nombre iguales a `sanitize` de src-tauri/src/storage.rs. */
  static sanitizeName(name: string): string {
    const n = name.trim();
    if (!n || /[\\/]/.test(n) || n.includes("..")) {
      throw new Error(`nombre inválido: "${name}"`);
    }
    return n;
  }

  /** Serializa las escrituras (la DB tolera concurrencia WAL, pero mejor ser predecible). */
  private write<T>(fn: () => T): Promise<T> {
    const next = this.writeChain.then(fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  // ---- tests ----

  testList(): string[] {
    return (this.db.query("SELECT name FROM tests ORDER BY name").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
  }

  testGet(name: string): string | null {
    const row = this.db.query("SELECT content FROM tests WHERE name = ?1").get(name) as
      | { content: string }
      | null;
    return row ? row.content : null;
  }

  testExists(name: string): boolean {
    // bun:sqlite devuelve null (no undefined) cuando no hay fila.
    return this.db.query("SELECT 1 FROM tests WHERE name = ?1").get(name) != null;
  }

  /** Upsert BD + espejo tests/<name>.yatt.json (misma invariante que test_save). */
  upsertTest(name: string, content: string): Promise<void> {
    const safe = Store.sanitizeName(name);
    return this.write(() => {
      this.db
        .query("INSERT OR REPLACE INTO tests (name, content, updated_at) VALUES (?1, ?2, ?3)")
        .run(safe, content, Date.now());
      const dir = testsDir(this.root);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${safe}.yatt.json`), content, "utf8");
    });
  }

  deleteTest(name: string): Promise<void> {
    return this.write(() => {
      this.db.query("DELETE FROM tests WHERE name = ?1").run(name);
      rmSync(join(testsDir(this.root), `${name}.yatt.json`), { force: true });
    });
  }

  // ---- reports ----

  reportList(): string[] {
    return (this.db.query("SELECT name FROM reports ORDER BY name DESC").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
  }

  reportGet(name: string): string | null {
    const row = this.db.query("SELECT content FROM reports WHERE name = ?1").get(name) as
      | { content: string }
      | null;
    return row ? row.content : null;
  }

  /** Upsert BD + espejo reports/<name> (igual que report_save de la app). */
  upsertReport(name: string, content: string): Promise<string> {
    const safe = Store.sanitizeName(name);
    return this.write(() => {
      this.db
        .query("INSERT OR REPLACE INTO reports (name, content, updated_at) VALUES (?1, ?2, ?3)")
        .run(safe, content, Date.now());
      const dir = reportsDir(this.root);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, safe);
      writeFileSync(path, content, "utf8");
      return path;
    });
  }

  deleteReport(name: string): Promise<void> {
    return this.write(() => {
      this.db.query("DELETE FROM reports WHERE name = ?1").run(name);
      rmSync(join(reportsDir(this.root), name), { force: true });
    });
  }

  // ---- baselines ----

  baselineList(): string[] {
    return (this.db.query("SELECT name FROM baselines ORDER BY name").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
  }

  baselineGet(name: string): Uint8Array | null {
    const row = this.db.query("SELECT png FROM baselines WHERE name = ?1").get(name) as
      | { png: Uint8Array }
      | null;
    return row ? new Uint8Array(row.png) : null;
  }

  close(): void {
    this.db.close();
  }
}