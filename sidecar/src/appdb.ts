/**
 * Conexión de SOLO LECTURA a la base de datos de la app bajo prueba (para los
 * pasos db_assert/db_wait y el método db_query del bridge).
 *
 * Configuración: flag --app-db (el CLI lo fija con setAppDbFlag y gana) o la
 * variable de entorno YATT_APP_DB. El valor es una ruta de SQLite (o URL
 * "file:"), o una URL postgres:// (requiere la dependencia `pg` en sidecar/).
 *
 * Misma técnica dual que db.ts: `bun:sqlite` con Bun y `node:sqlite`
 * (DatabaseSync) como respaldo en Node. La conexión se abre perezosamente, en
 * la primera consulta, y se reabre si cambia la configuración.
 */

export interface AppDbResult {
  columns: string[];
  /** Filas como arrays de celdas, en el orden de `columns`. */
  rows: unknown[][];
  /** Cantidad real de filas devueltas por la consulta. */
  totalRows: number;
}

/** Tope de filas devueltas (totalRows conserva el conteo real). */
const ROW_CAP = 200;

/** Valor forzado por flag (--app-db); tiene prioridad sobre YATT_APP_DB. */
let flagValue: string | null = null;

/** Fija el valor del flag --app-db (string vacío = sin flag). */
export function setAppDbFlag(value: string | undefined | null): void {
  const v = String(value ?? "").trim();
  flagValue = v ? v : null;
}

/** Fuente de configuración vigente: flag --app-db, luego env YATT_APP_DB. */
function appDbSource(): string | null {
  if (flagValue) return flagValue;
  const env = String(process.env.YATT_APP_DB ?? "").trim();
  return env || null;
}

/** ¿Hay base de la app configurada? */
export function appDbConfigured(): boolean {
  return appDbSource() !== null;
}

// ---- Guardia de solo lectura ----

const READ_ONLY_RE = /^\s*(select|with|explain|pragma)\b/i;

/** Rechaza cualquier sentencia que no sea de lectura. */
function assertReadOnly(sql: string): void {
  if (!READ_ONLY_RE.test(sql)) {
    throw new Error("db: solo lectura (SELECT/WITH/EXPLAIN/PRAGMA)");
  }
}

/** Conexión abierta: consulta acotada + cierre. */
interface AppDbHandle {
  query(sql: string): Promise<AppDbResult>;
  close(): void;
}

let handle: { key: string; db: AppDbHandle } | null = null;

/** Arma el resultado: filas como arrays en el orden de columnas, tope 200. */
function shape(columns: string[], rows: Record<string, unknown>[]): AppDbResult {
  return {
    columns,
    rows: rows.slice(0, ROW_CAP).map((r) => columns.map((c) => r[c])),
    totalRows: rows.length,
  };
}

/** SQLite en lectura: bun:sqlite con Node (node:sqlite) de respaldo. */
async function openSqlite(source: string): Promise<AppDbHandle> {
  // URL "file:" → ruta plana (sin query string).
  const file = source.startsWith("file:")
    ? source.replace(/^file:\/\//, "").replace(/^file:/, "").split("?")[0]
    : source;
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database(file, { readonly: true });
    return {
      query: async (sql) => {
        const stmt = db.query(sql);
        const rows = stmt.all() as Record<string, unknown>[];
        // bun:sqlite expone columns(); si falta (otro runtime), se deduce de la
        // primera fila.
        const columns =
          typeof (stmt as { columns?: unknown }).columns === "function"
            ? (stmt.columns() as { name: string }[]).map((c) => c.name)
            : rows.length > 0
              ? Object.keys(rows[0])
              : [];
        return shape(columns, rows);
      },
      close: () => db.close(),
    };
  } catch {
    // bun:sqlite no disponible (runtime Node) → node:sqlite experimental.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    return {
      query: async (sql) => {
        const rows = db.prepare(sql).all() as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return shape(columns, rows);
      },
      close: () => db.close(),
    };
  }
}

/** Postgres en lectura: requiere `pg` instalado en sidecar/ (no viene por defecto). */
async function openPostgres(url: string): Promise<AppDbHandle> {
  let Client: new (cfg: { connectionString: string }) => {
    connect(): Promise<void>;
    query(sql: string): Promise<{ fields: { name: string }[]; rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  };
  try {
    // Import por variable: `pg` es una dependencia opcional (no está en
    // package.json a propósito) y solo se exige si la URL es postgres://.
    const pgModule = "pg";
    const pg = (await import(pgModule)) as { Client: typeof Client };
    Client = pg.Client;
  } catch {
    throw new Error("db: para postgres:// instalá la dependencia en sidecar/ (bun add pg)");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    query: async (sql) => {
      // Cinturón extra a la guardia de sintaxis: transacción de solo lectura.
      await client.query("BEGIN READ ONLY");
      try {
        const res = await client.query(sql);
        await client.query("COMMIT");
        return shape(res.fields.map((f) => f.name), res.rows);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    },
    close: () => {
      void client.end().catch(() => {});
    },
  };
}

/** Conexión perezosa cacheada; reabre si la fuente de configuración cambió. */
async function getHandle(key: string): Promise<AppDbHandle> {
  if (handle && handle.key === key) return handle.db;
  if (handle) {
    try {
      handle.db.close();
    } catch {
      /* ya cerrada */
    }
    handle = null;
  }
  const db = /^postgres(ql)?:\/\//i.test(key) ? await openPostgres(key) : await openSqlite(key);
  handle = { key, db };
  return db;
}

/**
 * Ejecuta una consulta de solo lectura contra la base de la app. Sin
 * configuración lanza el error canónico que muestran los pasos db_*.
 */
export async function appDbQuery(sql: string): Promise<AppDbResult> {
  const source = appDbSource();
  if (!source) {
    throw new Error("definí YATT_APP_DB (o --app-db) para usar pasos db_*");
  }
  assertReadOnly(sql);
  const db = await getHandle(source);
  return db.query(sql);
}

/** Cierra la conexión de la app (hook de apagado del sidecar). */
export function closeAppDb(): void {
  if (handle) {
    try {
      handle.db.close();
    } catch {
      /* ya cerrada */
    }
    handle = null;
  }
}
