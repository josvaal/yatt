import type { Store } from "./db.ts";
import type { SidecarClient } from "./sidecar.ts";

/** Estado compartido por todos los tools y recursos del MCP. */
export interface Ctx {
  root: string;
  store: Store;
  sidecar: SidecarClient;
}