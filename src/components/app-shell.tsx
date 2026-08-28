import { useEffect, useState } from "react";
import {
  Braces,
  Check,
  ChevronDown,
  CloudDownload,
  FileJson,
  FilePlus2,
  FileText,
  FolderOpen,
  Languages,
  ListChecks,
  Loader2,
  Moon,
  Play,
  Save,
  Settings2,
  Square,
  Sun,
  Table,
  Trash2,
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
import {
  Sidebar,
  SidebarContent,
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
import { useI18n } from "@/lib/i18n";
import { ENV_DEFAULT } from "@/lib/vars";
import { cn } from "@/lib/utils";

/** Navegación agrupada por actividad: construir el test y probarlo. */
const NAV_GROUPS: Array<{
  labelKey: string;
  items: Array<{ id: PageId; labelKey: string; icon: typeof ListChecks }>;
}> = [
  {
    labelKey: "nav.groupCreate",
    items: [
      { id: "editor", labelKey: "nav.editor", icon: ListChecks },
      { id: "variables", labelKey: "nav.variables", icon: Braces },
      { id: "data", labelKey: "nav.data", icon: Table },
    ],
  },
  {
    labelKey: "nav.groupRun",
    items: [
      { id: "run", labelKey: "nav.run", icon: Play },
      { id: "reports", labelKey: "nav.reports", icon: FileText },
    ],
  },
];

/** Navegación lateral: solo navegación, sin estados técnicos. */
export function AppSidebar() {
  const { page, setPage } = useEditor();
  const { collapsed } = useSidebar();
  const { t } = useI18n();

  return (
    <Sidebar>
      <SidebarHeader>
        {!collapsed && (
          <span className="px-1 text-[13px] font-semibold tracking-[0.22em] text-foreground">
            YATT
          </span>
        )}
      </SidebarHeader>
      <SidebarContent className="gap-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.labelKey} className="flex flex-col gap-1.5">
            {!collapsed && (
              <p className="px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                {t(group.labelKey)}
              </p>
            )}
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={page === item.id}
                    onClick={() => setPage(item.id)}
                    title={collapsed ? t(item.labelKey) : undefined}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </div>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

/** Interruptor de tema claro/oscuro (persistido, oscuro por defecto). */
function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("yatt-theme");
    return stored ? stored === "dark" : true;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("yatt-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <div className="flex items-center gap-1.5" title={t("topbar.darkMode")}>
      <Sun className="size-4 text-muted-foreground" />
      <Switch checked={dark} onCheckedChange={(c) => setDark(Boolean(c))} aria-label={t("topbar.darkMode")} />
      <Moon className="size-4 text-muted-foreground" />
    </div>
  );
}

/** Menú desplegable con las operaciones sobre tests guardados. */
function TestsMenu() {
  const { steps, newTest, handleSave, handleLoad, handleDelete, savedTests } = useEditor();
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
        <FolderOpen className="size-4" />
        {t("topbar.tests")}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={newTest}>
          <FilePlus2 className="size-4" /> {t("topbar.newTest")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSave} disabled={steps.length === 0}>
          <Save className="size-4" /> {t("topbar.saveTest")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {savedTests.length === 0 ? (
          <DropdownMenuLabel>{t("topbar.noTests")}</DropdownMenuLabel>
        ) : (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderOpen className="size-4" /> {t("topbar.loadTests")}
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
                <Trash2 className="size-4" /> {t("topbar.deleteTests")}
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

/** Menú "⋯": idioma (RNF-06) y comprobación de actualizaciones. */
function SettingsMenu() {
  const { t, lang, setLang } = useI18n();
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  async function handleCheckUpdates() {
    setChecking(true);
    setUpdateMsg(null);
    try {
      // El plugin de updater requiere un servidor firmado (YATT_UPDATE_URL).
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setUpdateMsg(t("topbar.updateNone"));
      } else {
        await update.downloadAndInstall();
        setUpdateMsg(t("topbar.updateNone"));
      }
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      setUpdateMsg(/endpoint/i.test(msg) ? t("topbar.updateNoneCfg") : t("topbar.updateError") + msg.split("\n")[0]);
    } finally {
      setChecking(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={t("topbar.settings")} className="shrink-0" />}
      >
        <Settings2 className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <Languages className="size-4" /> {t("topbar.language")}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setLang("es")} className="justify-between">
          {t("topbar.langEs")}
          {lang === "es" && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLang("en")} className="justify-between">
          English
          {lang === "en" && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCheckUpdates} disabled={checking} className="gap-2">
          {checking ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
          {checking ? t("topbar.updateChecking") : t("topbar.updates")}
        </DropdownMenuItem>
        {updateMsg && (
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            {updateMsg}
          </DropdownMenuLabel>
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
  const { t } = useI18n();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip content={t("topbar.nameTooltip")}>
          <Input
            value={testName}
            onChange={(e) => setTestName(e.currentTarget.value)}
            placeholder={t("topbar.testPlaceholder")}
            className="h-8 w-40 font-mono text-xs"
          />
        </Tooltip>
        <Button size="sm" onClick={handleSave} disabled={steps.length === 0} className="gap-1.5">
          <Save className="size-3.5" /> {t("topbar.save")}
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <TestsMenu />
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")} />
            {connected ? `${t("topbar.sidecar")} ${t("state.connected")}` : t("topbar.sidecarDown")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", browserOpen ? "bg-emerald-500" : "bg-zinc-400")} />
            {browserOpen ? t("state.browserOpen") : t("state.browserClosed")}
          </span>
        </span>
        {runningAll ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            disabled={stopping}
            className="gap-1.5"
            title={t("topbar.stopTitle")}
          >
            {stopping ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3.5" />
            )}
            {stopping ? t("topbar.stopping") : t("topbar.stop")}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={runAll}
            disabled={steps.length === 0 || !connected}
            className="gap-1.5"
            title={t("topbar.runAllTitle")}
          >
            <Play className="size-3.5" />
            {t("topbar.runAll")}
            {activeEnv !== ENV_DEFAULT ? ` · ${activeEnv}` : ""}
          </Button>
        )}
        <SettingsMenu />
      </div>
    </header>
  );
}