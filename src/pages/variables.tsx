import { Plus, Trash2, Variable, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditor } from "@/editor/context";
import { ENV_DEFAULT, VAR_TYPES, validateVarValue, type VarType } from "@/lib/vars";

/** Página Variables: entornos, variables y sobrescrituras de corrida. */
export function VariablesPage() {
  const {
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
    addVariable,
    addEnv,
    removeVariable,
    renameVariable,
    setVarType,
    setVarOptions,
    setVarValue,
  } = useEditor();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Variables y entornos</CardTitle>
          <CardDescription>
            Se interpolan en los pasos con {"{{nombre}}"} · valores por entorno, sobrescritos por
            corrida o por dataset
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Entorno activo + creación de entornos */}
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium">Entorno activo para la ejecución</p>
            <div className="flex items-center gap-2">
              <div className="w-36 shrink-0">
                <Select value={activeEnv} onValueChange={(v) => setActiveEnv(String(v))}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={ENV_DEFAULT}>default</SelectItem>
                    {envs.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <Input
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && addEnv()}
                placeholder="nuevo entorno (p. ej. staging)"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                title="Añadir entorno"
                onClick={addEnv}
                aria-label="Añadir entorno"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {/* Lista de variables */}
          {variables.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              <Variable className="size-8 text-muted-foreground/60" />
              <p className="max-w-md">
                Sin variables todavía. Crea una (p. ej. <code className="font-mono">usuario</code>) y
                úsala en cualquier paso con <code className="font-mono">{"{{usuario}}"}</code>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {variables.map((v) => {
                const err = validateVarValue(v, v.values[activeEnv] ?? "");
                return (
                  <div key={v.name} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={v.name}
                        onChange={(e) => renameVariable(v.name, e.currentTarget.value)}
                        className="h-8 flex-1 font-mono text-xs"
                      />
                      <div className="w-32 shrink-0">
                        <Select value={v.type} onValueChange={(t) => setVarType(v.name, t as VarType)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            {VAR_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Eliminar variable"
                        onClick={() => removeVariable(v.name)}
                        aria-label={`Eliminar variable ${v.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {v.type === "option" && (
                      <Input
                        value={v.options?.join(", ") ?? ""}
                        onChange={(e) => setVarOptions(v.name, e.currentTarget.value)}
                        placeholder="opciones separadas por coma: free, pro, team"
                        className="mt-2 h-7 text-[11px]"
                      />
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        valor · {activeEnv}
                      </span>
                      <Input
                        value={v.values[activeEnv] ?? ""}
                        onChange={(e) => setVarValue(v.name, activeEnv, e.currentTarget.value)}
                        placeholder="valor"
                        className="h-7 flex-1 font-mono text-[11px]"
                      />
                    </div>
                    {err && <p className="mt-1.5 text-[11px] text-amber-500">{err}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Nueva variable */}
          <div className="flex items-center gap-2">
            <Input
              value={newVarName}
              onChange={(e) => setNewVarName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addVariable()}
              placeholder="nueva variable (p. ej. usuario)"
              className="h-8 flex-1 font-mono text-xs"
            />
            <Button onClick={addVariable} disabled={!newVarName.trim()} className="gap-1.5">
              <Plus className="size-4" /> Añadir variable
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sobrescrituras de esta corrida</CardTitle>
          <CardDescription>
            Un valor aquí gana al del entorno solo en la próxima ejecución · vacío = sin sobrescritura
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {variables.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin variables: crea una arriba para poder sobrescribirla.
            </p>
          ) : (
            variables.map((v) => (
              <div key={v.name} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {v.name}
                </span>
                {v.type === "option" && v.options?.length ? (
                  <div className="h-7 flex-1 overflow-hidden">
                    <Select
                      value={overrides[v.name]}
                      onValueChange={(o) =>
                        setOverrides((prev) => ({
                          ...prev,
                          [v.name]: String(o) === "__def__" ? "" : String(o),
                        }))
                      }
                    >
                      <SelectTrigger className="h-7 text-[11px]">
                        <SelectValue>(valor del entorno)</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="__def__">(valor del entorno)</SelectItem>
                        {v.options.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                ) : (
                  <Input
                    value={overrides[v.name] ?? ""}
                    onChange={(e) =>
                      setOverrides((prev) => ({ ...prev, [v.name]: e.currentTarget.value }))
                    }
                    placeholder="(valor del entorno)"
                    className="h-7 flex-1 text-[11px]"
                  />
                )}
                {overrides[v.name] !== undefined && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Quitar sobrescritura"
                    onClick={() =>
                      setOverrides((prev) => {
                        const next = { ...prev };
                        delete next[v.name];
                        return next;
                      })
                    }
                    aria-label={`Quitar sobrescritura de ${v.name}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            ))
          )}
          {Object.keys(overrides).length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setOverrides({})}
            >
              Limpiar todas
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}