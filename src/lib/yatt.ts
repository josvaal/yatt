import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Dataset, YattVariable } from "@/lib/vars";

export type StepAction =
  | "click"
  | "dblclick"
  | "hover"
  | "type"
  | "clear"
  | "upload"
  | "select_option"
  | "check"
  | "press_key"
  | "wait_visible"
  | "scroll_to_element"
  | "assert_visible"
  | "assert_hidden"
  | "assert_text"
  | "assert_value"
  | "assert_attribute"
  | "goto"
  | "wait"
  | "screenshot";

export interface Step {
  id: string;
  action: StepAction;
  selector?: string;
  value?: string;
  /** Nombre de atributo para assert_attribute. */
  attribute?: string;
  /** Paso pausado: se salta en la ejecución en serie. */
  disabled?: boolean;
  label?: string;
}

export interface StepResult {
  ok: boolean;
  error?: string;
  ms?: number;
  screenshot?: string;
}

export interface TestFile {
  schemaVersion: number;
  name: string;
  url: string;
  headless: boolean;
  steps: Step[];
  variables?: YattVariable[];
  envs?: string[];
  dataset?: Dataset;
}

export const ACTION_LABELS: Record<StepAction, string> = {
  click: "Click",
  dblclick: "Doble click",
  hover: "Hover",
  type: "Escribir",
  clear: "Limpiar",
  upload: "Subir archivo",
  select_option: "Seleccionar opción",
  check: "Checkbox",
  press_key: "Tecla",
  wait_visible: "Esperar visible",
  scroll_to_element: "Scroll",
  assert_visible: "Verificar visible",
  assert_hidden: "Verificar oculto",
  assert_text: "Verificar texto",
  assert_value: "Verificar valor",
  assert_attribute: "Verificar atributo",
  goto: "Ir a URL",
  wait: "Esperar",
  screenshot: "Screenshot",
};

let seq = 1;

/** Petición JSON-RPC al sidecar a través del puente de Rust. */
export function request(method: string, params: Record<string, unknown> = {}) {
  const id = seq++;
  return invoke<unknown>("sidecar_request", { payload: JSON.stringify({ id, method, params }) });
}

export const pingSidecar = () => request("ping", {});
export const openBrowser = (url: string, headless: boolean, variables: string[] = []) =>
  request("open", { url, headless, variables });
export const closeBrowser = () => request("close", {});
export const runStep = (step: Step, timeoutMs?: number) =>
  request("run_step", { step, ...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}) });

/** Actualiza en vivo las variables disponibles en la barra flotante de la página. */
export const toolbarVars = (variables: string[]) => request("toolbar_vars", { variables });

/** Estado de la preview en vivo del navegador (screenshot del viewport + scroll). */
export interface PreviewState {
  url: string;
  title: string;
  scrollY: number;
  maxScrollY: number;
  width: number;
  height: number;
  screenshot: string;
}

export const previewReq = () => request("preview", {}) as Promise<PreviewState>;
export const previewScrollBy = (dx: number, dy: number) =>
  request("scroll_by", { dx, dy }) as Promise<PreviewState>;
export const previewScrollTo = (x: number, y: number) =>
  request("scroll_to", { x, y }) as Promise<PreviewState>;
export const previewClickAt = (x: number, y: number) =>
  request("click_at", { x, y }) as Promise<PreviewState>;

/** Activa el modo re-grabado: el siguiente clic en la página emite el evento grab_result. */
export const startGrab = () => request("start_grab", {});

export interface SidecarEvent {
  name: string;
  data?: Record<string, unknown>;
}

/** Eventos push del sidecar (action_captured, browser_status, sidecar_exited…). */
export function onSidecarEvent(cb: (ev: SidecarEvent) => void): Promise<UnlistenFn> {
  return listen("yatt://event", (e) => {
    const payload = e.payload as { type?: string; name?: string; data?: Record<string, unknown> };
    if (payload?.type === "event" && payload.name) {
      cb({ name: payload.name, data: payload.data });
    }
  });
}

export const saveTest = (name: string, content: string) => invoke<void>("test_save", { name, content });
export const listTests = () => invoke<string[]>("test_list", {});
export const loadTest = (name: string) => invoke<string>("test_load", { name });
export const deleteTest = (name: string) => invoke<void>("test_delete", { name });

// ---- Reportes de corrida (Fase 3): archivos en reports/ ----

export const reportSave = (name: string, content: string) =>
  invoke<string>("report_save", { name, content });
export const reportList = () => invoke<string[]>("report_list", {});
export const reportDelete = (name: string) => invoke<void>("report_delete", { name });
export const reportPath = (name: string) => invoke<string>("report_path", { name });

/** Abre un archivo (reporte HTML) con la app del sistema. */
export const openReport = (path: string) => openPath(path);

export function defaultTest(
  name: string,
  url: string,
  steps: Step[],
  variables: YattVariable[] = [],
  envs: string[] = [],
  dataset?: Dataset,
): TestFile {
  return {
    schemaVersion: 1,
    name,
    url,
    headless: false,
    steps: steps.map(({ id, ...rest }) => ({ id, ...rest })),
    variables,
    envs,
    dataset,
  };
}

export function describeStep(step: Step): string {
  const target = step.selector ? ` · ${step.selector}` : "";
  return `${ACTION_LABELS[step.action]}${step.value !== undefined ? ` "${step.value}"` : ""}${target}`;
}