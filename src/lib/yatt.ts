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
  | "screenshot"
  // Fase 4
  | "if"
  | "repeat"
  | "for_each"
  | "run_flow"
  | "open_tab"
  | "switch_tab"
  | "close_tab"
  | "capture_screenshot"
  | "assert_screenshot";

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
  // ---- Fase 4: condicionales / bucles / sub-flujos / pestañas / asserts visuales ----

  /** Rama verdadera de `if`, cuerpo de `repeat` o `for_each`. */
  children?: Step[];
  /** Rama alternativa de `if` (si no). */
  elseChildren?: Step[];
  /** Veces que se repite el cuerpo (repeat). */
  times?: number;
  /** Lista de `for_each`: valor literal separado por comas, o `{{variable}}`. */
  list?: string;
  /** Variable que toma el valor de cada item dentro del bucle. */
  itemVar?: string;
  /** Nombre del test guardado que actúa como sub-flujo (run_flow). */
  flow?: string;
  /** Mapeo variable del flujo → fuente en el test actual (run_flow). */
  withVars?: Record<string, string>;
  /** Nombre de la imagen base en baselines/ (assert/capture_screenshot). */
  baseline?: string;
  /** % de píxeles distintos permitidos (assert_screenshot), default 0. */
  tolerance?: number;
  /** Screenshot de la página completa (assert/capture_screenshot). */
  fullPage?: boolean;
}

/** Acciones de bloque: contienen `children` y se resuelven en el runner. */
export const CONTAINER_ACTIONS: StepAction[] = ["if", "repeat", "for_each", "run_flow"];

export function isContainerStep(step: Step): boolean {
  return CONTAINER_ACTIONS.includes(step.action);
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
  screenshot: "Captura de pantalla",
  if: "Si (condición)",
  repeat: "Repetir",
  for_each: "Por cada",
  run_flow: "Sub-flujo",
  open_tab: "Abrir pestaña",
  switch_tab: "Cambiar pestaña",
  close_tab: "Cerrar pestaña",
  capture_screenshot: "Guardar imagen de referencia",
  assert_screenshot: "Verificar imagen",
};

let seq = 1;

/** Petición JSON-RPC al sidecar a través del puente de Rust. */
export function request(method: string, params: Record<string, unknown> = {}) {
  const id = seq++;
  return invoke<unknown>("sidecar_request", { payload: JSON.stringify({ id, method, params }) });
}

export const pingSidecar = () => request("ping", {});

export type BrowserKind = "chromium" | "firefox" | "webkit";
export type ViewportPreset = "desktop" | "tablet" | "mobile";

export interface OpenBrowserOptions {
  url: string;
  headless: boolean;
  variables?: string[];
  session?: string;
  /** Motor (RF-27), default "chromium". */
  browser?: BrowserKind;
  /** Preset de viewport (RF-26). */
  viewport?: { width: number; height: number };
  /** Zona horaria simulada (RF-26). */
  timezoneId?: string;
  /** Geolocalización simulada (RF-26). */
  geolocation?: { latitude: number; longitude: number } | null;
}

export const openBrowser = (options: OpenBrowserOptions) =>
  request("open", {
    url: options.url,
    headless: options.headless,
    variables: options.variables ?? [],
    ...(options.session ? { session: options.session } : {}),
    ...(options.browser && options.browser !== "chromium" ? { browser: options.browser } : {}),
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...(options.timezoneId ? { timezoneId: options.timezoneId } : {}),
    ...(options.geolocation?.latitude !== undefined ? { geolocation: options.geolocation } : {}),
  });
export const closeBrowser = () => request("close", {});
export const runStep = (step: Step, timeoutMs?: number) =>
  request("run_step", { step, ...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}) });

/** Evalúa una condición de `if` en la página actual (RFC-18). */
export const evalCondition = (selector?: string, value?: string) =>
  request("condition", { selector, value }) as Promise<{ value: boolean }>;

// ---- Multi-pestaña (RF-22) ----

export interface TabInfo {
  index: number;
  active: boolean;
  title: string;
  url: string;
}

export const tabOpen = (url: string) => request("tab_open", { url }) as Promise<{ tabs: TabInfo[] }>;
export const tabList = () => request("tab_list", {}) as Promise<TabInfo[]>;
export const tabSwitch = (index: number) => request("tab_switch", { index }) as Promise<{ tabs: TabInfo[] }>;
export const tabClose = (index?: number) =>
  request("tab_close", index === undefined ? {} : { index }) as Promise<{ tabs: TabInfo[] }>;

// ---- Sesión / estado (RF-23) ----

export const saveSession = (name: string) => request("session_save", { name });
export const listSessions = () => request("session_list", {}) as Promise<string[]>;
export const deleteSession = (name: string) => request("session_delete", { name });

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

// ---- Fase 4: baselines (RF-20) y export a Playwright (RF-24) ----

export const baselineList = () => invoke<string[]>("baseline_list", {});
export const exportPlaywright = (name: string, content: string) =>
  invoke<string>("export_save", { name, content });

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
  switch (step.action) {
    case "if":
      return `Si (${step.selector ? "existe " + step.selector : (step.value ?? "condición")})${(step.children?.length ?? 0) > 0 ? ` · ${step.children!.length} pasos` : ""}${(step.elseChildren?.length ?? 0) > 0 ? ` (+si no: ${step.elseChildren!.length})` : ""}`;
    case "repeat":
      return `Repetir ×${step.times ?? 0} · ${(step.children?.length ?? 0)} pasos`;
    case "for_each":
      return `Por cada ${step.itemVar ?? "?"} de ${step.list ?? "…"} · ${(step.children?.length ?? 0)} pasos`;
    case "run_flow":
      return `Sub-flujo "${step.flow ?? "?"}"`;
    case "open_tab":
      return `Abrir pestaña "${step.value ?? ""}"`;
    case "switch_tab":
      return `Cambiar a pestaña ${step.value ?? ""}`;
    case "close_tab":
      return step.value ? `Cerrar pestaña ${step.value}` : "Cerrar pestaña actual";
    case "capture_screenshot":
      return `Capturar imagen base ${step.value ?? ""}${step.fullPage ? " (página completa)" : ""}`;
    case "assert_screenshot":
      return `Verificar imagen ${step.baseline ?? step.value ?? ""}${step.tolerance ? ` (tol ${step.tolerance}%)` : ""}${step.fullPage ? " (página completa)" : ""}`;
    default:
      return `${ACTION_LABELS[step.action]}${step.value !== undefined ? ` "${step.value}"` : ""}${target}`;
  }
}