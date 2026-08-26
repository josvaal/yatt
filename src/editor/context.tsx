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
  closeBrowser,
  defaultTest,
  deleteTest,
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
  saveTest,
  startGrab,
  toolbarVars,
  describeStep,
  type PreviewState,
  type SidecarEvent,
  type Step,
  type StepResult,
  type TestFile,
} from "@/lib/yatt";
import {
  ENV_DEFAULT,
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
  datasetReport: Array<{ ok: boolean; label: string; error?: string }> | null;

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

  // pasos CRUD
  addStep: (step: Omit<Step, "id">) => void;
  removeStep: (id: Ids) => void;
  startReplace: (id: Ids) => void;
  startEdit: (step: Step) => void;
  saveEdit: (id: Ids) => void;
  duplicateStep: (id: Ids) => void;
  moveStep: (id: Ids, dir: -1 | 1) => void;
  togglePause: (id: Ids) => void;
  handleRegrab: (id: Ids) => Promise<void>;

  // persistencia
  handleSave: () => Promise<void>;
  handleLoad: (name: string) => Promise<void>;
  handleDelete: (name: string) => Promise<void>;
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
  importCsv: () => void;
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
    Array<{ ok: boolean; label: string; error?: string }> | null
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
          } else {
            setPreview(null);
          }
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
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshSaved, refreshPreview, refreshReports]);

  const runOne = useCallback(
    async (step: Step, statusId?: Ids) => {
      const id = statusId ?? step.id;
      if (busyRef.current) return null;
      busyRef.current = true;
      setStatus((prev) => ({ ...prev, [id]: "running" }));
      try {
        const r = (await runStep(step, stepTimeoutRef.current)) as StepResult;
        setStatus((prev) => ({ ...prev, [id]: r.ok ? "ok" : "fail" }));
        setLastResult({ stepId: id, ok: r.ok, error: r.error, ms: r.ms, screenshot: r.screenshot });
        refreshPreview();
        return { ok: r.ok, ms: r.ms, error: r.error, screenshot: r.screenshot };
      } catch (err) {
        setStatus((prev) => ({ ...prev, [id]: "fail" }));
        setLastResult({ stepId: id, ok: false, error: String(err) });
        return { ok: false, error: String(err) };
      } finally {
        busyRef.current = false;
      }
    },
    [refreshPreview],
  );

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
      const records: RunRecord[] = [];
      let okCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      let stopped = false;
      for (const step of steps) {
        if (stopRef.current) {
          stopped = true;
          break;
        }
        if (pauseRef.current) await waitResume();
        // Modo paso a paso: pausa antes de cada paso para revisarlo (RF-17).
        if (stopRef.current) {
          stopped = true;
          break;
        }
        if (stepByStepRef.current) {
          requestPause();
          await waitResume();
        }
        if (stopRef.current) {
          stopped = true;
          break;
        }
        const base: RunRecord = {
          index: records.length + 1,
          action: step.action,
          selector: step.selector,
          value: step.value,
          attribute: step.attribute,
          status: "ok",
        };
        if (step.disabled) {
          records.push({ ...base, status: "skipped" });
          skippedCount++;
          continue;
        }
        const r = await runOne(resolveStep(step, vars), step.id);
        if (r) {
          records.push({
            ...base,
            status: r.ok ? "ok" : "fail",
            ms: r.ms,
            error: r.error,
            screenshot: r.screenshot,
          });
          if (r.ok) okCount++;
          else failCount++;
        }
      }
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
        ok: okCount,
        fail: failCount,
        skipped: skippedCount,
        stopped,
        logs: logsRef.current.slice(),
        steps: records,
      };
      setLastReport(report);
      return { okCount, failCount, skipped: skippedCount, stopped, total: okCount + failCount, report };
    },
    [steps, runOne, testName, url, activeEnv, headless],
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

  const handleOpen = useCallback(
    async (mode: "visible" | "headless") => {
      setAppError(null);
      try {
        await openBrowser(
          url || "https://example.com",
          mode === "headless",
          variables.map((v) => v.name),
        );
        setHeadless(mode === "headless");
      } catch (err) {
        setAppError(`No se pudo abrir el navegador: ${String(err)}`);
      }
    },
    [url, variables],
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
      await openBrowser(url || "https://example.com", headless, variables.map((v) => v.name));
      // Los estados ok/fallo quedaron stale tras el reinicio total.
      setStatus({});
      setLastResult(null);
    } catch (err) {
      setAppError(`No se pudo reiniciar el navegador: ${String(err)}`);
    } finally {
      setRestarting(false);
    }
  }, [url, headless, variables]);

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

  function removeStep(id: Ids) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
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
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, selector: draftSelector.trim() || undefined, value: draftValue || undefined }
          : s,
      ),
    );
    setStatus((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEditingId(null);
    setLastResult(null);
  }

  function duplicateStep(id: Ids) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const copy: Step = { ...prev[i], id: crypto.randomUUID(), disabled: true };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
  }

  function moveStep(id: Ids, dir: -1 | 1) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function togglePause(id: Ids) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, disabled: !s.disabled } : s)));
  }

  /** Re-grabado en un clic (RF-06): el siguiente clic en la página reemplaza el selector. */
  async function handleRegrab(id: Ids) {
    const step = steps.find((s) => s.id === id);
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
        prev.map((s) => (s.id === id ? { ...s, selector: sel, label: describeStep({ ...s, selector: sel }) } : s)),
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
            await openBrowser(doc.url || "about:blank", true, (doc.variables ?? []).map((v) => v.name));
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
          const records: RunRecord[] = [];
          let f = 0;
          for (const s of doc.steps ?? []) {
            if (stopRef.current) {
              stopped = true;
              break;
            }
            if (pauseRef.current) await waitResume();
            const base: RunRecord = {
              index: records.length + 1,
              action: s.action,
              selector: s.selector,
              value: s.value,
              attribute: s.attribute,
              status: "ok",
            };
            if (s.disabled) {
              records.push({ ...base, status: "skipped" });
              continue;
            }
            const r = await runOne(resolveStep(s, vars), s.id);
            if (r) {
              records.push({
                ...base,
                status: r.ok ? "ok" : "fail",
                ms: r.ms,
                error: r.error,
                screenshot: r.screenshot,
              });
              if (!r.ok) f++;
            }
          }
          await closeBrowser();
          setBrowserOpen(false);
          const testOk = f === 0 && !stopped;
          tests.push({
            name: doc.name || name,
            ok: testOk,
            ms: Date.now() - t0,
            fail: f,
            stopped,
            steps: records,
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
    [refreshReports, runOne],
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

  function importCsv() {
    const d = parseCsv(csvText);
    if (d.columns.length === 0 || d.rows.length === 0) {
      setAppError("CSV inválido: necesita cabecera con nombres de variable y al menos una fila.");
      setDataset(null);
      return;
    }
    setDataset(d);
    setDatasetReport(null);
    setAppError(null);
  }

  async function handleRunDataset() {
    if (!dataset || dataset.rows.length === 0) return;
    setRunningDataset(true);
    const report: Array<{ ok: boolean; label: string }> = [];
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
        label: `Fila ${i + 1} · ${res.okCount}/${res.total} ok${res.stopped ? " · detenida" : ""}`,
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
    addStep,
    removeStep,
    startReplace,
    startEdit,
    saveEdit,
    duplicateStep,
    moveStep,
    togglePause,
    handleRegrab,
    handleSave,
    handleLoad,
    handleDelete,
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