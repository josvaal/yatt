import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  BadgeCheck,
  Braces,
  Camera,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  GitBranch,
  Globe,
  Hourglass,
  Image,
  Keyboard,
  List,
  ListChecks,
  ListTree,
  Loader2,
  MoreHorizontal,
  MousePointer2,
  MousePointerClick,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  ScrollText,
  SquareCheck,
  Trash2,
  Type,
  Upload,
  Wand2,
  Workflow,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { useEditor, type StepStatus } from "@/editor/context";
import { useI18n } from "@/lib/i18n";
import {
  ACTION_LABELS,
  isContainerStep,
  type BrowserKind,
  type Step,
  type ViewportPreset,
} from "@/lib/yatt";
import { cn } from "@/lib/utils";

const STEP_ICONS = {
  click: MousePointerClick,
  dblclick: MousePointerClick,
  hover: MousePointer2,
  type: Type,
  clear: Eraser,
  select_option: List,
  check: SquareCheck,
  press_key: Keyboard,
  wait_visible: Eye,
  scroll_to_element: ScrollText,
  assert_visible: BadgeCheck,
  assert_hidden: EyeOff,
  assert_text: CircleCheck,
  assert_value: CheckCircle,
  assert_attribute: ListChecks,
  goto: Globe,
  wait: Hourglass,
  upload: Upload,
  screenshot: Camera,
  if: GitBranch,
  repeat: Repeat,
  for_each: List,
  run_flow: Workflow,
  open_tab: ExternalLink,
  switch_tab: ArrowLeftRight,
  close_tab: X,
  capture_screenshot: Camera,
  assert_screenshot: Image,
} as const;

const STATUS_DOTS: Record<StepStatus, string> = {
  pending: "bg-zinc-400",
  running: "bg-blue-500 animate-pulse",
  ok: "bg-emerald-500",
  fail: "bg-red-500",
};

const STATUS_LABEL_KEYS: Record<StepStatus, string> = {
  pending: "editor.stPending",
  running: "editor.stRunning",
  ok: "editor.stOk",
  fail: "editor.stFail",
};

/** Sección plegable del panel del navegador: título con chevron y contenido. */
function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-sm font-medium"
      >
        {title}
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

/** Una fila del test: acción, selector editable y operaciones por paso. Permite
 *  pasos anidados (bloques if/repeat/for_each) con sangría y rama "si no". */
function StepRow({ step, index, siblings }: { step: Step; index: number; siblings: Step[] }) {
  const {
    status,
    editingId,
    draftSelector,
    setDraftSelector,
    draftValue,
    setDraftValue,
    saveEdit,
    patchStep,
    setEditingId,
    runOne,
    removeStep,
    startEdit,
    startReplace,
    replaceTarget,
    duplicateStep,
    moveStep,
    togglePause,
    handleRegrab,
    browserOpen,
    connected,
    runningAll,
    variables,
    savedTests,
    baselines,
  } = useEditor();

  const Icon = STEP_ICONS[step.action] ?? MousePointerClick;
  const st = status[step.id] ?? "pending";
  const dot = STATUS_DOTS[st];
  const { t } = useI18n();
  const editing = editingId === step.id;
  // Campo de edición sobre el que se inserta una variable con el menú {{}}.
  const editFocusRef = useRef<"selector" | "value">("value");

  // Config extra según la acción (Fase 4): veces, lista, sub-flujo, imagen base…
  const [draftTimes, setDraftTimes] = useState("2");
  const [draftList, setDraftList] = useState("");
  const [draftItemVar, setDraftItemVar] = useState("item");
  const [draftFlow, setDraftFlow] = useState("");
  const [draftWithVars, setDraftWithVars] = useState("");
  const [draftBaseline, setDraftBaseline] = useState("");
  const [draftTolerance, setDraftTolerance] = useState("0");
  const [draftFullPage, setDraftFullPage] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setDraftTimes(step.times !== undefined ? String(step.times) : "2");
    setDraftList(step.list ?? "");
    setDraftItemVar(step.itemVar ?? "item");
    setDraftFlow(step.flow ?? "");
    setDraftWithVars(Object.entries(step.withVars ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    setDraftBaseline(step.baseline ?? "");
    setDraftTolerance(step.tolerance !== undefined ? String(step.tolerance) : "0");
    setDraftFullPage(!!step.fullPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /** Guarda selector/valor (como siempre) + los campos extra de la acción. */
  function saveAll() {
    saveEdit(step.id);
    patchStep(step.id, {
      times: step.action === "repeat" ? Math.max(0, Math.floor(Number(draftTimes) || 0)) : step.times,
      list: step.action === "for_each" ? draftList : step.list,
      itemVar: step.action === "for_each" ? draftItemVar : step.itemVar,
      flow: step.action === "run_flow" ? draftFlow : step.flow,
      withVars:
        step.action === "run_flow"
          ? Object.fromEntries(
              draftWithVars
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => {
                  const i = l.indexOf("=");
                  return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""];
                }),
            )
          : step.withVars,
      baseline: step.action === "assert_screenshot" ? draftBaseline : step.baseline,
      tolerance:
        step.action === "assert_screenshot" ? Math.max(0, Number(draftTolerance) || 0) : step.tolerance,
      fullPage:
        step.action === "assert_screenshot" || step.action === "capture_screenshot"
          ? draftFullPage
          : step.fullPage,
    });
  }

  function insertVarIntoEdit(name: string) {
    const tok = `{{${name}}}`;
    if (editFocusRef.current === "selector") {
      setDraftSelector(draftSelector + tok);
      document.getElementById(`yatt-sel-${step.id}`)?.focus();
    } else {
      setDraftValue(draftValue + tok);
      document.getElementById(`yatt-val-${step.id}`)?.focus();
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/40",
        step.disabled && "opacity-60",
        replaceTarget === step.id && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                id={`yatt-sel-${step.id}`}
                value={draftSelector}
                onChange={(e) => setDraftSelector(e.currentTarget.value)}
                onFocus={() => (editFocusRef.current = "selector")}
                placeholder={t("editor.editSel")}
                className="h-7 min-w-28 flex-1 font-mono text-xs"
              />
              {(step.value !== undefined || step.action === "if") && (
                <Input
                  id={`yatt-val-${step.id}`}
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.currentTarget.value)}
                  onFocus={() => (editFocusRef.current = "value")}
                  placeholder={step.action === "if" ? t("editor.editIfVal") : t("editor.editVal")}
                  title={step.action === "if" ? t("editor.editIfValTitle") : undefined}
                  className="h-7 min-w-20 flex-1 font-mono text-xs"
                />
              )}
              {step.action === "repeat" && (
                <Input
                  value={draftTimes}
                  onChange={(e) => setDraftTimes(e.currentTarget.value)}
                  placeholder={t("editor.editTimes")}
                  title={t("editor.editTimesTitle")}
                  className="h-7 w-16 font-mono text-xs"
                />
              )}
              {step.action === "for_each" && (
                <>
                  <Input
                    value={draftList}
                    onChange={(e) => setDraftList(e.currentTarget.value)}
                    placeholder={t("editor.editList")}
                    title={t("editor.editListTitle")}
                    className="h-7 w-36 font-mono text-xs"
                  />
                  <Input
                    value={draftItemVar}
                    onChange={(e) => setDraftItemVar(e.currentTarget.value)}
                    placeholder={t("editor.editItem")}
                    title={t("editor.editItemTitle")}
                    className="h-7 w-24 font-mono text-xs"
                  />
                </>
              )}
              {step.action === "run_flow" && (
                <>
                  <Select value={draftFlow} onValueChange={(v) => setDraftFlow(String(v))}>
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue>{draftFlow || t("editor.editFlow")}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {savedTests.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t("editor.editFlowEmpty")}
                        </p>
                      ) : (
                        savedTests.map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))
                      )}
                    </SelectPopup>
                  </Select>
                  <Input
                    value={draftWithVars}
                    onChange={(e) => setDraftWithVars(e.currentTarget.value)}
                    placeholder={t("editor.editWithVars")}
                    title={t("editor.editWithVarsTitle")}
                    className="h-7 w-56 font-mono text-xs"
                  />
                </>
              )}
              {step.action === "assert_screenshot" && (
                <>
                  <Select value={draftBaseline} onValueChange={(v) => setDraftBaseline(String(v))}>
                    <SelectTrigger className="h-7 w-40 text-xs">
                      <SelectValue>{draftBaseline || t("editor.editBaseline")}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {baselines.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t("editor.editBaselineEmpty")}
                        </p>
                      ) : (
                        baselines.map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))
                      )}
                    </SelectPopup>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={draftTolerance}
                    onChange={(e) => setDraftTolerance(e.currentTarget.value)}
                    placeholder={t("editor.editTolerance")}
                    title={t("editor.editToleranceTitle")}
                    className="h-7 w-24 font-mono text-xs"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={draftFullPage}
                      onCheckedChange={(c) => setDraftFullPage(Boolean(c))}
                      aria-label={t("editor.editFullPageAria")}
                    />
                    {t("editor.editFullPage")}
                  </label>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" title={t("editor.editVars")} />}
                >
                  <Braces className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {variables.length === 0 ? (
                    <DropdownMenuLabel>{t("editor.editNoVars")}</DropdownMenuLabel>
                  ) : (
                    variables.map((v) => (
                      <DropdownMenuItem key={v.name} onClick={() => insertVarIntoEdit(v.name)}>
                        <Braces className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 truncate font-mono">{v.name}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="icon-sm"
                title={t("editor.editSave")}
                onClick={() => saveAll()}
              >
                <Check className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("editor.editCancel")}
                onClick={() => setEditingId(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <p className="truncate text-sm">
                <span className="font-medium capitalize">{ACTION_LABELS[step.action]}</span>
                {step.attribute && (
                  <span className="font-mono text-muted-foreground"> [{step.attribute}]</span>
                )}
                {step.value !== undefined &&
                  step.action !== "assert_screenshot" && (
                    <span className="text-muted-foreground"> “{step.value}”</span>
                  )}
                {step.action === "repeat" && step.times !== undefined && (
                  <span className="text-muted-foreground"> ×{step.times}</span>
                )}
                {step.action === "for_each" && (
                  <span className="text-muted-foreground">
                    {" "}
                    {step.itemVar ?? "?"} de {step.list ?? "…"}
                  </span>
                )}
                {step.action === "run_flow" && (
                  <span className="text-muted-foreground"> “{step.flow ?? "?"}”</span>
                )}
                {step.action === "capture_screenshot" && (
                  <span className="text-muted-foreground"> “{step.value ?? step.baseline ?? ""}”</span>
                )}
                {step.action === "assert_screenshot" && (
                  <span className="text-muted-foreground">
                    {" "}
                    “{step.baseline ?? step.value ?? ""}”
                    {step.tolerance !== undefined ? ` · ${t("editor.tolValue", step.tolerance)}` : ""}
                    {step.fullPage ? ` · ${t("editor.fullValue")}` : ""}
                  </span>
                )}
              </p>
              {step.selector && (
                <p className="truncate font-mono text-xs text-muted-foreground">{step.selector}</p>
              )}
            </>
          )}
        </div>

        {!editing && (
          <span className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground">
            {isContainerStep(step) && (
              <span className="whitespace-nowrap">
                {t("editor.blockSteps", (step.children?.length ?? 0) + (step.elseChildren?.length ?? 0))}
              </span>
            )}
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className={cn("size-1.5 rounded-full", dot)} />
              {t(STATUS_LABEL_KEYS[st])}
            </span>
            {step.disabled && <span className="whitespace-nowrap">{t("editor.stPaused")}</span>}
          </span>
        )}

        {!editing && (
          <Tooltip content={st === "running" ? t("editor.stRunning") : t("editor.runStep")}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!connected || st === "running" || runningAll}
              onClick={() => runOne(step)}
              aria-label={t("editor.runStep")}
            >
              {st === "running" ? (
                <Loader2 className="size-4 animate-spin text-blue-500" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
          </Tooltip>
        )}

        {!editing && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={t("editor.moreActions")} />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => startEdit(step)}>
                <Pencil className="size-4" />
                {isContainerStep(step) ? t("editor.menuEditContainer") : t("editor.menuEditLeaf")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRegrab(step.id)}
                disabled={!browserOpen || !connected}
              >
                <RefreshCw className="size-4" /> {t("editor.menuRegrab")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => startReplace(step.id)}
                disabled={!browserOpen || !connected || runningAll || st === "running"}
              >
                <Wand2 className="size-4" /> {t("editor.menuReplace")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => duplicateStep(step.id)}>
                <Copy className="size-4" /> {t("editor.menuDuplicate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => moveStep(step.id, -1)} disabled={index === 0}>
                <ChevronUp className="size-4" /> {t("editor.menuMoveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => moveStep(step.id, 1)}
                disabled={index === siblings.length - 1}
              >
                <ChevronDown className="size-4" /> {t("editor.menuMoveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => togglePause(step.id)}>
                <Pause className="size-4" /> {step.disabled ? t("editor.menuResume") : t("editor.menuPause")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => removeStep(step.id)}
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
              >
                <Trash2 className="size-4" /> {t("editor.menuDelete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {((step.children?.length ?? 0) > 0 || (step.elseChildren?.length ?? 0) > 0) && (
        <div className="ml-7 mt-1 space-y-1 border-l border-border pl-3">
          {step.children?.map((c, i) => (
            <StepRow key={c.id} step={c} index={i} siblings={step.children!} />
          ))}
          {(step.elseChildren?.length ?? 0) > 0 && (
            <>
              <p className="pl-1 text-xs text-muted-foreground">{t("editor.blockElse")}</p>
              {step.elseChildren!.map((c, i) => (
                <StepRow key={c.id} step={c} index={i} siblings={step.elseChildren!} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Página Editor: grabar pasos + preview en vivo + controles del navegador. */
export function EditorPage() {
  const {
    url,
    setUrl,
    addStep,
    steps,
    replaceTarget,
    browserOpen,
    connected,
    headless,
    setHeadless,
    preview,
    setPreview,
    onPreviewClick,
    handlePreviewScrollTo,
    previewScrollTo,
    refreshPreview,
    handleOpen,
    handleClose,
    handleRestart,
    closing,
    restarting,
    startReplace,
    replaceTargetIndex,
    savedTests,
    testName,
    handleExport,
    exporting,
    tabs,
    handleTabOpen,
    handleTabSwitch,
    handleTabClose,
    savedSessions,
    handleSaveSession,
    handleLoadSession,
    handleDeleteSession,
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
  } = useEditor();

  const [tabUrl, setTabUrl] = useState("");
  const [sessionName, setSessionName] = useState("");
  const { t } = useI18n();

  const imgRef = useRef<HTMLImageElement | null>(null);
  const wheelAcc = useRef(0);
  const wheelTimer = useRef<number | null>(null);

  // Rueda sobre la preview: scroll real con throttle (60 ms) para no saturar el bridge.
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !browserOpen) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAcc.current += e.deltaY;
      if (wheelTimer.current !== null) return;
      wheelTimer.current = window.setTimeout(async () => {
        wheelTimer.current = null;
        const dy = wheelAcc.current;
        wheelAcc.current = 0;
        if (!dy) return;
        try {
          const p = await previewScrollTo(0, dy);
          if (p?.screenshot) setPreview(p);
        } catch {
          /* navegador cerrado a mitad de camino */
        }
      }, 60);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current !== null) {
        window.clearTimeout(wheelTimer.current);
        wheelTimer.current = null;
      }
    };
  }, [preview?.screenshot, browserOpen, setPreview, previewScrollTo]);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* Pasos del test */}
      <section className="flex min-h-[70svh] flex-col rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-medium">{t("editor.stepsTitle")}</h2>
            {steps.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {steps.length === 1 ? t("editor.stepsCountOne") : t("editor.stepsCountMany", steps.length)}
              </p>
            )}
          </div>
          {steps.length > 0 && (
            <Tooltip content={t("editor.exportTitle")}>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileCode2 className="size-3.5" />}
                {exporting ? t("editor.exporting") : t("editor.export")}
              </Button>
            </Tooltip>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Label htmlFor="goto-url" className="sr-only">
              {t("editor.gotoLabel")}
            </Label>
            <Input
              id="goto-url"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              placeholder={t("editor.gotoLabel")}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5"
              onClick={() => addStep({ action: "goto", value: url || "https://example.com" })}
              aria-label={t("editor.addGotoAria")}
            >
              <Plus className="size-3.5" /> {t("editor.addGoto")}
            </Button>
          </div>
          <Tooltip content={t("editor.addWaitAria")}>
            <Button
              variant="outline"
              size="icon"
              onClick={() => addStep({ action: "wait", value: "1000" })}
              aria-label={t("editor.addWaitAria")}
            >
              <Clock className="size-4" />
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  title={t("editor.structure")}
                  aria-label={t("editor.structure")}
                />
              }
            >
              <ListTree className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{t("editor.structureLabel")}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => addStep({ action: "if", children: [], label: t("editor.structureIf") })}
              >
                <GitBranch className="size-4 text-muted-foreground" /> {t("editor.structureIf")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  addStep({
                    action: "if",
                    children: [],
                    elseChildren: [],
                    label: t("editor.structureIfElse"),
                  })
                }
              >
                <GitBranch className="size-4 text-muted-foreground" /> {t("editor.structureIfElse")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  addStep({ action: "repeat", times: 2, children: [], label: `${t("editor.structureRepeat")} ×2` })
                }
              >
                <Repeat className="size-4 text-muted-foreground" /> {t("editor.structureRepeat")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  addStep({
                    action: "for_each",
                    list: "a,b,c",
                    itemVar: "item",
                    children: [],
                    label: t("editor.structureForEach"),
                  })
                }
              >
                <List className="size-4 text-muted-foreground" /> {t("editor.structureForEach")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Workflow className="size-4 text-muted-foreground" /> {t("editor.structureRunFlow")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {savedTests.length === 0 ? (
                    <DropdownMenuLabel>{t("editor.structureFlowEmpty")}</DropdownMenuLabel>
                  ) : (
                    savedTests.map((n) => (
                      <DropdownMenuItem
                        key={n}
                        onClick={() =>
                          addStep({
                            action: "run_flow",
                            flow: n,
                            withVars: {},
                            label: `${t("editor.structureRunFlow")} ${n}`,
                          })
                        }
                      >
                        <span className="min-w-0 truncate font-mono">{n}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("editor.structureTabs")}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  addStep({
                    action: "open_tab",
                    value: url || "https://example.com",
                    label: `${t("editor.structureOpenTab")} ${url}`,
                  })
                }
              >
                <ExternalLink className="size-4 text-muted-foreground" /> {t("editor.structureOpenTab")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  addStep({ action: "switch_tab", value: "0", label: `${t("editor.structureSwitchTab")} 0` })
                }
              >
                <ArrowLeftRight className="size-4 text-muted-foreground" /> {t("editor.structureSwitchTab")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => addStep({ action: "close_tab", label: t("editor.structureCloseTab") })}
              >
                <X className="size-4 text-muted-foreground" /> {t("editor.structureCloseTab")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("editor.structureImages")}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  addStep({
                    action: "capture_screenshot",
                    value: `${(testName.trim() || "mi-test").replace(/[^a-zA-Z0-9._-]+/g, "-")}-base`,
                    label: t("editor.structureCapture"),
                  })
                }
              >
                <Camera className="size-4 text-muted-foreground" /> {t("editor.structureCapture")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  addStep({
                    action: "capture_screenshot",
                    value: `${(testName.trim() || "mi-test").replace(/[^a-zA-Z0-9._-]+/g, "-")}-base`,
                    fullPage: true,
                    label: t("editor.structureCaptureFull"),
                  })
                }
              >
                <Camera className="size-4 text-muted-foreground" /> {t("editor.structureCaptureFull")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {replaceTarget && (
            <div className="mx-2 mb-1 flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span>{t("editor.replaceBanner", replaceTargetIndex)}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                onClick={() => startReplace(replaceTarget!)}
              >
                <X className="size-3" /> {t("editor.replaceCancel")}
              </Button>
            </div>
          )}
          {steps.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <MousePointerClick className="size-8 text-muted-foreground/60" />
              <p className="max-w-md">{t("editor.emptyTitle")}</p>
              <p className="max-w-md text-xs">{t("editor.emptyHint")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {steps.map((step, i) => (
                <StepRow key={step.id} step={step} index={i} siblings={steps} />
              ))}
            </div>
          )}
        </div>
        <footer className="border-t px-5 py-3 text-xs text-muted-foreground">{t("editor.tip")}</footer>
      </section>

      {/* Navegador: preview + al abrir + pestañas + sesión */}
      <section className="rounded-xl border bg-card px-5 pb-5 pt-5">
        <header className="flex items-center justify-between gap-3 pb-4">
          <h2 className="text-base font-medium">{t("editor.browserTitle")}</h2>
          <span className="text-xs text-muted-foreground">
            {browserOpen ? t("editor.navOpen", browserKind) : t("editor.navClosed")}
          </span>
        </header>

        {browserOpen && preview?.screenshot ? (
          <div>
            <div className="relative overflow-hidden rounded-lg border">
              <img
                ref={imgRef}
                src={`data:image/png;base64,${preview.screenshot}`}
                alt={t("editor.previewAlt")}
                draggable={false}
                className="block w-full cursor-crosshair select-none"
                onClick={onPreviewClick}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {preview.title || preview.url}
                {preview.scrollY > 0 && ` · ${t("editor.pxDown", Math.round(preview.scrollY))}`}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip content={t("editor.previewRefresh")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={refreshPreview}
                    aria-label={t("editor.previewRefresh")}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content={t("editor.previewUp")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handlePreviewScrollTo(0)}
                    disabled={!preview}
                    aria-label={t("editor.previewUp")}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content={t("editor.previewDown")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handlePreviewScrollTo(preview?.maxScrollY ?? 0)}
                    disabled={!preview}
                    aria-label={t("editor.previewDown")}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {headless ? t("editor.previewCaptionHeadless") : t("editor.previewCaptionVisible")}
            </p>
          </div>
        ) : (
          <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
            <Globe className="size-6 text-muted-foreground/60" />
            <p className="max-w-xs">{t("editor.previewEmpty")}</p>
          </div>
        )}

        <Section title={t("editor.envTitle")} defaultOpen>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="headless-toggle" className="cursor-pointer text-sm">
              {t("editor.headlessOn")}
            </Label>
            <Switch
              id="headless-toggle"
              checked={headless}
              onCheckedChange={(c) => setHeadless(Boolean(c))}
              disabled={browserOpen}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="browser-kind" className="text-xs text-muted-foreground">
                {t("editor.envBrowser")}
              </Label>
              <Select
                value={browserKind}
                onValueChange={(v) => setBrowserKind(v as BrowserKind)}
                disabled={browserOpen}
              >
                <SelectTrigger id="browser-kind" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="chromium">Chromium</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="webkit">WebKit</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="viewport-kind" className="text-xs text-muted-foreground">
                {t("editor.envViewport")}
              </Label>
              <Select
                value={viewportKind}
                onValueChange={(v) => setViewportKind(v as ViewportPreset)}
                disabled={browserOpen}
              >
                <SelectTrigger id="viewport-kind" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="desktop">{t("editor.vpDesktop")}</SelectItem>
                  <SelectItem value="tablet">{t("editor.vpTablet")}</SelectItem>
                  <SelectItem value="mobile">{t("editor.vpMobile")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tz-select" className="text-xs text-muted-foreground">
              {t("editor.envTz")}
            </Label>
            <Select value={timezoneId} onValueChange={(v) => setTimezoneId(String(v))} disabled={browserOpen}>
              <SelectTrigger id="tz-select" className="h-8">
                <SelectValue>{timezoneId || t("editor.envTzNone")}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">{t("editor.envTzNone")}</SelectItem>
                {[
                  "America/Argentina/Buenos_Aires",
                  "America/Mexico_City",
                  "America/Los_Angeles",
                  "Europe/Madrid",
                  "UTC",
                  "Asia/Tokyo",
                ].map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="geo-toggle" className="cursor-pointer text-sm">
              {t("editor.envGeo")}
            </Label>
            <Switch
              id="geo-toggle"
              checked={geoEnabled}
              onCheckedChange={(c) => setGeoEnabled(Boolean(c))}
              disabled={browserOpen}
              aria-label={t("editor.envGeo")}
            />
          </div>
          {geoEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={geoLat}
                onChange={(e) => setGeoLat(e.currentTarget.value)}
                placeholder={t("editor.envLat")}
                aria-label={t("editor.envLat")}
                className="h-8 font-mono text-xs"
              />
              <Input
                value={geoLon}
                onChange={(e) => setGeoLon(e.currentTarget.value)}
                placeholder={t("editor.envLon")}
                aria-label={t("editor.envLon")}
                className="h-8 font-mono text-xs"
              />
            </div>
          )}
          <div className="pt-1">
            <Button
              className="w-full gap-1.5"
              onClick={() => handleOpen(headless ? "headless" : "visible")}
              disabled={browserOpen || !connected}
            >
              {headless ? <EyeOff className="size-4" /> : <Globe className="size-4" />}
              {t("editor.openBrowser")}
            </Button>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Tooltip content={t("editor.restartTitle")}>
                <Button
                  variant="outline"
                  onClick={handleRestart}
                  disabled={restarting || !browserOpen || !connected}
                  className="gap-1.5"
                >
                  {restarting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {restarting ? t("editor.restarting") : t("editor.restart")}
                </Button>
              </Tooltip>
              <Button
                variant="outline"
                className="gap-1.5 text-destructive"
                onClick={handleClose}
                disabled={closing || !browserOpen || !connected}
              >
                {closing ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                {closing ? t("editor.closing") : t("editor.close")}
              </Button>
            </div>
          </div>
        </Section>

        {browserOpen && (
          <Section title={t("editor.tabsCount", tabs.length)} defaultOpen={tabs.length > 1}>
            {tabs.length > 1 && <p className="text-xs text-muted-foreground">{t("editor.tabsHint")}</p>}
            <div className="space-y-1">
              {tabs.map((tb) => (
                <div
                  key={tb.index}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                    tb.active && "bg-muted",
                  )}
                >
                  <button
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => handleTabSwitch(tb.index)}
                    title={tb.url}
                  >
                    <span className="font-mono text-muted-foreground">{tb.index}</span>{" "}
                    {tb.title || tb.url || t("editor.tabLoading")}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleTabClose(tb.index)}
                    title={t("editor.tabClose", tb.index)}
                    aria-label={t("editor.tabClose", tb.index)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={tabUrl}
                onChange={(e) => setTabUrl(e.currentTarget.value)}
                placeholder="https://…"
                className="h-8 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1 text-xs"
                onClick={() => {
                  handleTabOpen(tabUrl || "https://example.com");
                  setTabUrl("");
                }}
              >
                <ExternalLink className="size-3.5" /> {t("editor.tabNew")}
              </Button>
            </div>
          </Section>
        )}

        <Section title={t("editor.sessionTitle")} defaultOpen={savedSessions.length > 0}>
          <p className="text-xs text-muted-foreground">{t("editor.sessionHint")}</p>
          <div className="flex gap-2">
            <Input
              value={sessionName}
              onChange={(e) => setSessionName(e.currentTarget.value)}
              placeholder={t("editor.sessionName")}
              className="h-8 font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 text-xs"
              disabled={!browserOpen || !sessionName.trim()}
              onClick={() => {
                handleSaveSession(sessionName.trim());
                setSessionName("");
              }}
            >
              <Download className="size-3.5" /> {t("editor.sessionSave")}
            </Button>
          </div>
          {savedSessions.length > 0 ? (
            <div className="space-y-1">
              {savedSessions.map((n) => (
                <div key={n} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50">
                  <button
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    onClick={() => handleLoadSession(n)}
                    title={t("editor.sessionLoadTitle", n)}
                  >
                    {n}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDeleteSession(n)}
                    title={t("editor.sessionDelete")}
                    aria-label={`${t("editor.sessionDelete")}: ${n}`}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("editor.sessionEmpty")}</p>
          )}
        </Section>
      </section>
    </div>
  );
}