import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { sidecarDir } from "./root.ts";

/**
 * Cliente JSON-RPC del sidecar de YATT (el motor Playwright). Mismo contrato
 * que el host Rust: requests `{"id","method","params"}` por stdin, respuestas
 * `{"type":"response","id","ok","result"|"error"}` y eventos
 * `{"type":"event","name","data"}` mezclados en stdout, líneas \n.
 *
 * El sidecar es single-browser; las llamadas se serializan con una cola para
 * que los tools del navegador nunca se pisen entre sí.
 */
type Waiter = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class SidecarClient {
  private child: ChildProcess | null = null;
  private buf = "";
  private seq = 1;
  private waiters = new Map<number, Waiter>();
  private ready: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  onEvent: ((name: string, data: Record<string, unknown>) => void) | null = null;

  /** `root` = raíz de DATOS (YATT_ROOT): yatt.db, baselines/, sessions/. */
  constructor(readonly root: string) {}

  /** Comando para arrancar el sidecar: YATT_SIDECAR (binario) → bun → node. */
  private command(): { cmd: string; args: string[] } {
    const custom = process.env.YATT_SIDECAR;
    if (custom) return { cmd: custom, args: [] };
    const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
    if (hasBun) return { cmd: "bun", args: ["run", "src/index.ts"] };
    return { cmd: "node", args: ["src/index.ts"] };
  }

  get alive(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Arranca el sidecar (una vez) y espera el evento `sidecar_ready`. */
  private ensure(): Promise<void> {
    if (!this.ready) this.ready = this.start();
    return this.ready;
  }

  private start(): Promise<void> {
    const { cmd, args } = this.command();
    const child = spawn(cmd, args, {
      cwd: sidecarDir(),
      env: { ...process.env, YATT_ROOT: this.root },
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.child = child;

    return new Promise<void>((resolveReady, rejectReady) => {
      const failTimer = setTimeout(() => {
        this.readyHandlers.splice(0).forEach((h) => clearTimeout(h.failTimer));
        rejectReady(new Error("el motor no arrancó a tiempo"));
      }, 20000);
      this.readyHandlers.push({ resolveReady, rejectReady, failTimer });

      child.stdout!.on("data", (chunk: Buffer) => {
        this.buf += chunk.toString("utf8");
        let idx: number;
        while ((idx = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (!line) continue;
          try {
            this.handleLine(JSON.parse(line));
          } catch {
            /* línea corrupta: se ignora */
          }
        }
      });

      child.on("error", (err) => {
        this.readyHandlers.splice(0).forEach((h) => clearTimeout(h.failTimer));
        this.child = null;
        this.ready = null;
        rejectReady(new Error(`no se pudo lanzar el motor (${cmd}): ${err.message}`));
        this.failAll(new Error(`no se pudo lanzar el motor: ${err.message}`));
      });
      child.on("exit", (code) => {
        if (this.child !== child) return; // cierre ordenado ya procesado
        this.child = null;
        this.ready = null;
        const msg = `el motor terminó inesperadamente (código ${code})`;
        this.readyHandlers.splice(0).forEach((h) => {
          clearTimeout(h.failTimer);
          h.rejectReady(new Error(msg));
        });
        this.failAll(new Error(msg));
      });
    });
  }

  private readyHandlers: Array<{
    resolveReady: () => void;
    rejectReady: (e: Error) => void;
    failTimer: ReturnType<typeof setTimeout>;
  }> = [];

  private handleLine(msg: { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string; name?: string; data?: Record<string, unknown> }): void {
    if (msg.type === "event") {
      if (msg.name === "sidecar_ready") {
        const handlers = this.readyHandlers.splice(0);
        for (const h of handlers) {
          clearTimeout(h.failTimer);
          h.resolveReady();
        }
      }
      this.onEvent?.(msg.name ?? "?", msg.data ?? {});
      return;
    }
    if (msg.type === "response") {
      const w = this.waiters.get(msg.id ?? -1);
      if (!w) return;
      this.waiters.delete(msg.id ?? -1);
      clearTimeout(w.timer);
      if (msg.ok) w.resolve(msg.result);
      else {
        // Adjunta el resultado completo (p. ej. screenshot de evidencia de un
        // paso fallido) para que el tool pueda mostrarlo.
        const e = new Error(msg.error ?? "error del motor");
        (e as Error & { data?: unknown }).data = msg.result;
        w.reject(e);
      }
    }
  }

  private failAll(err: Error): void {
    for (const w of this.waiters.values()) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.waiters.clear();
  }

  /** Ejecuta un método del sidecar, serializado con el resto de llamadas. */
  req<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120000): Promise<T> {
    const run = () => this.reqInner<T>(method, params, timeoutMs);
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async reqInner<T>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    await this.ensure();
    if (!this.child || !this.child.stdin?.writable) throw new Error("el motor no está disponible");
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`timeout del motor en "${method}" (${timeoutMs} ms)`));
      }, timeoutMs);
      this.waiters.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.child!.stdin!.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  /** Cierre ordenado: EOF en stdin → el sidecar cierra Chromium y sale. */
  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (!child || child.exitCode !== null) return;
    child.stdin!.end();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    this.failAll(new Error("motor cerrado"));
  }
}