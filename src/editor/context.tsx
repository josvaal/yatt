import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  baselineList,
  closeBrowser,
  defaultTest,
  deleteSession,
  deleteTest,
  evalCondition,
  exportPlaywright,
  listSessions,
  listTests,
  loadTest,
  onSidecarEvent,
  openBrowser,
  openReport,
  pingSidecar,
  previewClickAt,
  previewReq,
  previewScrollTo,
  reportDelete,
  reportList,
  reportPath,
  reportSave,
  runStep,
  saveSession,
  saveTest,
  startGrab,
  tabClose,
  tabList,
  tabOpen,
  tabSwitch,
  toolbarVars,
  describeStep,
  isContainerStep,
  type BrowserKind,
  type PreviewState,
  type SidecarEvent,
  type Step,
  type StepResult,
  type TabInfo,
  type TestFile,
  type ViewportPreset,
} from "@/lib/yatt";
import { parseImportedTest } from "@/lib/import";
import {
  ENV_DEFAULT,
  interpolate,
  newVariable,
  parseCsv,
  resolveStep,
  resolveVars,
  validVarName,
  type Dataset,
  type VarType,
  type YattVariable,
} from "@/lib/vars";
import {
  buildReportHtml,
  buildReportJson,
  reportSlug,
  type RunRecord,
  type RunReport,
  type SetTestResult,
} from "@/lib/report";
import { buildPlaywrightSpec } from "@/lib/export";

export type StepStatus = "pending" | "running" | "ok" | "fail";
export type Ids = string;

export interface LastResult {
  stepId?: Ids;
  ok: boolean;
  error?: string;
  ms?: number;
  screenshot?: string;
}

export type PageId = "editor" | "variables" | "data" | "run" | "reports";

/** Acumulador de una corrida: filas del reporte + contadores + bandera de stop. */
interface RunState {
  records: RunRecord[];
  ok: number;
  fail: number;
  skipped: number;
  counter: number;
  stopped: boolean;
}

/** Busca un paso por id en un árbol de pasos (children/elseChildren). */
function findStepRec(list: Step[], id: string): Step | null {
  for (const s of list) {
    if (s.id === id) return s;
    const c = findStepRec(s.children ?? [], id) ?? findStepRec(s.elseChildren ?? [], id);
    if (c) return c;
  }
  return null;
}

/** Presets de viewport (RF-26). */
export const VIEWPORTS: Record<ViewportPreset, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

/** Variables sensibles (RNF-05): sus valores se enmascaran en reportes. */
const SENSITIVE_RE = /(pass|pwd|secret|token|api[_-]?key|clave)/i;

function maskSensitive(
  text: string | undefined,
  vars: Record<string, string>,
  names: string[],
): string | undefined {
  if (!text || names.length === 0) return text;
  let out = text;
  for (const n of names) {
    const v = vars[n];
    if (v && v.length > 1) out = out.split(v).join(`{{${n}}}`);
  }
  return out;
}

/** Aplica `fn` a un paso por id en todo el árbol (pasos y bloques anidados). */
function mapStepRec(list: Step[], id: string, fn: (s: Step) => Step): Step[] {
  return list.map((s) => {
    if (s.id === id) return fn(s);
    const withChildren = s.children ? { ...s, children: mapStepRec(s.children, id, fn) } : s;
    const withElse = withChildren.elseChildren
      ? { ...withChildren, elseChildren: mapStepRec(withChildren.elseChildren, id, fn) }
      : withChildren;
    return withElse;
  });
}

/** Elimina un paso (y sus descendientes) del árbol. */
function removeStepRec(list: Step[], id: string): Step[] {
  return list
    .filter((s) => s.id !== id)
    .map((s) => {
      let out = s;
      if (s.children) {
        const c = removeStepRec(s.children, id);
        if (c !== s.children) out = { ...out, children: c };
      }
      if (s.elseChildren) {
        const c = removeStepRec(s.elseChildren, id);
        if (c !== s.elseChildren) out = { ...out, elseChildren: c };
      }
      return out;
    });
}

/** Inserta una copia (pausada) justo después del paso, en su mismo nivel. */
function duplicateRec(list: Step[], id: string): Step[] {
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) {
    const copy: Step = { ...list[i], id: crypto.randomUUID(), disabled: true };
    const next = [...list];
    next.splice(i + 1, 0, copy);
    return next;
  }
  return list.map((s) => {
    let out = s;
    if (s.children) {
      const c = duplicateRec(s.children, id);
      if (c !== s.children) out = { ...out, children: c };
    }
    if (s.elseChildren) {
      const c = duplicateRec(s.elseChildren, id);
      if (c !== s.elseChildren) out = { ...out, elseChildren: c };
    }
    return out;
  });
}

/** Reordena un paso dentro de su nivel (entre hermanos). */
function moveRec(list: Step[], id: string, dir: -1 | 1): Step[] {
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  return list.map((s) => {
    let out = s;
    if (s.children) {
      const c = moveRec(s.children, id, dir);
      if (c !== s.children) out = { ...out, children: c };
    }
    if (s.elseChildren) {
      const c = moveRec(s.elseChildren, id, dir);
      if (c !== s.elseChildren) out = { ...out, elseChildren: c };
    }
    return out;
  });
}

/** Todos los ids de un paso y sus descendientes (para limpiar estados). */
function collectIds(step: Step): string[] {
  return [
    step.id,
    ...(step.children ?? []).flatMap(collectIds),
    ...(step.elseChildren ?? []).flatMap(collectIds),
  ];
}

interface EditorContextValue {
  // navegación
  page: PageId;
  setPage: (p: PageId) => void;

  // estado global
  connected: boolean;
  browserOpen: boolean;
  headless: boolean;
  setHeadless: (h: boolean) => void;
  appError: string | null;
  setAppError: (e: string | null) => void;
  url: string;
  setUrl: (u: string) => void;

  // entorno del navegador (RF-26/27)
  browserKind: BrowserKind;
  setBrowserKind: (b: BrowserKind) => void;
  viewportKind: ViewportPreset;
  setViewportKind: (v: ViewportPreset) => void;
  timezoneId: string;
  setTimezoneId: (t: string) => void;
  geoEnabled: boolean;
  setGeoEnabled: (v: boolean) => void;
  geoLat: string;
  setGeoLat: (v: string) => void;
  geoLon: string;
  setGeoLon: (v: string) => void;

  // pasos
  steps: Step[];
  setSteps: React.Dispatch<React.SetStateAction<Step[]>>;
  status: Record<Ids, StepStatus>;
  setStatus: React.Dispatch<React.SetStateAction<Record<Ids, StepStatus>>>;
  replaceTarget: Ids | null;
  /** Posición 1-based del paso en reemplazo (0 si no hay). */
  replaceTargetIndex: number;
  okCount: number;
  failCount: number;
  pendingCount: number;
  editingId: Ids | null;
  setEditingId: (id: Ids | null) => void;
  draftSelector: string;
  setDraftSelector: (v: string) => void;
  draftValue: string;
  setDraftValue: (v: string) => void;

  preview: PreviewState | null;
  setPreview: React.Dispatch<React.SetStateAction<PreviewState | null>>;

  // persistencia
  testName: string;
  setTestName: (n: string) => void;
  savedTests: string[];
  refreshSaved: () => Promise<void>;

  // variables / entornos / dataset
  variables: YattVariable[];
  envs: string[];
  activeEnv: string;
  setActiveEnv: (e: string) => void;
  overrides: Record<string, string>;
  setOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  newVarName: string;
  setNewVarName: (v: string) => void;
  newEnvName: string;
  setNewEnvName: (v: string) => void;
  csvText: string;
  setCsvText: (v: string) => void;
  dataset: Dataset | null;
  datasetReport: Array<{ ok: boolean; row: number; passed: number; total: number; stopped: boolean }> | null;

  // ejecución
  runningAll: boolean;
  runningDataset: boolean;
  runningSet: boolean;
  stopping: boolean;
  closing: boolean;
  restarting: boolean;
  paused: boolean;
  /** Modo paso a paso: pausa antes de cada paso (RF-17). */
  stepByStep: boolean;
  setStepByStep: (v: boolean) => void;
  /** Timeout global por paso en ms (RF-15), default 40000. */
  stepTimeoutMs: number;
  setStepTimeoutMs: (v: number) => void;
  lastResult: LastResult | null;
  setProgress: { current: string; index: number; total: number } | null;

  // reportes (RF-16)
  lastReport: RunReport | null;
  lastReportPath: string | null;
  savedReports: string[];
  refreshReports: () => Promise<void>;
  handleSaveReport: () => Promise<string | null>;
  handleOpenReport: (name?: string) => Promise<void>;
  handleDeleteReport: (name: string) => Promise<void>;

  // acciones de ejecución (RF-17, RNF-08)
  runOne: (
    step: Step,
    statusId?: Ids,
  ) => Promise<{ ok: boolean; ms?: number; error?: string; screenshot?: string } | null>;
  runAll: () => Promise<void>;
  runSet: (names: string[]) => Promise<void>;
  handlePause: () => void;
  handleResume: () => void;
  handleStop: () => void;

  // navegador
  onPreviewClick: (e: React.MouseEvent<HTMLImageElement>) => void;
  handlePreviewScrollTo: (y: number) => void;
  previewScrollTo: (x: number, y: number) => Promise<PreviewState | null>;
  refreshPreview: () => Promise<void>;
  handleOpen: (mode: "visible" | "headless") => Promise<void>;
  handleClose: () => Promise<void>;
  handleRestart: () => Promise<void>;

  // multi-pestaña (RF-22)
  tabs: TabInfo[];
  refreshTabs: () => Promise<void>;
  handleTabOpen: (url: string) => Promise<void>;
  handleTabSwitch: (index: number) => Promise<void>;
  handleTabClose: (index?: number) => Promise<void>;

  // sesión / estado (RF-23)
  savedSessions: string[];
  refreshSessions: () => Promise<void>;
  handleSaveSession: (name: string) => Promise<void>;
  handleLoadSession: (name: string) => Promise<void>;
  handleDeleteSession: (name: string) => Promise<void>;

  // asserts visuales (RF-20): imágenes base existentes
  baselines: string[];
  refreshBaselines: () => Promise<void>;

  // export a Playwright (RF-24)
  exporting: boolean;
  handleExport: () => Promise<void>;

  // pasos CRUD
  addStep: (step: Omit<Step, "id">) => void;
  removeStep: (id: Ids) => void;
  startReplace: (id: Ids) => void;
  startEdit: (step: Step) => void;
  saveEdit: (id: Ids) => void;
  /** Aplica campos sueltos a un paso (config de contenedores, tolerancia…). */
  patchStep: (id: Ids, partial: Partial<Step>) => void;
  duplicateStep: (id: Ids) => void;
  moveStep: (id: Ids, dir: -1 | 1) => void;
  togglePause: (id: Ids) => void;
  handleRegrab: (id: Ids) => Promise<void>;

  // persistencia
  handleSave: () => Promise<void>;
  handleLoad: (name: string) => Promise<void>;
  handleDelete: (name: string) => Promise<void>;
  handleImportFile: (content: string, baseName: string) => Promise<void>;
  newTest: () => void;

  // variables
  addVariable: () => void;
  removeVariable: (name: string) => void;
  renameVariable: (oldName: string, name: string) => void;
  setVarType: (name: string, type: VarType) => void;
  setVarOptions: (name: string, text: string) => void;
  setVarValue: (name: string, env: string, value: string) => void;
  addEnv: () => void;

  // dataset
  importCsv: () => boolean;
  handleRunDataset: () => Promise<void>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("useEditor debe usarse dentro de <EditorProvider>");
  return value;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageId>("editor");
  const [url, setUrl] = useState("https://example.com");
  const [headless, setHeadless] = useState(false);
  const [browserKind, setBrowserKind] = useState<BrowserKind>("chromium");
  const [viewportKind, setViewportKind] = useState<ViewportPreset>("desktop");
  const [timezoneId, setTimezoneId] = useState("");
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoLat, setGeoLat] = useState("-34.6037");
  const [geoLon, setGeoLon] = useState("-58.3816");
  const [connected, setConnected] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [status, setStatus] = useState<Record<Ids, StepStatus>>({});
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [testName, setTestName] = useState("mi-test");
  const [savedTests, setSavedTests] = useState<string[]>([]);
  const [variables, setVariables] = useState<YattVariable[]>([]);
  const [envs, setEnvs] = useState<string[]>(["dev", "prod"]);
  const [activeEnv, setActiveEnv] = useState<string>(ENV_DEFAULT);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [newVarName, setNewVarName] = useState("");
  const [newEnvName, setNewEnvName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetReport, setDatasetReport] = useState<
    Array<{ ok: boolean; row: number; passed: number; total: number; stopped: boolean }> | null
  >(null);
  const [runningDataset, setRunningDataset] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [runningSet, setRunningSet] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [closing, setClosing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stepByStep, setStepByStep] = useState(false);
  const [stepTimeoutMs, setStepTimeoutMs] = useState(40000);
  const [lastReport, setLastReport] = useState<RunReport | null>(null);
  const [lastReportPath, setLastReportPath] = useState<string | null>(null);
  const [savedReports, setSavedReports] = useState<string[]>([]);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [savedSessions, setSavedSessions] = useState<string[]>([]);
  const [baselines, setBaselines] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [setProgress, setSetProgress] = useState<{
    current: string;
    index: number;
    total: number;
  } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [editingId, setEditingId] = useState<Ids | null>(null);
  const [draftSelector, setDraftSelector] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const grabPendingRef = useRef<{ resolve: (sel: string) => void } | null>(null);
  const replaceTargetRef = useRef<Ids | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<Ids | null>(null);
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const browserOpenRef = useRef(false);
  const stepTimeoutRef = useRef(40000);
  const stepByStepRef = useRef(false);
  const pauseRef = useRef(false);
  const pauseGateRef = useRef<{ resolve: () => void } | null>(null);
  const logsRef = useRef<string[]>([]);

  useEffect(() => {
    browserOpenRef.current = browserOpen;
  }, [browserOpen]);

  useEffect(() => {
    stepTimeoutRef.current = stepTimeoutMs;
  }, [stepTimeoutMs]);

  useEffect(() => {
    stepByStepRef.current = stepByStep;
  }, [stepByStep]);

  const okCount = useMemo(() => Object.values(status).filter((s) => s === "ok").length, [status]);
  const failCount = useMemo(() => Object.values(status).filter((s) => s === "fail").length, [status]);
  const pendingCount = useMemo(
    () => Object.values(status).filter((s) => s === "pending").length,
    [status],
  );
  const replaceTargetIndex = useMemo(
    () => (replaceTarget ? steps.findIndex((s) => s.id === replaceTarget) + 1 : 0),
    [replaceTarget, steps],
  );

  const refreshSaved = useCallback(async () => {
    try {
      setSavedTests(await listTests());
    } catch {
      /* la carpeta tests aún no existe */
    }
  }, []);

  const refreshReports = useCallback(async () => {
    try {
      setSavedReports(await reportList());
    } catch {
      /* la carpeta reports aún no existe */
    }
  }, []);

  const refreshTabs = useCallback(async () => {
    if (!browserOpenRef.current) {
      setTabs([]);
      return;
    }
    try {
      setTabs(await tabList());
    } catch {
      /* navegador a mitad de cierre */
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      setSavedSessions(await listSessions());
    } catch {
      /* sesiones aún no existen */
    }
  }, []);

  const refreshBaselines = useCallback(async () => {
    try {
      setBaselines(await baselineList());
    } catch {
      /* baselines aún no existen */
    }
  }, []);

  /** Refresca la preview en vivo del navegador (solo si está abierto). */
  const refreshPreview = useCallback(async () => {
    if (!browserOpenRef.current) return;
    try {
      const p = await previewReq();
      if (p?.screenshot) setPreview(p);
    } catch {
      /* el navegador se cerró a mitad de camino */
    }
  }, []);

  useEffect(() => {
    // StrictMode monta y desmonta el efecto dos veces en dev; `listen()` resuelve
    // de forma asíncrona, así que hay que cancelar la suscripción del primer
    // montaje cuando su promesa se resuelva después del cleanup. Sin esto quedan
    // dos listeners y cada evento generaría pasos duplicados.
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    onSidecarEvent((ev: SidecarEvent) => {
      switch (ev.name) {
        case "action_captured": {
          const data = ev.data as { step?: Step; result?: StepResult };
          if (!data?.step) break;
          const captured: Step = { ...data.step, id: data.step.id || crypto.randomUUID() };
          const r = data.result;
          const target = replaceTargetRef.current;
          if (target) {
            // Modo reemplazar: la acción capturada sustituye la definición del paso.
            setSteps((prev) =>
              prev.map((s) =>
                s.id === target
                  ? {
                      ...s,
                      action: captured.action,
                      selector: captured.selector,
                      value: captured.value,
                      attribute: captured.attribute,
                      label: captured.label,
                      disabled: false,
                    }
                  : s,
              ),
            );
            setStatus((prev) => ({
              ...prev,
              [target]: r?.ok ? "ok" : r?.ok === false ? "fail" : "pending",
            }));
            setLastResult({ stepId: target, ok: Boolean(r?.ok), error: r?.error, ms: r?.ms });
            replaceTargetRef.current = null;
            setReplaceTarget(null);
            refreshPreview();
            break;
          }
          setSteps((prev) => [...prev, captured]);
          setStatus((prev) => ({
            ...prev,
            [captured.id]: r?.ok ? "ok" : r?.ok === false ? "fail" : "pending",
          }));
          if (r && !r.ok) {
            setLastResult({ stepId: captured.id, ok: false, error: r.error, ms: r.ms });
          }
          refreshPreview();
          break;
        }
        case "browser_status": {
          const data = ev.data as { open?: boolean };
          setBrowserOpen(Boolean(data?.open));
          if (data?.open) {
            setTimeout(refreshPreview, 150);
            refreshTabs();
            refreshSessions();
          } else {
            setPreview(null);
            setTabs([]);
          }
          break;
        }
        case "tabs_changed": {
          const d = ev.data as { tabs?: TabInfo[] };
          if (Array.isArray(d?.tabs)) setTabs(d.tabs);
          break;
        }
        case "sidecar_ready":
          setConnected(true);
          break;
        case "log": {
          // Logs del sidecar para el reporte (RF-16).
          const msg = String((ev.data as { message?: unknown })?.message ?? "");
          if (msg) {
            logsRef.current.push(msg);
            if (logsRef.current.length > 300) {
              logsRef.current = logsRef.current.slice(-300);
            }
          }
          break;
        }
        case "grab_result": {
          const sel = String((ev.data as { selector?: unknown })?.selector ?? "");
          if (grabPendingRef.current) {
            grabPendingRef.current.resolve(sel);
            grabPendingRef.current = null;
          }
          break;
        }
        case "sidecar_exited":
        case "sidecar_error":
          setConnected(false);
          setBrowserOpen(false);
          break;
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    pingSidecar().then(() => setConnected(true)).catch(() => setConnected(false));
    refreshSaved();
    refreshReports();
    refreshSessions();
    refreshBaselines();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshSaved, refreshPreview, refreshReports, refreshSessions, refreshBaselines]);

  /** Ejecuta un paso hoja contra el sidecar (sin guard de concurrencia:
   *  lo usan los corredores en serie). Interpola variables y avisa al UI. */
  async function runLeaf(step: Step, statusId: Ids, vars: Record<string, string>) {
    setStatus((prev) => ({ ...prev, [statusId]: "running" }));
    try {
      const r = (await runStep(resolveStep(step, vars), stepTimeoutRef.current)) as StepResult;
      setStatus((prev) => ({ ...prev, [statusId]: r.ok ? "ok" : "fail" }));
      setLastResult({
        stepId: statusId,
        ok: r.ok,
        error: r.error,
        ms: r.ms,
        screenshot: r.screenshot,
      });
      refreshPreview();
      return r;
    } catch (err) {
      setStatus((prev) => ({ ...prev, [statusId]: "fail" }));
      setLastResult({ stepId: statusId, ok: false, error: String(err) });
      return { ok: false, error: String(err) };
    }
  }

  /** Ejecuta un paso individual (botón ▶ de la fila). Los pasos de bloque se
   *  corren completos con su propio estado de corrida; las hojas van al sidecar. */
  async function runOne(step: Step, statusId?: Ids, vars: Record<string, string> = {}) {
    const id = statusId ?? step.id;
    if (busyRef.current) return null;
    busyRef.current = true;
    try {
      if (isContainerStep(step)) {
        const state: RunState = { records: [], ok: 0, fail: 0, skipped: 0, counter: 0, stopped: false };
        setStatus((prev) => ({ ...prev, [id]: "running" }));
        // Un paso de bloque suelto no pausa antes de cada hijo (solo el runner global).
        await runStepList([step], vars, state, { stepByStep: false });
        const ok = state.fail === 0 && !state.stopped;
        setStatus((prev) => ({ ...prev, [id]: ok ? "ok" : "fail" }));
        const error = state.stopped
          ? "detenido por el usuario"
          : state.fail > 0
            ? `${state.fail} paso(s) fallaron dentro del bloque`
            : undefined;
        setLastResult({ stepId: id, ok, error });
        return { ok, error };
      }
      return await runLeaf(step, id, vars);
    } finally {
      busyRef.current = false;
    }
  }

  /** Resuelve el mapeo `withVars` de un sub-flujo: `{{var}}` interpolada con el
   *  ámbito actual, nombre simple que exista en el ámbito, o literal. */
  function resolveFlowMapping(src: string, vars: Record<string, string>): string {
    if (/^\{\{[\w.-]+\}\}$/.test(src)) return interpolate(src, vars) ?? "";
    if (Object.prototype.hasOwnProperty.call(vars, src)) return vars[src];
    return src;
  }

  /** Ejecuta un paso de bloque (if/repeat/for_each/run_flow) y registra su fila
   *  en el reporte. Los hijos se cuentan en `state` de forma natural. */
  async function execContainerStep(
    step: Step,
    vars: Record<string, string>,
    state: RunState,
    opts: { depth: number; flowStack: string[]; stepByStep?: boolean },
  ) {
    const depth = opts.depth;
    const base = (summary: string, status: "ok" | "fail" = "ok", error?: string): RunRecord => ({
      index: ++state.counter,
      action: step.action,
      selector: step.selector,
      value: step.value,
      depth,
      status,
      summary,
      error,
    });
    const branch = async (list: Step[] | undefined, childVars: Record<string, string>) => {
      const beforeOk = state.ok;
      const beforeFail = state.fail;
      await runStepList(list ?? [], childVars, state, {
        depth: depth + 1,
        flowStack: opts.flowStack,
        stepByStep: opts.stepByStep ?? true,
      });
      return { ok: state.ok - beforeOk, fail: state.fail - beforeFail };
    };

    if (step.action === "if") {
      const cond = resolveStep(step, vars);
      let trueBranch: boolean;
      try {
        const res = await evalCondition(cond.selector, cond.value);
        trueBranch = Boolean(res?.value);
      } catch (err) {
        state.records.push(base(`si: no se pudo evaluar (${String(err).split("\n")[0]})`, "fail"));
        state.fail++;
        return;
      }
      const branchList = trueBranch ? step.children : step.elseChildren;
      if (branchList?.length) {
        const r = await branch(branchList, vars);
        state.records.push(
          base(`${trueBranch ? "sí" : "si no"} · ${r.ok} ok${r.fail ? ` · ${r.fail} fallo` : ""}`),
        );
        state.ok++;
      } else {
        state.records.push(base(`${trueBranch ? "condición verdadera" : "condición falsa"} · sin pasos en la rama`));
        state.ok++;
      }
      return;
    }

    if (step.action === "repeat") {
      const times = Math.max(0, Math.floor(Number(step.times) || 0));
      if (times === 0) {
        state.records.push(base("0 repeticiones"));
        state.ok++;
        return;
      }
      let iterOk = 0;
      let iterFail = 0;
      for (let i = 1; i <= times; i++) {
        if (stopRef.current) {
          state.stopped = true;
          break;
        }
        if (pauseRef.current) await waitResume();
        const r = await branch(step.children, vars);
        iterOk += r.ok;
        iterFail += r.fail;
      }
      state.records.push(base(`×${times} · ${iterOk} ok${iterFail ? ` · ${iterFail} fallo` : ""}`));
      state.ok++;
      return;
    }

    if (step.action === "for_each") {
      const listVal = (interpolate(step.list, vars) ?? "").trim();
      const items = listVal
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length === 0) {
        state.records.push(base("lista vacía · 0 iteraciones"));
        state.ok++;
        return;
      }
      if (!step.itemVar) {
        state.records.push(base("falta la variable del item", "fail"));
        state.fail++;
        return;
      }
      let iterOk = 0;
      let iterFail = 0;
      for (const item of items) {
        if (stopRef.current) {
          state.stopped = true;
          break;
        }
        if (pauseRef.current) await waitResume();
        const r = await branch(step.children, { ...vars, [step.itemVar!]: item });
        iterOk += r.ok;
        iterFail += r.fail;
      }
      state.records.push(
        base(`${items.length} ítem(s) · ${iterOk} ok${iterFail ? ` · ${iterFail} fallo` : ""}`),
      );
      state.ok++;
      return;
    }

    // run_flow (RF-21): sub-flujo = test guardado, ejecutado en la misma página.
    const flowName = (interpolate(step.flow, vars) ?? "").trim();
    if (!flowName) {
      state.records.push(base("falta el nombre del sub-flujo", "fail"));
      state.fail++;
      return;
    }
    if (opts.flowStack.includes(flowName)) {
      state.records.push(base(`flujo circular: ${flowName}`, "fail"));
      state.fail++;
      return;
    }
    if (opts.flowStack.length >= 8) {
      state.records.push(base("máximo 8 niveles de sub-flujos", "fail"));
      state.fail++;
      return;
    }
    let doc: TestFile;
    try {
      doc = JSON.parse(await loadTest(flowName)) as TestFile;
    } catch {
      state.records.push(base(`no se pudo leer el sub-flujo "${flowName}"`, "fail"));
      state.fail++;
      return;
    }
    const fvars = resolveVars(doc.variables ?? [], ENV_DEFAULT, {});
    for (const [flowVar, src] of Object.entries(step.withVars ?? {})) {
      fvars[flowVar] = resolveFlowMapping(src, vars);
    }
    const r = await branch(doc.steps ?? [], fvars);
    state.records.push(
      base(`sub-flujo "${doc.name || flowName}" · ${r.ok} ok${r.fail ? ` · ${r.fail} fallo` : ""}`),
    );
    state.ok++;
  }

  /** Corredor recursivo de una lista de pasos (Fase 4): respeta pausa, detención
   *  y paso a paso, resuelve bloques (if/repeat/for_each/run_flow) y acumula el
   *  reporte en `state`. */
  async function runStepList(
    list: Step[],
    vars: Record<string, string>,
    state: RunState,
    opts: { depth?: number; flowStack?: string[]; stepByStep?: boolean; sensitiveNames?: string[] } = {},
  ) {
    const depth = opts.depth ?? 0;
    const flowStack = opts.flowStack ?? [];
    for (const step of list) {
      if (stopRef.current) {
        state.stopped = true;
        break;
      }
      if (pauseRef.current) await waitResume();
      if (stopRef.current) {
        state.stopped = true;
        break;
      }
      if ((opts.stepByStep ?? true) && stepByStepRef.current) {
        requestPause();
        await waitResume();
      }
      if (stopRef.current) {
        state.stopped = true;
        break;
      }
      const base: RunRecord = {
        index: ++state.counter,
        action: step.action,
        selector: step.selector,
        value: step.value,
        attribute: step.attribute,
        depth,
        status: "ok",
      };
      if (step.disabled) {
        state.records.push({ ...base, status: "skipped" });
        state.skipped++;
        continue;
      }
      if (isContainerStep(step)) {
        await execContainerStep(step, vars, state, { depth, flowStack, stepByStep: opts.stepByStep });
        continue;
      }
      const r = await runLeaf(step, step.id, vars);
      if (r) {
        if (r.ok) {
          state.ok++;
          state.records.push({ ...base, status: "ok", ms: r.ms, screenshot: r.screenshot });
        } else {
          state.fail++;
          state.records.push({
            ...base,
            status: "fail",
            ms: r.ms,
            // RNF-05: los valores de variables sensibles no quedan en los reportes.
            error: maskSensitive(r.error, vars, opts.sensitiveNames ?? []),
            screenshot: r.screenshot,
          });
        }
      } else {
        state.fail++;
        state.records.push({ ...base, status: "fail", error: "no se pudo ejecutar el paso" });
      }
    }
  }

  /** Pausa/reanuda entre pasos (RF-17): la puerta se suelta desde Reanudar o Detener. */
  function waitResume() {
    if (!pauseRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      pauseGateRef.current = { resolve };
    });
  }
  function requestPause() {
    pauseRef.current = true;
    setPaused(true);
  }

  /** Ejecuta la secuencia con las variables resueltas (env + overrides + {{var}}). */
  const executeSteps = useCallback(
    async (
      vars: Record<string, string>,
      ctx?: { env?: string; url?: string; headless?: boolean; title?: string },
    ) => {
      stopRef.current = false;
      setStopping(false);
      setRunningAll(true);
      setLastResult(null);
      logsRef.current = [];
      const startedAt = new Date().toISOString();
      const state: RunState = { records: [], ok: 0, fail: 0, skipped: 0, counter: 0, stopped: false };
      await runStepList(steps, vars, state, {
        sensitiveNames: variables.filter((v) => SENSITIVE_RE.test(v.name)).map((v) => v.name),
      });
      setRunningAll(false);
      setStopping(false);
      setPaused(false);
      const finishedAt = new Date().toISOString();
      const report: RunReport = {
        kind: "test",
        title: ctx?.title ?? testName,
        testName: ctx?.title ?? testName,
        url: ctx?.url ?? url,
        env: ctx?.env ?? activeEnv,
        headless: ctx?.headless ?? headless,
        startedAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        ok: state.ok,
        fail: state.fail,
        skipped: state.skipped,
        stopped: state.stopped,
        logs: logsRef.current.slice(),
        steps: state.records,
      };
      setLastReport(report);
      return {
        okCount: state.ok,
        failCount: state.fail,
        skipped: state.skipped,
        stopped: state.stopped,
        total: state.ok + state.fail,
        report,
      };
    },
    [steps, testName, url, activeEnv, headless, variables],
  );

  const runAll = useCallback(async () => {
    await executeSteps(resolveVars(variables, activeEnv, overrides), {
      env: activeEnv,
      url,
      headless,
      title: testName,
    });
  }, [executeSteps, variables, activeEnv, overrides, url, headless, testName]);

  /** Detiene la corrida en curso; el paso en vuelo termina con su propio timeout
   *  y la puerta de pausa se suelta para que el bucle pueda salir (RNF-08). */
  const handleStop = useCallback(() => {
    stopRef.current = true;
    setStopping(true);
    setPaused(false);
    pauseGateRef.current?.resolve();
    pauseGateRef.current = null;
    setLastResult({ ok: false, error: "Ejecución detenida por el usuario" });
  }, []);

  const handlePause = useCallback(() => {
    requestPause();
  }, []);

  const handleResume = useCallback(() => {
    pauseRef.current = false;
    setPaused(false);
    pauseGateRef.current?.resolve();
    pauseGateRef.current = null;
  }, []);

  // Atajo: Esc detiene la corrida mientras corre.
  useEffect(() => {
    if (!runningAll) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runningAll, handleStop]);

  /** Clic sobre la preview: mapea las coordenadas al viewport y ejecuta un click real. */
  const onPreviewClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!preview || !browserOpenRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * preview.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * preview.height);
      const cx = Math.max(0, Math.min(x, preview.width - 1));
      const cy = Math.max(0, Math.min(y, preview.height - 1));
      try {
        const p = await previewClickAt(cx, cy);
        if (p?.screenshot) setPreview(p);
      } catch (err) {
        setAppError(String(err));
      }
    },
    [preview],
  );

  const handlePreviewScrollTo = useCallback(async (y: number) => {
    try {
      const p = await previewScrollTo(0, y);
      if (p?.screenshot) setPreview(p);
    } catch (err) {
      setAppError(String(err));
    }
  }, []);

  /** Opciones del navegador según el entorno del editor (RF-26/27). */
  function buildOpenOptions(targetUrl: string, targetHeadless: boolean, session?: string) {
    return {
      url: targetUrl || "https://example.com",
      headless: targetHeadless,
      variables: variables.map((v) => v.name),
      ...(session ? { session } : {}),
      browser: browserKind,
      viewport: VIEWPORTS[viewportKind],
      ...(timezoneId ? { timezoneId } : {}),
      ...(geoEnabled
        ? { geolocation: { latitude: Number(geoLat) || 0, longitude: Number(geoLon) || 0 } }
        : {}),
    };
  }

  const handleOpen = useCallback(
    async (mode: "visible" | "headless") => {
      setAppError(null);
      try {
        await openBrowser(buildOpenOptions(url, mode === "headless"));
        setHeadless(mode === "headless");
      } catch (err) {
        const msg = String(err);
        // Los motores de Playwright (en especial webkit en distros no-Debian)
        // fallan por librerías del sistema ausentes; el mensaje lo aclara.
        const hint = /missing dependencies/i.test(msg)
          ? " — faltan dependencias del sistema para el motor elegido, instala las librerías que indica el mensaje y reintenta"
          : "";
        setAppError(`No se pudo abrir el navegador: ${msg}${hint}`);
      }
    },
    [url, variables, browserKind, viewportKind, timezoneId, geoEnabled, geoLat, geoLon],
  );

  const handleClose = useCallback(async () => {
    setClosing(true);
    try {
      await closeBrowser();
      // En headless no hay ventana que ver cerrar: el estado se actualiza al
      // momento para dar feedback visible.
      setBrowserOpen(false);
      setPreview(null);
    } catch (err) {
      setAppError(String(err));
    } finally {
      setClosing(false);
    }
  }, []);

  /** Cierra y reabre el navegador con una sesión 100 % limpia, sin perder pasos. */
  const handleRestart = useCallback(async () => {
    if (!browserOpenRef.current) return;
    setRestarting(true);
    setAppError(null);
    try {
      await closeBrowser();
      setPreview(null);
      await openBrowser(buildOpenOptions(url, headless));
      // Los estados ok/fallo quedaron stale tras el reinicio total.
      setStatus({});
      setLastResult(null);
    } catch (err) {
      setAppError(`No se pudo reiniciar el navegador: ${String(err)}`);
    } finally {
      setRestarting(false);
    }
  }, [url, headless, variables, browserKind, viewportKind, timezoneId, geoEnabled, geoLat, geoLon]);

  // ---- Multi-pestaña (RF-22) ----

  const handleTabOpen = useCallback(
    async (url: string) => {
      setAppError(null);
      try {
        const r = await tabOpen(url);
        if (Array.isArray(r?.tabs)) setTabs(r.tabs);
        refreshPreview();
      } catch (err) {
        setAppError(String(err));
      }
    },
    [refreshPreview],
  );

  const handleTabSwitch = useCallback(
    async (index: number) => {
      setAppError(null);
      try {
        const r = await tabSwitch(index);
        if (Array.isArray(r?.tabs)) setTabs(r.tabs);
        refreshPreview();
      } catch (err) {
        setAppError(String(err));
      }
    },
    [refreshPreview],
  );

  const handleTabClose = useCallback(
    async (index?: number) => {
      setAppError(null);
      try {
        const r = await tabClose(index);
        if (Array.isArray(r?.tabs)) setTabs(r.tabs);
        refreshPreview();
      } catch (err) {
        setAppError(String(err));
      }
    },
    [refreshPreview],
  );

  // ---- Sesión / estado (RF-23) ----

  const handleSaveSession = useCallback(
    async (name: string) => {
      setAppError(null);
      try {
        await saveSession(name);
        await refreshSessions();
      } catch (err) {
        setAppError(String(err));
      }
    },
    [refreshSessions],
  );

  const handleLoadSession = useCallback(
    async (name: string) => {
      setAppError(null);
      try {
        if (browserOpenRef.current) {
          await closeBrowser();
          setBrowserOpen(false);
          setPreview(null);
          setTabs([]);
        }
        await openBrowser(buildOpenOptions(url, headless, name));
        setTimeout(refreshPreview, 150);
      } catch (err) {
        setAppError(`No se pudo cargar la sesión: ${String(err)}`);
      }
    },
    [url, headless, variables, browserKind, viewportKind, timezoneId, geoEnabled, geoLat, geoLon, refreshPreview],
  );

  const handleDeleteSession = useCallback(
    async (name: string) => {
      try {
        await deleteSession(name);
        await refreshSessions();
      } catch (err) {
        setAppError(String(err));
      }
    },
    [refreshSessions],
  );

  // ---- Export a Playwright (RF-24) ----

  const handleExport = useCallback(async () => {
    setExporting(true);
    setAppError(null);
    try {
      const doc = defaultTest(testName.trim() || "mi-test", url, steps, variables, envs, dataset ?? undefined);
      const spec = await buildPlaywrightSpec(doc, loadTest);
      const safe = (doc.name || "mi-test").replace(/[^a-zA-Z0-9._-]+/g, "-");
      const path = await exportPlaywright(`${safe}.spec.ts`, spec);
      await openReport(path);
    } catch (err) {
      setAppError(`No se pudo exportar: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [testName, url, steps, variables, envs, dataset]);

  // Mantiene al día el desplegable de variables de la barra flotante mientras el
  // navegador está abierto (debounce: los valores se editan en cada tecla).
  useEffect(() => {
    if (!browserOpenRef.current) return;
    const t = setTimeout(() => {
      toolbarVars(variables.map((v) => v.name)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [variables]);

  function addStep(step: Omit<Step, "id">) {
    setSteps((prev) => [...prev, { ...step, id: crypto.randomUUID() }]);
  }

  /** Quita un paso (y sus descendientes) de todo el árbol. */
  function removeStep(id: Ids) {
    const target = findStepRec(steps, id);
    const ids = target ? collectIds(target) : [id];
    setSteps((prev) => removeStepRec(prev, id));
    setStatus((prev) => {
      const next = { ...prev };
      ids.forEach((i) => delete next[i]);
      return next;
    });
  }

  /** Inserta una copia del paso justo después de él, en su mismo nivel. */
  function duplicateStep(id: Ids) {
    setSteps((prev) => duplicateRec(prev, id));
  }

  function moveStep(id: Ids, dir: -1 | 1) {
    setSteps((prev) => moveRec(prev, id, dir));
  }

  function togglePause(id: Ids) {
    setSteps((prev) => mapStepRec(prev, id, (s) => ({ ...s, disabled: !s.disabled })));
  }

  /** Aplica campos sueltos a un paso (config de contenedores, tolerancia…). */
  function patchStep(id: Ids, partial: Partial<Step>) {
    setSteps((prev) => mapStepRec(prev, id, (s) => ({ ...s, ...partial })));
    setStatus((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** Activa/desactiva el modo reemplazar: la siguiente acción capturada
   *  sustituye este paso en lugar de añadir uno nuevo. */
  function startReplace(id: Ids) {
    const next = replaceTargetRef.current === id ? null : id;
    replaceTargetRef.current = next;
    setReplaceTarget(next);
  }

  function startEdit(step: Step) {
    setEditingId(step.id);
    setDraftSelector(step.selector ?? "");
    setDraftValue(step.value ?? "");
  }

  function saveEdit(id: Ids) {
    patchStep(id, { selector: draftSelector.trim() || undefined, value: draftValue || undefined });
    setEditingId(null);
    setLastResult(null);
  }

  /** Re-grabado en un clic (RF-06): el siguiente clic en la página reemplaza el selector. */
  async function handleRegrab(id: Ids) {
    const step = findStepRec(steps, id);
    if (!step) return;
    setAppError(null);
    try {
      await startGrab();
      const sel = await new Promise<string>((resolve) => {
        grabPendingRef.current = { resolve };
        setTimeout(() => {
          if (grabPendingRef.current) {
            grabPendingRef.current.resolve("");
            grabPendingRef.current = null;
          }
        }, 30000);
      });
      if (!sel) {
        setAppError("Re-grabado cancelado (Esc o sin selector válido).");
        return;
      }
      setSteps((prev) =>
        mapStepRec(prev, id, (s) => ({ ...s, selector: sel, label: describeStep({ ...s, selector: sel }) })),
      );
      await runOne({ ...step, selector: sel });
    } catch (err) {
      setAppError(String(err));
    }
  }

  async function handleSave() {
    setAppError(null);
    try {
      const doc = defaultTest(
        testName.trim() || "mi-test",
        url,
        steps,
        variables,
        envs,
        dataset ?? undefined,
      );
      await saveTest(doc.name, JSON.stringify(doc, null, 2));
      await refreshSaved();
    } catch (err) {
      setAppError(String(err));
    }
  }

  async function handleLoad(name: string) {
    setAppError(null);
    try {
      const doc = JSON.parse(await loadTest(name)) as TestFile & { steps?: Array<Partial<Step>> };
      if (!Array.isArray(doc.steps)) throw new Error("el archivo no tiene steps");
      setSteps(doc.steps.map((s) => ({ ...s, id: s.id || crypto.randomUUID() }) as Step));
      setStatus({});
      setLastResult(null);
      if (doc.url) setUrl(doc.url);
      setTestName(doc.name || name);
      setVariables(doc.variables ?? []);
      setEnvs(doc.envs?.length ? doc.envs : ["dev", "prod"]);
      setDataset(doc.dataset ?? null);
      setDatasetReport(null);
      setOverrides({});
      setCsvText("");
      setActiveEnv(ENV_DEFAULT);
    } catch (err) {
      setAppError(`No se pudo cargar: ${String(err)}`);
    }
  }

  /** Importa un test desde un archivo .yatt.json: lo valida, lo guarda en la biblioteca y lo abre en el editor. */
  async function handleImportFile(content: string, baseName: string) {
    setAppError(null);
    try {
      let doc = parseImportedTest(content, baseName);
      const existing = new Set(savedTests);
      if (existing.has(doc.name)) {
        let n = 2;
        while (existing.has(`${doc.name} (${n})`)) n++;
        doc = { ...doc, name: `${doc.name} (${n})` };
      }
      await saveTest(doc.name, JSON.stringify(doc, null, 2));
      await refreshSaved();
      setSteps(doc.steps);
      setStatus({});
      setLastResult(null);
      setUrl(doc.url || "https://example.com");
      setTestName(doc.name);
      setVariables(doc.variables ?? []);
      setEnvs(doc.envs?.length ? doc.envs : ["dev", "prod"]);
      setDataset(doc.dataset ?? null);
      setDatasetReport(null);
      setOverrides({});
      setCsvText("");
      setActiveEnv(ENV_DEFAULT);
      setPage("editor");
    } catch (err) {
      setAppError(`No se pudo importar: ${String(err)}`);
    }
  }

  async function handleDelete(name: string) {
    try {
      await deleteTest(name);
      await refreshSaved();
    } catch (err) {
      setAppError(String(err));
    }
  }

  /** Descarta el test actual y vuelve a un editor vacío. */
  function newTest() {
    setSteps([]);
    setStatus({});
    setLastResult(null);
    setTestName("mi-test");
    setUrl("https://example.com");
    setVariables([]);
    setEnvs(["dev", "prod"]);
    setOverrides({});
    setDataset(null);
    setDatasetReport(null);
    setCsvText("");
    setActiveEnv(ENV_DEFAULT);
    setEditingId(null);
    setAppError(null);
    setPage("editor");
  }

  // ---- Reportes de corrida (RF-16) ----

  const handleSaveReport = useCallback(async (): Promise<string | null> => {
    if (!lastReport) return null;
    const slug = reportSlug(lastReport.title);
    try {
      const htmlPath = await reportSave(`${slug}.html`, buildReportHtml(lastReport));
      await reportSave(`${slug}.json`, buildReportJson(lastReport));
      setLastReportPath(htmlPath);
      await refreshReports();
      return htmlPath;
    } catch (err) {
      setAppError(`No se pudo guardar el reporte: ${String(err)}`);
      return null;
    }
  }, [lastReport, refreshReports]);

  const handleOpenReport = useCallback(
    async (name?: string) => {
      const target = name ?? lastReportPath;
      if (!target) return;
      try {
        const path = name ? await reportPath(name) : target;
        await openReport(path);
      } catch (err) {
        setAppError(String(err));
      }
    },
    [lastReportPath],
  );

  const handleDeleteReport = useCallback(
    async (name: string) => {
      try {
        await reportDelete(name);
        await refreshReports();
      } catch (err) {
        setAppError(String(err));
      }
    },
    [refreshReports],
  );

  /** Correr un set de tests guardados en headless, en una sola pasada (RF-15). */
  const runSet = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return;
      setRunningSet(true);
      setRunningAll(true); // la topbar muestra Detener durante el set
      setLastResult(null);
      setAppError(null);
      stopRef.current = false;
      setStopping(false);
      logsRef.current = [];
      const startedAt = new Date().toISOString();
      const tests: SetTestResult[] = [];
      let stopped = false;
      let failTotal = 0;
      try {
        // El set corre en un headless propio: si hay un navegador abierto se cierra limpio.
        if (browserOpenRef.current) {
          await closeBrowser();
          setBrowserOpen(false);
          setPreview(null);
        }
        for (let i = 0; i < names.length; i++) {
          if (stopRef.current) {
            stopped = true;
            break;
          }
          if (pauseRef.current) await waitResume();
          if (stepByStepRef.current) {
            requestPause();
            await waitResume();
          }
          if (stopRef.current) {
            stopped = true;
            break;
          }
          const name = names[i];
          setSetProgress({ current: name, index: i + 1, total: names.length });
          const raw = await loadTest(name).catch(() => null);
          if (!raw) {
            tests.push({
              name,
              ok: false,
              ms: 0,
              fail: 1,
              stopped: false,
              error: "no se pudo leer el archivo del test",
              steps: [],
            });
            failTotal++;
            continue;
          }
          let doc: TestFile;
          try {
            doc = JSON.parse(raw) as TestFile;
          } catch {
            tests.push({ name, ok: false, ms: 0, fail: 1, stopped: false, error: "JSON inválido", steps: [] });
            failTotal++;
            continue;
          }
          const t0 = Date.now();
          try {
            await openBrowser({
              url: doc.url || "about:blank",
              headless: true,
              variables: (doc.variables ?? []).map((v) => v.name),
              browser: browserKind,
            });
          } catch (err) {
            tests.push({
              name: doc.name || name,
              ok: false,
              ms: 0,
              fail: 1,
              stopped: false,
              error: String(err),
              steps: [],
            });
            failTotal++;
            continue;
          }
          const vars = resolveVars(doc.variables ?? [], ENV_DEFAULT, {});
          const state: RunState = { records: [], ok: 0, fail: 0, skipped: 0, counter: 0, stopped: false };
          // El set es una corrida headless en serie: sin "paso a paso" interno
          // (la pausa manual entre tests se mantiene arriba).
          await runStepList(doc.steps ?? [], vars, state, {
            stepByStep: false,
            sensitiveNames: (doc.variables ?? []).filter((v) => SENSITIVE_RE.test(v.name)).map((v) => v.name),
          });
          if (state.stopped) stopped = true;
          await closeBrowser();
          setBrowserOpen(false);
          const testOk = state.fail === 0 && !state.stopped;
          tests.push({
            name: doc.name || name,
            ok: testOk,
            ms: Date.now() - t0,
            fail: state.fail,
            stopped,
            steps: state.records,
          });
          if (!testOk) failTotal++;
        }
      } finally {
        setRunningSet(false);
        setRunningAll(false);
        setStopping(false);
        setPaused(false);
        setSetProgress(null);
      }
      const finishedAt = new Date().toISOString();
      const report: RunReport = {
        kind: "set",
        title: `set-${names.length}-tests`,
        headless: true,
        startedAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        ok: tests.filter((t) => t.ok).length,
        fail: failTotal,
        skipped: 0,
        stopped,
        logs: logsRef.current.slice(),
        steps: [],
        tests,
      };
      setLastReport(report);
      // La corrida de un set guarda su reporte automáticamente.
      try {
        const slug = reportSlug(report.title);
        const htmlPath = await reportSave(`${slug}.html`, buildReportHtml(report));
        await reportSave(`${slug}.json`, buildReportJson(report));
        setLastReportPath(htmlPath);
        await refreshReports();
      } catch (err) {
        setAppError(`El set terminó pero el reporte no se guardó: ${String(err)}`);
      }
    },
    [refreshReports, runOne, browserKind],
  );

  // ---- Variables, entornos y dataset (data-driven) ----

  function addVariable() {
    const name = newVarName.trim();
    if (!name) return;
    if (!validVarName(name)) {
      setAppError("Nombre de variable no válido (letras, números, guion bajo y puntos).");
      return;
    }
    if (variables.some((v) => v.name === name)) {
      setAppError(`Ya existe la variable "${name}"`);
      return;
    }
    setVariables((prev) => [...prev, newVariable(name, "text")]);
    setNewVarName("");
  }

  function removeVariable(name: string) {
    setVariables((prev) => prev.filter((v) => v.name !== name));
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function renameVariable(oldName: string, name: string) {
    const n = name.trim();
    if (!n || !validVarName(n)) return;
    if (n !== oldName && variables.some((v) => v.name === n)) return;
    setVariables((prev) => prev.map((v) => (v.name === oldName ? { ...v, name: n } : v)));
    setOverrides((prev) => {
      const next = { ...prev };
      if (next[oldName] !== undefined) {
        next[n] = next[oldName];
        delete next[oldName];
      }
      return next;
    });
  }

  function setVarType(name: string, type: VarType) {
    setVariables((prev) =>
      prev.map((v) =>
        v.name === name ? { ...v, type, options: type === "option" ? v.options ?? [] : undefined } : v,
      ),
    );
  }

  function setVarOptions(name: string, text: string) {
    const options = text.split(",").map((s) => s.trim()).filter(Boolean);
    setVariables((prev) => prev.map((v) => (v.name === name ? { ...v, options } : v)));
  }

  function setVarValue(name: string, env: string, value: string) {
    setVariables((prev) =>
      prev.map((v) => (v.name === name ? { ...v, values: { ...v.values, [env]: value } } : v)),
    );
  }

  function addEnv() {
    const e = newEnvName.trim();
    if (!e || envs.includes(e)) return;
    setEnvs((prev) => [...prev, e]);
    setNewEnvName("");
  }

  /** Devuelve false si el texto no tiene cabecera ni filas; la página muestra el error. */
  function importCsv(): boolean {
    const d = parseCsv(csvText);
    if (d.columns.length === 0 || d.rows.length === 0) {
      setDataset(null);
      return false;
    }
    setDataset(d);
    setDatasetReport(null);
    setAppError(null);
    return true;
  }

  async function handleRunDataset() {
    if (!dataset || dataset.rows.length === 0) return;
    setRunningDataset(true);
    const report: Array<{ ok: boolean; row: number; passed: number; total: number; stopped: boolean }> = [];
    for (let i = 0; i < dataset.rows.length; i++) {
      const row = dataset.rows[i];
      const over = { ...overrides };
      for (const c of dataset.columns) {
        // Celdas vacías → cae al valor del entorno/default.
        if (row[c] !== undefined && row[c] !== "") over[c] = row[c];
      }
      const res = await executeSteps(resolveVars(variables, activeEnv, over), {
        env: activeEnv,
        url,
        headless,
        title: `${testName} · fila ${i + 1}`,
      });
      report.push({
        ok: res.failCount === 0 && !res.stopped,
        row: i + 1,
        passed: res.okCount,
        total: res.total,
        stopped: !!res.stopped,
      });
      if (stopRef.current) break;
    }
    setDatasetReport(report);
    setRunningDataset(false);
  }

  const value: EditorContextValue = {
    page,
    setPage,
    connected,
    browserOpen,
    headless,
    setHeadless,
    browserKind,
    setBrowserKind,
    viewportKind,
    setViewportKind,
    timezoneId,
    setTimezoneId,
    geoEnabled,
    setGeoEnabled,
    geoLat,
    setGeoLat,
    geoLon,
    setGeoLon,
    appError,
    setAppError,
    url,
    setUrl,
    steps,
    setSteps,
    status,
    setStatus,
    replaceTarget,
    replaceTargetIndex,
    okCount,
    failCount,
    pendingCount,
    editingId,
    setEditingId,
    draftSelector,
    setDraftSelector,
    draftValue,
    setDraftValue,
    preview,
    setPreview,
    testName,
    setTestName,
    savedTests,
    refreshSaved,
    variables,
    envs,
    activeEnv,
    setActiveEnv,
    overrides,
    setOverrides,
    newVarName,
    setNewVarName,
    newEnvName,
    setNewEnvName,
    csvText,
    setCsvText,
    dataset,
    datasetReport,
    runningAll,
    runningDataset,
    runningSet,
    stopping,
    closing,
    restarting,
    paused,
    stepByStep,
    setStepByStep,
    stepTimeoutMs,
    setStepTimeoutMs,
    lastResult,
    setProgress,
    lastReport,
    lastReportPath,
    savedReports,
    refreshReports,
    handleSaveReport,
    handleOpenReport,
    handleDeleteReport,
    runOne,
    runAll,
    runSet,
    handlePause,
    handleResume,
    handleStop,
    onPreviewClick,
    handlePreviewScrollTo,
    previewScrollTo,
    refreshPreview,
    handleOpen,
    handleClose,
    handleRestart,
    tabs,
    refreshTabs,
    handleTabOpen,
    handleTabSwitch,
    handleTabClose,
    savedSessions,
    refreshSessions,
    handleSaveSession,
    handleLoadSession,
    handleDeleteSession,
    baselines,
    refreshBaselines,
    exporting,
    handleExport,
    addStep,
    removeStep,
    startReplace,
    startEdit,
    saveEdit,
    patchStep,
    duplicateStep,
    moveStep,
    togglePause,
    handleRegrab,
    handleSave,
    handleLoad,
    handleDelete,
    handleImportFile,
    newTest,
    addVariable,
    removeVariable,
    renameVariable,
    setVarType,
    setVarOptions,
    setVarValue,
    addEnv,
    importCsv,
    handleRunDataset,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}