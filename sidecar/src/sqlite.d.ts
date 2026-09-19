declare module "bun:sqlite" {
  interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    columns(): { name: string }[];
  }
  export class Database {
    constructor(path: string, options?: { readonly?: boolean; create?: boolean });
    run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    query(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }
}

// node:sqlite ya está tipado por @types/node (>=22.5); solo se declara bun:sqlite.