import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Pause, Play, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/context";
import { useI18n } from "@/lib/i18n";

/** Página Reportes: correr varios tests en una pasada y revisar los reportes guardados. */
export function ReportsPage() {
  const { t } = useI18n();
  const {
    savedTests,
    runSet,
    runningSet,
    setProgress,
    paused,
    handlePause,
    handleResume,
    handleStop,
    stopping,
    savedReports,
    handleOpenReport,
    handleDeleteReport,
    refreshReports,
    browserOpen,
  } = useEditor();

  const [selected, setSelected] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    refreshReports();
  }, [refreshReports, reloadKey]);

  function toggle(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  const htmlReports = savedReports.filter((n) => n.endsWith(".html"));
  const jsonReports = savedReports.filter((n) => n.endsWith(".json"));
  const allSelected = selected.length === savedTests.length && savedTests.length > 0;

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="flex min-h-[70svh] flex-col rounded-xl border bg-card">
        <header className="px-5 pt-5 pb-4">
          <h2 className="text-base font-medium">{t("reports.runTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("reports.runDesc")}</p>
        </header>

        <div className="flex-1 space-y-3 px-5 pb-4">
          {browserOpen && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs">{t("reports.willClose")}</p>
          )}
          {savedTests.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              <p className="mx-auto max-w-md">{t("reports.noTests")}</p>
            </div>
          ) : (
            <>
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {savedTests.map((name) => (
                  <li key={name}>
                    <label
                      htmlFor={`sel-${name}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
                    >
                      <input
                        id={`sel-${name}`}
                        type="checkbox"
                        checked={selected.includes(name)}
                        onChange={() => toggle(name)}
                        className="size-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                {runningSet ? (
                  <>
                    <Button
                      variant={stopping ? "secondary" : "destructive"}
                      onClick={handleStop}
                      disabled={stopping}
                      className="gap-1.5"
                    >
                      {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                      {stopping ? t("topbar.stopping") : t("reports.stopSet")}
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
                  </>
                ) : (
                  <Button
                    onClick={() => runSet(selected)}
                    disabled={selected.length === 0}
                    className="gap-1.5"
                  >
                    <Play className="size-4" />
                    {selected.length === 1 ? t("reports.runOne") : t("reports.runMany", selected.length)}
                  </Button>
                )}
                {allSelected && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                    {t("reports.clearAll")}
                  </Button>
                )}
              </div>
              {setProgress && (
                <p className="text-xs text-muted-foreground">
                  {t("reports.setProgress", setProgress.index, setProgress.total, setProgress.current)}
                  {paused ? " · " + t("run.pause").toLowerCase() : ""}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-card px-5 pb-6 pt-5">
        <h2 className="text-base font-medium">{t("reports.savedTitle")}</h2>
        <div className="mt-4">
          {htmlReports.length === 0 && jsonReports.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("reports.savedEmpty")}</p>
          ) : (
            <div className="space-y-1">
              {htmlReports.map((name) => (
                <div key={name} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                  <span className="min-w-0 truncate font-mono text-xs">{name}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("reports.open")}
                      onClick={() => handleOpenReport(name)}
                      aria-label={`${t("reports.open")}: ${name}`}
                    >
                      <FolderOpen className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("reports.delete")}
                      onClick={() => handleDeleteReport(name)}
                      aria-label={`${t("reports.delete")}: ${name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {jsonReports.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {t("reports.jsonDetails", jsonReports.length)}
                  </summary>
                  <div className="mt-2 space-y-1">
                    {jsonReports.map((name) => (
                      <div key={name} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                          {name}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t("reports.delete")}
                          onClick={() => handleDeleteReport(name)}
                          aria-label={`${t("reports.delete")}: ${name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {t("reports.count", htmlReports.length + jsonReports.length)}
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setReloadKey((k) => k + 1)}>
              {t("reports.refresh")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}