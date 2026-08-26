import { useEffect, useState } from "react";
import {
  ChevronDown,
  ClipboardList,
  Database,
  FileJson,
  FilePlus2,
  FolderOpen,
  Globe,
  ListChecks,
  Loader2,
  Moon,
  Play,
  Save,
  Server,
  Square,
  Sun,
  Trash2,
  Variable,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { useEditor, type PageId } from "@/editor/context";
import { ENV_DEFAULT } from "@/lib/vars";
import { cn } from "@/lib/utils";

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof ListChecks }> = [
  { id: "editor", label: "Editor", icon: ListChecks },
  { id: "variables", label: "Variables", icon: Variable },
  { id: "data", label: "Datos", icon: Database },
  { id: "run", label: "Ejecución", icon: Play },
  { id: "reports", label: "Reportes", icon: ClipboardList },
];

/** Navegación lateral con el estado del sidecar y del navegador. */
export function AppSidebar() {
  const { page, setPage, connected, browserOpen } = useEditor();
  const { collapsed } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          Y
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm leading-tight font-semibold">YATT</p>
            <p className="truncate text-[11px] text-muted-foreground">testing visual · fase 2</p>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={page === item.id}
                  onClick={() => setPage(item.id)}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="size-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div
          className={cn(
            "flex flex-col gap-1.5 text-[11px] text-sidebar-foreground/80",
            collapsed && "items-center",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")} />
            {!collapsed && <span>sidecar {connected ? "conectado" : "caído"}</span>}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-full", browserOpen ? "bg-emerald-500" : "bg-zinc-500")} />
            {!collapsed && <span>Chromium {browserOpen ? "abierto" : "cerrado"}</span>}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Interruptor de tema claro/oscuro (persistido, oscuro por defecto). */
function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("yatt-theme");
    return stored ? stored === "dark" : true;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("yatt-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <div className="flex items-center gap-1.5" title="Modo oscuro">
      <Sun className="size-4 text-muted-foreground" />
      <Switch checked={dark} onCheckedChange={(c) => setDark(Boolean(c))} aria-label="Modo oscuro" />
      <Moon className="size-4 text-muted-foreground" />
    </div>
  );
}

/** Menú desplegable con las operaciones sobre tests guardados. */
function TestsMenu() {
  const { steps, newTest, handleSave, handleLoad, handleDelete, savedTests } = useEditor();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
        <FolderOpen className="size-4" />
        Tests
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={newTest}>
          <FilePlus2 className="size-4" /> Nuevo test
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSave} disabled={steps.length === 0}>
          <Save className="size-4" /> Guardar test
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {savedTests.length === 0 ? (
          <DropdownMenuLabel>No hay tests guardados todavía</DropdownMenuLabel>
        ) : (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderOpen className="size-4" /> Cargar…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {savedTests.map((name) => (
                  <DropdownMenuItem key={name} onClick={() => handleLoad(name)}>
                    <FileJson className="size-4 text-muted-foreground" />
                    <span className="min-w-0 truncate font-mono">{name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trash2 className="size-4" /> Eliminar…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {savedTests.map((name) => (
                  <DropdownMenuItem
                    key={name}
                    onClick={() => handleDelete(name)}
                    className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    <span className="min-w-0 truncate font-mono">{name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Barra superior: nombre del test, tema, tests guardados, estado y correr todo. */
export function TopBar() {
  const {
    testName,
    setTestName,
    handleSave,
    steps,
    connected,
    browserOpen,
    runningAll,
    stopping,
    handleStop,
    runAll,
    activeEnv,
  } = useEditor();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip content="Nombre del test (se guarda en tests/)">
          <Input
            value={testName}
            onChange={(e) => setTestName(e.currentTarget.value)}
            placeholder="mi-test"
            className="h-8 w-40 font-mono text-xs"
          />
        </Tooltip>
        <Button size="sm" onClick={handleSave} disabled={steps.length === 0} className="gap-1.5">
          <Save className="size-3.5" /> Guardar
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <TestsMenu />
        <Badge variant="outline" className="gap-1.5">
          <Server className={cn("size-3.5", connected ? "text-emerald-500" : "text-red-500")} />
          {connected ? "sidecar" : "sidecar caído"}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <Globe className={cn("size-3.5", browserOpen ? "text-emerald-500" : "text-zinc-400")} />
          {browserOpen ? "Chromium" : "cerrado"}
        </Badge>
        {runningAll ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            disabled={stopping}
            className="gap-1.5"
            title="Detener la ejecución (Esc)"
          >
            {stopping ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3.5" />
            )}
            {stopping ? "Deteniendo…" : "Detener"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={runAll}
            disabled={steps.length === 0 || !connected}
            className="gap-1.5"
            title="Ejecutar todos los pasos en orden"
          >
            <Play className="size-3.5" />
            Ejecutar todos{activeEnv !== ENV_DEFAULT ? ` · ${activeEnv}` : ""}
          </Button>
        )}
      </div>
    </header>
  );
}