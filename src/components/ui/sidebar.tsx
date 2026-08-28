import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
}

const SidebarContext = React.createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useSidebar() {
  return React.useContext(SidebarContext);
}

function SidebarProvider({
  children,
  defaultCollapsed = false,
}: {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const value = React.useMemo(() => ({ collapsed, setCollapsed }), [collapsed]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
  const { collapsed } = useSidebar();
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        "sticky top-0 flex h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-56",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex h-14 shrink-0 items-center gap-2.5 px-3", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex flex-1 flex-col overflow-y-auto p-2", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("group/item", className)}
      {...props}
    />
  );
}

function SidebarMenuButton({
  className,
  isActive,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean }) {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive || undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SidebarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { collapsed, setCollapsed } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      data-slot="sidebar-trigger"
      title={collapsed ? "Expandir menú" : "Contraer menú"}
      onClick={() => setCollapsed(!collapsed)}
      className={className}
      {...props}
    >
      {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
    </Button>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
};