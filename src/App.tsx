import { AlertCircle, X } from "lucide-react";

import { AppSidebar, TopBar } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { EditorProvider, useEditor } from "@/editor/context";
import { DatasetPage } from "@/pages/data";
import { EditorPage } from "@/pages/editor";
import { ReportsPage } from "@/pages/reports";
import { RunPage } from "@/pages/run";
import { VariablesPage } from "@/pages/variables";

/** Cuerpo de la app: sidebar + topbar + página activa. */
function Shell() {
  const { page, appError, setAppError } = useEditor();

  return (
    <div className="flex min-h-svh bg-background text-foreground antialiased">
      <SidebarProvider>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {appError && (
            <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
              <span className="flex min-w-0 items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span className="truncate">{appError}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => setAppError(null)}
                aria-label="Cerrar mensaje de error"
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
          <main className="flex-1 overflow-y-auto p-6">
            {page === "editor" && <EditorPage />}
            {page === "variables" && <VariablesPage />}
            {page === "data" && <DatasetPage />}
            {page === "run" && <RunPage />}
            {page === "reports" && <ReportsPage />}
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}