declare module "bun:sqlite" {
  interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export class Database {
    constructor(path: string, options?: { readonly?: boolean; create?: boolean });
    run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    query(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }
}

declare module "node:sqlite" {
  interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}