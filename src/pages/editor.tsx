import { useEffect, useRef } from "react";
import {
  ArrowDown,
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
  Eraser,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Hourglass,
  Keyboard,
  List,
  ListChecks,
  Loader2,
  MoreHorizontal,
  MousePointer2,
  MousePointerClick,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  ScrollText,
  SquareCheck,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { useEditor, type StepStatus } from "@/editor/context";
import { ACTION_LABELS, type Step } from "@/lib/yatt";
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
} as const;

const STATUS_STYLES: Record<StepStatus, { label: string; dot: string }> = {
  pending: { label: "pendiente", dot: "bg-zinc-400" },
  running: { label: "corriendo…", dot: "bg-blue-500 animate-pulse" },
  ok: { label: "ok", dot: "bg-emerald-500" },
  fail: { label: "falló", dot: "bg-red-500" },
};

/** Una fila del test: acción, selector editable y operaciones por paso. */
function StepRow({ step, index }: { step: Step; index: number }) {
  const {
    status,
    editingId,
    draftSelector,
    setDraftSelector,
    draftValue,
    setDraftValue,
    saveEdit,
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
    steps,
    variables,
  } = useEditor();

  const Icon = STEP_ICONS[step.action] ?? MousePointerClick;
  const st = status[step.id] ?? "pending";
  const style = STATUS_STYLES[st];
  const editing = editingId === step.id;
  // Campo de edición sobre el que se inserta una variable con el menú {{}}.
  const editFocusRef = useRef<"selector" | "value">("value");

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
        "rounded-lg border bg-card p-3 transition-colors",
        st === "fail" && "border-destructive/40",
        st === "ok" && "border-emerald-500/40",
        step.disabled && "opacity-60",
        replaceTarget === step.id && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="w-5 shrink-0 text-center text-xs font-medium text-muted-foreground">
          {index + 1}
        </span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-3.5 text-muted-foreground" />
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                id={`yatt-sel-${step.id}`}
                value={draftSelector}
                onChange={(e) => setDraftSelector(e.currentTarget.value)}
                onFocus={() => (editFocusRef.current = "selector")}
                placeholder="selector"
                className="h-7 min-w-28 flex-1 font-mono text-[11px]"
              />
              {step.value !== undefined && (
                <Input
                  id={`yatt-val-${step.id}`}
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.currentTarget.value)}
                  onFocus={() => (editFocusRef.current = "value")}
                  placeholder="valor"
                  className="h-7 min-w-20 flex-1 font-mono text-[11px]"
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" title="Insertar variable {{nombre}}" />}
                >
                  <Braces className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {variables.length === 0 ? (
                    <DropdownMenuLabel>Sin variables definidas</DropdownMenuLabel>
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
                title="Guardar cambios"
                onClick={() => saveEdit(step.id)}
              >
                <Check className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Cancelar"
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
                {step.value !== undefined && (
                  <span className="text-muted-foreground"> “{step.value}”</span>
                )}
              </p>
              {step.selector && (
                <p className="truncate font-mono text-xs text-muted-foreground">{step.selector}</p>
              )}
            </>
          )}
        </div>

        {!editing && (
          <span className="flex items-center gap-1.5">
            <Badge variant="outline" className="gap-1.5">
              <span className={cn("size-2 rounded-full", style.dot)} />
              <span className="text-xs">{style.label}</span>
            </Badge>
            {step.disabled && <Badge className="text-xs">pausado</Badge>}
          </span>
        )}

        {!editing && (
          <Tooltip content={st === "running" ? "Corriendo…" : "Ejecutar este paso"}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!connected || st === "running" || runningAll}
              onClick={() => runOne(step)}
              aria-label="Ejecutar paso"
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
              render={<Button variant="ghost" size="icon-sm" aria-label="Más acciones" />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => startEdit(step)}>
                <Pencil className="size-4" /> Editar selector y valor
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRegrab(step.id)}
                disabled={!browserOpen || !connected}
              >
                <RefreshCw className="size-4" /> Re-grabar selector
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => startReplace(step.id)}
                disabled={!browserOpen || !connected || runningAll || st === "running"}
              >
                <Wand2 className="size-4" /> Reemplazar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => duplicateStep(step.id)}>
                <Copy className="size-4" /> Duplicar (pausada)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => moveStep(step.id, -1)} disabled={index === 0}>
                <ChevronUp className="size-4" /> Mover arriba
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => moveStep(step.id, 1)}
                disabled={index === steps.length - 1}
              >
                <ChevronDown className="size-4" /> Mover abajo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => togglePause(step.id)}>
                <Pause className="size-4" /> {step.disabled ? "Reanudar" : "Pausar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => removeStep(step.id)}
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
              >
                <Trash2 className="size-4" /> Eliminar paso
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
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
    okCount,
    failCount,
    pendingCount,
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
    handleLoad,
    handleDelete,
    refreshSaved,
  } = useEditor();

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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* Pasos del test */}
      <Card className="flex min-h-[70svh] flex-col">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Pasos del test</CardTitle>
              <CardDescription>
                Señala los elementos en Chromium y usa la barra flotante YATT
              </CardDescription>
            </div>
            {steps.length > 0 && (
              <Badge variant="secondary">
                {okCount} ok · {failCount} fallo{failCount === 1 ? "" : "s"} · {pendingCount} pendientes
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="goto-url" className="text-xs">
                Añadir paso “ir a URL”
              </Label>
              <div className="flex gap-2">
                <Input
                  id="goto-url"
                  value={url}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                  placeholder="https://…"
                  className="font-mono text-xs"
                />
                <Tooltip content="Añadir paso ir a URL">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => addStep({ action: "goto", value: url || "https://example.com" })}
                    aria-label="Añadir paso ir a URL"
                  >
                    <Globe className="size-4" />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <Tooltip content="Añadir espera de 1 segundo">
              <Button
                variant="outline"
                size="icon"
                onClick={() => addStep({ action: "wait", value: "1000" })}
                aria-label="Añadir espera de 1 segundo"
              >
                <Clock className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-2 overflow-y-auto">
          {replaceTarget && (
            <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
              <span>
                Reemplazando el paso #{replaceTargetIndex}: elige una acción en la barra{" "}
                <b>YATT</b> de la página y haz clic en el objetivo.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                onClick={() => startReplace(replaceTarget!)}
              >
                <X className="size-3" /> Cancelar
              </Button>
            </div>
          )}
          {steps.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
              <MousePointerClick className="size-8 text-muted-foreground/60" />
              <p className="max-w-sm">
                Abre el navegador (botón “Abrir navegador”), pulsa la acción en la barra flotante{" "}
                <b>YATT</b> (Click, ×2, Hover, Escribir…) y luego haz clic sobre el elemento objetivo
                de la página. El paso se crea, se ejecuta y se valida al instante.
              </p>
              <p className="max-w-sm text-xs">
                ¿Ya tienes un test guardado? Cárgalo desde el panel <b>Tests guardados</b> de la
                derecha.
              </p>
            </div>
          ) : (
            steps.map((step, i) => <StepRow key={step.id} step={step} index={i} />)
          )}
        </CardContent>
        <CardContent className="border-t pt-3 text-xs text-muted-foreground">
          Pista: si un paso falla tras un cambio de la web, pulsa <b>Re-grabar selector</b> en el
          menú ⋯ del paso y haz clic en el nuevo elemento. Los pasos pausados se saltan en “Ejecutar
          todos” y el botón <b>Detener</b> (o Esc) corta la corrida en curso.
        </CardContent>
      </Card>

      {/* Preview + navegador */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Preview de la página</CardTitle>
              <div className="flex items-center gap-1">
                <Tooltip content="Actualizar preview">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={refreshPreview}
                    disabled={!browserOpen}
                    aria-label="Actualizar preview"
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="Subir arriba">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handlePreviewScrollTo(0)}
                    disabled={!browserOpen || !preview}
                    aria-label="Subir"
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="Bajar abajo">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handlePreviewScrollTo(preview?.maxScrollY ?? 0)}
                    disabled={!browserOpen || !preview}
                    aria-label="Bajar"
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <CardDescription className="truncate">
              {preview ? preview.title || preview.url : "Vista en vivo del navegador"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {browserOpen && preview?.screenshot ? (
              <>
                <div className="relative overflow-hidden rounded-md border">
                  <img
                    ref={imgRef}
                    src={`data:image/png;base64,${preview.screenshot}`}
                    alt="Preview de la página"
                    draggable={false}
                    className="block w-full cursor-crosshair select-none"
                    onClick={onPreviewClick}
                  />
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {headless
                    ? "Headless: clic sobre la imagen = click real · rueda = scroll."
                    : "La ventana de Chromium se usa directamente; aquí tienes un espejo clicable y scrolleable."}
                  {preview.scrollY > 0 && ` · ${Math.round(preview.scrollY)} px abajo`}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Abre el navegador para ver la página en vivo. En headless esta vista es tu
                superficie de interacción.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Navegador</CardTitle>
            <CardDescription>Chromium controlado por Playwright (sidecar)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="headless-toggle" className="cursor-pointer text-sm">
                Headless (sin ventana)
              </Label>
              <Switch
                id="headless-toggle"
                checked={headless}
                onCheckedChange={(c) => setHeadless(Boolean(c))}
                disabled={browserOpen}
              />
            </div>
            <Button
              className="w-full gap-1.5"
              onClick={() => handleOpen(headless ? "headless" : "visible")}
              disabled={browserOpen || !connected}
            >
              {headless ? <EyeOff className="size-4" /> : <Globe className="size-4" />}
              Abrir navegador {headless ? "(headless)" : "(visible)"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Tooltip content="Cierra y reabre el navegador con sesión limpia (sin cookies ni estado), sin perder los pasos">
                <Button
                  variant="outline"
                  onClick={handleRestart}
                  disabled={restarting || !browserOpen || !connected}
                  className="gap-1.5"
                >
                  {restarting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {restarting ? "Reiniciando…" : "Reiniciar"}
                </Button>
              </Tooltip>
              <Button
                variant="destructive"
                onClick={handleClose}
                disabled={closing || !browserOpen || !connected}
                className="gap-1.5"
              >
                {closing ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                {closing ? "Cerrando…" : "Cerrar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Tests guardados</CardTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Refrescar lista"
                onClick={refreshSaved}
                aria-label="Refrescar tests guardados"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <CardDescription>Archivos JSON en tests/ · clic para cargar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {savedTests.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Todavía no hay tests guardados. Graba pasos y pulsa Guardar en la barra superior.
              </p>
            ) : (
              savedTests.map((name) => (
                <div key={name} className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-mono text-xs hover:underline"
                    onClick={() => handleLoad(name)}
                    title={`Cargar ${name}`}
                  >
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </button>
                  <Tooltip content="Eliminar de tests/">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDelete(name)}
                      aria-label={`Eliminar ${name}`}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </Tooltip>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}