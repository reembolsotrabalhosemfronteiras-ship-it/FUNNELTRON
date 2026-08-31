import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  SquaresFour,
  FlowArrow,
  Eye,
  ChartBar,
  Broadcast,
  UploadSimple,
  Gear,
  Plus,
  SignOut,
  CaretDoubleLeft,
  CaretDoubleRight,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useNewFunnel } from "@/components/funnel/NewFunnelProvider";
import { useAuth } from "@/components/common/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard", icon: SquaresFour },
  { to: "/funnels", label: "Funis", icon: FlowArrow },
  { to: "/overview", label: "Visão dos funis", icon: Eye },
  { to: "/metrics", label: "Métricas", icon: ChartBar },
  { to: "/live", label: "Ao Vivo", icon: Broadcast },
  { to: "/imports", label: "Importações", icon: UploadSimple },
  { to: "/settings", label: "Configurações", icon: Gear },
] as const;

const COLLAPSE_KEY = "funil-analytics:sidebar-collapsed";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { open: openNewFunnel } = useNewFunnel();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1"
  );

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside
      className={cn(
        "relative border-r border-border bg-card h-screen flex flex-col shrink-0 transition-[width] duration-200",
        collapsed ? "w-16" : "w-[230px]"
      )}
    >
      <button
        onClick={toggleCollapsed}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      >
        {collapsed ? <CaretDoubleRight size={13} /> : <CaretDoubleLeft size={13} />}
      </button>

      <div className="px-4 py-[18px] border-b border-border overflow-hidden">
        <div
          className={cn(
            "flex items-center gap-2 text-base font-semibold tracking-tight",
            collapsed && "justify-center"
          )}
        >
          {collapsed ? (
            <span className="text-primary shrink-0">F</span>
          ) : (
            <span className="whitespace-nowrap">
              <span className="text-neutral-300">FUNNEL</span>
              <span className="text-primary">TRON</span>
            </span>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            location.pathname === to ||
            (to !== "/" && location.pathname.startsWith(to));
          return (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-[12.5px] transition-colors whitespace-nowrap",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <Icon size={16} aria-hidden="true" className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border flex flex-col gap-1.5">
        {!collapsed && user?.email && (
          <p
            className="px-1 text-[11px] text-muted-foreground truncate"
            title={user.email}
          >
            {user.email}
          </p>
        )}
        <button
          onClick={openNewFunnel}
          title={collapsed ? "Novo funil" : undefined}
          className="btn btn-secondary btn-block"
        >
          <Plus size={15} className="shrink-0" />
          {!collapsed && "Novo funil"}
        </button>
        <button
          onClick={handleLogout}
          title={collapsed ? "Sair" : undefined}
          className={cn("btn btn-ghost", collapsed ? "justify-center" : "justify-start")}
        >
          <SignOut size={15} className="shrink-0" />
          {!collapsed && "Sair"}
        </button>
      </div>
    </aside>
  );
}
