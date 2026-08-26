import {
  CheckCircle2,
  Database,
  Loader2,
  Play,
  Square,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useEditor } from "@/editor/context";
import { ENV_DEFAULT } from "@/lib/vars";

/** Página Datos: dataset data-driven (una ejecución por fila del CSV). */
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Dataset · data-driven</CardTitle>
          <CardDescription>
            Ejecuta el test una vez por fila: cada columna es una variable y su celda sobrescribe el
            valor del entorno
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.currentTarget.value)}
            rows={5}
            placeholder={"usuario,plan\nalice@dev,free\nbob@dev,pro"}
            className="w-full resize-y rounded-lg border bg-muted p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={importCsv} disabled={!csvText.trim()} className="gap-1.5">
              <Database className="size-4" />
              Cargar CSV
            </Button>
            {dataset && (
              <span className="text-xs text-muted-foreground">
                {dataset.rows.length} filas · columnas: {dataset.columns.join(", ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {runningDataset || runningAll ? (
              <Button
                variant={stopping ? "secondary" : "destructive"}
                onClick={handleStop}
                disabled={stopping}
                className="gap-1.5"
              >
                {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
                {stopping ? "Deteniendo…" : "Detener"}
              </Button>
            ) : (
              <Button
                onClick={handleRunDataset}
                disabled={!dataset || dataset.rows.length === 0 || steps.length === 0}
                className="gap-1.5"
              >
                <Play className="size-4" />
                Ejecutar con dataset
              </Button>
            )}
            {activeEnv !== ENV_DEFAULT && (
              <span className="text-xs text-muted-foreground">entorno: {activeEnv}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reporte por fila</CardTitle>
          <CardDescription>
            Cada fila genera una corrida completa del test con las variables de esa fila
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!datasetReport ? (
            <p className="text-sm text-muted-foreground">
              Carga un CSV y pulsa “Ejecutar con dataset” para ver el resultado de cada fila aquí.
            </p>
          ) : (
            <div className="space-y-1">
              {datasetReport.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    r.ok ? "border-emerald-500/40" : "border-destructive/40"
                  }`}
                >
                  {r.ok ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="size-4 shrink-0 text-destructive" />
                  )}
                  <span className={r.ok ? "text-emerald-500" : "text-destructive"}>{r.label}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}