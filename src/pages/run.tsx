import { FolderOpen, Loader2, Pause, Play, Save, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEditor, type LastResult } from "@/editor/context";
import { useI18n } from "@/lib/i18n";
import { ENV_DEFAULT } from "@/lib/vars";
import { cn } from "@/lib/utils";

/** Evidencia del último paso ejecutado (error y captura, si los hay). */
function LastResultCard({ lastResult }: { lastResult: LastResult | null }) {
  const { t } = useI18n();
  if (!lastResult) {
    return <p className="text-xs text-muted-foreground">{t("run.lastEmpty")}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn("size-1.5 shrink-0 rounded-full", lastResult.ok ? "bg-emerald-500" : "bg-red-500")} />
        <span>{lastResult.ok ? t("run.lastOk") : t("run.lastFail")}</span>
        {lastResult.ms !== undefined && (
          <span className="text-xs text-muted-foreground">· {lastResult.ms} ms</span>
        )}
      </div>
      {lastResult.error && (
        <p className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-destructive">
          {lastResult.error}
        </p>
      )}
      {lastResult.screenshot && (
        <img
          src={`data:image/png;base64,${lastResult.screenshot}`}
          alt={t("run.evidence")}
          className="max-h-72 w-full rounded-md object-contain"
        />
      )}
    </div>
  );
}

/** Página Ejecución: correr el test completo y ver reporte y evidencia del último paso. */
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

  const { t } = useI18n();

  const total = steps.length;
  const done = okCount + failCount;
  const progress = total ? (done / total) * 100 : 0;

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="flex min-h-[70svh] flex-col rounded-xl border bg-card">
        <header className="px-5 pt-5 pb-4">
          <h2 className="text-base font-medium">{t("run.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeEnv !== ENV_DEFAULT ? t("run.desc", activeEnv) : t("run.descDefault")}
          </p>
        </header>

        <div className="flex-1 space-y-3 px-5 pb-4">
          {runningAll ? (
            <div className="space-y-3">
              {paused && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs">
                  <span>{t("run.paused")}</span>
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={handleResume}>
                    <Play className="size-3" /> {t("run.resume")}
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
                  {stopping ? t("run.stopping") : t("run.stop")}
                </Button>
                {paused ? (
                  <Button variant="outline" onClick={handleResume} className="gap-1.5">
                    <Play className="size-4" /> {t("run.resume")}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={handlePause} className="gap-1.5">
                    <Pause className="size-4" /> {t("run.pause")}
                  </Button>
                )}
                <div className="flex items-center justify-end pr-1 text-xs text-muted-foreground">
                  {t("run.escHint")}
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
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs text-muted-foreground">
                <span>
                  {t("run.progress", done, total)}
                  {paused ? " · " + t("run.pause").toLowerCase() : ""}
                </span>
                <span>{t("run.count", okCount, failCount, pendingCount)}</span>
              </div>
            </div>
          ) : (
            <Button
              onClick={runAll}
              disabled={steps.length === 0 || !connected}
              className="w-full gap-1.5"
            >
              <Play className="size-4" />
              {steps.length === 0
                ? t("run.noSteps")
                : `${t("topbar.runAll")}${activeEnv !== ENV_DEFAULT ? ` · ${activeEnv}` : ""}`}
            </Button>
          )}
          {!connected && <p className="text-xs text-amber-500">{t("run.noSidecar")}</p>}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="step-by-step" className="cursor-pointer text-sm">
                {t("run.stepByStep")}
              </Label>
              <Switch id="step-by-step" checked={stepByStep} onCheckedChange={(c) => setStepByStep(Boolean(c))} />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="step-timeout" className="text-sm">
                {t("run.timeoutLabel")}
              </Label>
              <Input
                id="step-timeout"
                type="number"
                min={1}
                value={stepTimeoutMs / 1000}
                onChange={(e) =>
                  setStepTimeoutMs(Math.max(1000, Number(e.currentTarget.value) * 1000 || 40000))
                }
                className="h-7 w-20 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        <footer className="border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">{t("run.tip1")}</p>
        </footer>
      </section>

      <section className="rounded-xl border bg-card px-5 pb-6 pt-5">
        <h2 className="text-base font-medium">{t("run.rightTitle")}</h2>

        <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-medium">{t("run.reportTitle")}</h3>
          <div className="mt-3">
            {!lastReport ? (
              <p className="text-xs text-muted-foreground">{t("run.reportEmpty")}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      lastReport.fail === 0 && !lastReport.stopped ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                  <span>{t("run.reportCount", lastReport.ok, lastReport.fail)}</span>
                  {lastReport.skipped ? (
                    <span className="text-muted-foreground">
                      {t("run.reportSkipped", lastReport.skipped)}
                    </span>
                  ) : null}
                  {lastReport.stopped && (
                    <span className="text-muted-foreground">{t("run.stoppedSuffix")}</span>
                  )}
                  <span className="text-muted-foreground">
                    {t("run.reportMeta", (lastReport.durationMs / 1000).toFixed(1), lastReport.kind === "set" ? t("run.kindSet") : (lastReport.env ?? ""))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleSaveReport} disabled={!lastReport} className="gap-1.5">
                    <Save className="size-3.5" /> {t("run.saveReport")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenReport()}
                    disabled={!lastReportPath}
                    className="gap-1.5"
                  >
                    <FolderOpen className="size-3.5" /> {t("run.openReport")}
                  </Button>
                </div>
                {lastReportPath && (
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{lastReportPath}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-medium">{t("run.lastResultTitle")}</h3>
          <div className="mt-3">
            <LastResultCard lastResult={lastResult} />
          </div>
        </div>
      </section>
    </div>
  );
}