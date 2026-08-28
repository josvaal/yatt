import { useState } from "react";
import { Loader2, Play, Square, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ENV_DEFAULT } from "@/lib/vars";

/** Página Datos: una tabla cuyas filas ejecutan el test completo, una corrida por fila. */
export function DatasetPage() {
  const {
    csvText,
    setCsvText,
    importCsv,
    dataset,
    handleRunDataset,
    runningDataset,
    datasetReport,
    runningAll,
    handleStop,
    stopping,
    activeEnv,
    steps,
  } = useEditor();
  const { t } = useI18n();
  const [importFailed, setImportFailed] = useState(false);

  function onImport() {
    if (importCsv()) setImportFailed(false);
    else setImportFailed(true);
  }

  const canImport = csvText.trim().length > 0;
  const canRun = !!dataset && dataset.rows.length > 0 && steps.length > 0;
  const busy = runningDataset || runningAll;

  return (
    <div className="mx-auto max-w-3xl">
      <section className="rounded-xl border bg-card px-5 pb-6 pt-5">
        <h2 className="text-base font-medium">{t("data.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("data.desc")}</p>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="yatt-csv" className="sr-only">
              {t("data.tableLabel")}
            </label>
            <textarea
              id="yatt-csv"
              value={csvText}
              onChange={(e) => {
                setCsvText(e.currentTarget.value);
                if (importFailed) setImportFailed(false);
              }}
              rows={5}
              placeholder={"usuario,plan\nalice@dev,free\nbob@dev,pro"}
              className="w-full resize-y rounded-lg border bg-muted p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t("data.formatHint")}</p>
          </div>

          {importFailed && <p className="text-xs text-destructive">{t("data.importError")}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onImport} disabled={!canImport} className="gap-1.5">
              <Table2 className="size-4" />
              {t("data.importButton")}
            </Button>
            {dataset && (
              <span className="text-xs text-muted-foreground">
                {t("data.stats", dataset.rows.length, dataset.columns.length)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <Button
                variant={stopping ? "secondary" : "destructive"}
                onClick={handleStop}
                disabled={stopping}
                className="gap-1.5"
              >
                {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                {stopping ? t("run.stopping") : t("run.stop")}
              </Button>
            ) : (
              <Button onClick={handleRunDataset} disabled={!canRun} className="gap-1.5">
                <Play className="size-4" />
                {t("data.run")}
              </Button>
            )}
            {activeEnv !== ENV_DEFAULT && (
              <span className="text-xs text-muted-foreground">{t("data.env", activeEnv)}</span>
            )}
            {steps.length === 0 && (
              <span className="text-xs text-muted-foreground">{t("data.noSteps")}</span>
            )}
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-medium">{t("data.reportTitle")}</h3>
            <div className="mt-3">
              {!datasetReport ? (
                <p className="text-xs text-muted-foreground">{t("data.reportEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {datasetReport.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          r.ok ? "bg-emerald-500" : "bg-red-500",
                        )}
                      />
                      <span>{t("data.rowResult", r.row, r.passed, r.total)}</span>
                      {r.stopped && (
                        <span className="text-muted-foreground">{t("data.rowStopped")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}