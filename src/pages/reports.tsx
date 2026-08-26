import { useEffect, useState } from "react";
import {
  ClipboardList,
  FileJson,
  FolderOpen,
  Layers,
  Loader2,
  Pause,
  Play,
  Square,
  Trash2,
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
import { useEditor } from "@/editor/context";
import { cn } from "@/lib/utils";

/** Página Reportes: correr un set de tests en headless y revisar reportes guardados. */
export function ReportsPage() {
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Correr un set · headless</CardTitle>
          <CardDescription>
            Ejecuta varios tests guardados en una sola pasada (RF-15) y genera un reporte por set
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {browserOpen && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
              El navegador abierto se cerrará limpiamente antes de correr el set (headless propio).
            </p>
          )}
          {savedTests.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              <Layers className="size-8 text-muted-foreground/60" />
              <p className="max-w-md">No hay tests guardados. Guarda un test para poder correrlo en un set.</p>
            </div>
          ) : (
            <>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {savedTests.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <input
                      id={`sel-${name}`}
                      type="checkbox"
                      checked={selected.includes(name)}
                      onChange={() => toggle(name)}
                      className="size-4 accent-primary"
                    />
                    <label htmlFor={`sel-${name}`} className="min-w-0 flex-1 cursor-pointer truncate font-mono text-xs">
                      {name}
                    </label>
                  </div>
                ))}
              </div>
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
                      {stopping ? "Deteniendo…" : "Detener set"}
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
                  </>
                ) : (
                  <Button
                    onClick={() => runSet(selected)}
                    disabled={selected.length === 0}
                    className="gap-1.5"
                  >
                    <Play className="size-4" />
                    Correr set ({selected.length})
                  </Button>
                )}
                {selected.length === savedTests.length && savedTests.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                    Quitar todos
                  </Button>
                )}
              </div>
              {setProgress && (
                <p className="text-xs text-muted-foreground">
                  Test {setProgress.index} de {setProgress.total}: <span className="font-mono">{setProgress.current}</span>
                  {paused ? " · pausado" : ""}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reportes guardados</CardTitle>
          <CardDescription>Archivos en la carpeta reports/ del proyecto (HTML y JSON)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {htmlReports.length === 0 && jsonReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay reportes. Corre el test y pulsa “Guardar reporte”, o corre un set aquí.
            </p>
          ) : (
            <>
              {htmlReports.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 truncate font-mono text-xs">
                    <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Abrir en el navegador"
                      onClick={() => handleOpenReport(name)}
                      aria-label={`Abrir ${name}`}
                    >
                      <FolderOpen className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Eliminar"
                      onClick={() => handleDeleteReport(name)}
                      aria-label={`Eliminar ${name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {jsonReports.length > 0 && (
                <details className={cn("rounded-md border px-3 py-2", htmlReports.length > 0 && "mt-1")}>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    JSON ({jsonReports.length}) — <FileJson className="inline size-3.5" /> datos crudos para otras herramientas
                  </summary>
                  <div className="mt-2 space-y-1">
                    {jsonReports.map((name) => (
                      <div key={name} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{name}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Eliminar"
                          onClick={() => handleDeleteReport(name)}
                          aria-label={`Eliminar ${name}`}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="secondary" className="gap-1.5">
              <FileJson className="size-3.5" />
              {htmlReports.length + jsonReports.length} archivos
            </Badge>
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setReloadKey((k) => k + 1)}>
              Refrescar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}