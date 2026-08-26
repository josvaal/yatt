import {
  CheckCircle2,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Save,
  Square,
  XCircle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEditor, type LastResult } from "@/editor/context";
import { ENV_DEFAULT } from "@/lib/vars";
import { cn } from "@/lib/utils";

/** Bloque de evidencia del último paso ejecutado (error + screenshot). */
function LastResultCard({ lastResult }: { lastResult: LastResult | null }) {
  if (!lastResult) {
    return (
      <p className="text-sm text-muted-foreground">
        Ejecuta un paso, graba una acción o corre el test completo para ver el resultado aquí.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        {lastResult.ok ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <XCircle className="size-4 text-red-500" />
        )}
        <span className={lastResult.ok ? "text-emerald-500" : "text-destructive"}>
          {lastResult.ok ? "Paso ejecutado correctamente" : "El paso falló"}
        </span>
        {lastResult.ms !== undefined && (
          <span className="text-xs text-muted-foreground">{lastResult.ms} ms</span>
        )}
      </div>
      {lastResult.error && (
        <p className="max-h-40 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs text-destructive">
          {lastResult.error}
        </p>
      )}
      {lastResult.screenshot && (
        <img
          src={`data:image/png;base64,${lastResult.screenshot}`}
          alt="Evidencia"
          className="mt-1 max-h-72 w-full rounded-md border object-contain"
        />
      )}
    </div>
  );
}

/** Página Ejecución: correr el test completo, pausar, y guardar el reporte. */
export function RunPage() {
  const {
    steps,
    connected,
    runningAll,
    stopping,
    handleStop,
    runAll,
    activeEnv,
    okCount,
    failCount,
    pendingCount,
    paused,
    handlePause,
    handleResume,
    stepByStep,
    setStepByStep,
    stepTimeoutMs,
    setStepTimeoutMs,
    lastResult,
    lastReport,
    lastReportPath,
    handleSaveReport,
    handleOpenReport,
  } = useEditor();

  const total = steps.length;
  const done = okCount + failCount;
  const progress = total ? (done / total) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Ejecutar el test</CardTitle>
              <CardDescription>
                Corre todos los pasos en orden con el entorno {activeEnv}
                {activeEnv !== ENV_DEFAULT ? "" : " (default)"}
              </CardDescription>
            </div>
            {steps.length > 0 && (
              <Badge variant="secondary">
                {okCount} ok · {failCount} fallo{failCount === 1 ? "" : "s"} · {pendingCount} pendientes
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {runningAll ? (
            <div className="space-y-2">
              {paused && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  <span>Ejecución pausada — pulsa Reanudar para seguir.</span>
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={handleResume}>
                    <Play className="size-3" /> Reanudar
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant={stopping ? "secondary" : "destructive"}
                  onClick={handleStop}
                  disabled={stopping}
                  className="gap-1.5"
                >
                  {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                  {stopping ? "Deteniendo…" : "Detener"}
                </Button>
                {paused ? (
                  <Button variant="outline" onClick={handleResume} className="gap-1.5">
                    <Play className="size-4" /> Reanudar
                  </Button>
                ) : (
                  <Button variant="outline" onClick={handlePause} className="gap-1.5">
                    <Pause className="size-4" /> Pausar
                  </Button>
                )}
                <div className="flex items-center justify-end pr-1 text-xs text-muted-foreground">
                  Esc detiene
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    paused ? "bg-amber-500" : "bg-primary",
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Paso {done} de {total}
                {paused ? " · pausado" : ""}
              </p>
            </div>
          ) : (
            <Button
              onClick={runAll}
              disabled={steps.length === 0 || !connected}
              className="w-full gap-1.5"
            >
              <Play className="size-4" />
              {steps.length === 0
                ? "No hay pasos todavía"
                : `Ejecutar todos${activeEnv !== ENV_DEFAULT ? ` · ${activeEnv}` : ""}`}
            </Button>
          )}
          {!connected && (
            <p className="text-xs text-amber-500">El sidecar no está conectado: no se puede ejecutar.</p>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="step-by-step" className="cursor-pointer text-sm">
                Paso a paso (pausa antes de cada paso)
              </Label>
              <Switch id="step-by-step" checked={stepByStep} onCheckedChange={(c) => setStepByStep(Boolean(c))} />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="step-timeout" className="text-sm">
                Timeout por paso (s)
              </Label>
              <Input
                id="step-timeout"
                type="number"
                min={1}
                value={stepTimeoutMs / 1000}
                onChange={(e) =>
                  setStepTimeoutMs(Math.max(1000, Number(e.currentTarget.value) * 1000 || 40000))
                }
                className="h-7 w-20 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reporte de la última corrida</CardTitle>
          <CardDescription>
            Informe JSON + HTML con cada paso, screenshots de fallo y logs del sidecar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!lastReport ? (
            <p className="text-sm text-muted-foreground">
              Corre el test (o un set desde la página Reportes) para generar un reporte.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">
                  {lastReport.ok} ok · {lastReport.fail} fallo
                  {lastReport.skipped ? ` · ${lastReport.skipped} saltados` : ""}
                  {lastReport.stopped ? " · detenida" : ""}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {(lastReport.durationMs / 1000).toFixed(1)} s · {lastReport.kind === "set" ? "set" : lastReport.env}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleSaveReport} disabled={!lastReport} className="gap-1.5">
                  <Save className="size-3.5" /> Guardar reporte (HTML + JSON)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenReport()}
                  disabled={!lastReportPath}
                  className="gap-1.5"
                >
                  <FolderOpen className="size-3.5" /> Abrir reporte
                </Button>
              </div>
              {lastReportPath && (
                <p className="truncate font-mono text-[11px] text-muted-foreground">{lastReportPath}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Último resultado</CardTitle>
          <CardDescription>Evidencia del último paso ejecutado</CardDescription>
        </CardHeader>
        <CardContent>
          <LastResultCard lastResult={lastResult} />
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <ListChecks className="mt-0.5 size-4 shrink-0" />
        <p>
          <FileText className="mr-1 inline size-3.5" />
          Tips: para correr varios tests en una sola pasada headless, ve a la página{" "}
          <b>Reportes</b> y usa “Correr set”. El modo <b>Paso a paso</b> pausa antes de cada paso
          (útil en modo visible) y <b>Esc</b> detiene la corrida limpiamente.
        </p>
      </div>
    </div>
  );
}