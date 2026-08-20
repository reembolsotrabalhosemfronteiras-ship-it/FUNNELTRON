import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  GitBranch,
  BarChart3,
  Upload,
  Settings,
  Plus,
  Zap,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useNewFunnel } from "@/components/funnel/NewFunnelProvider";
import { useAuth } from "@/components/common/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/funnels", label: "Funis", icon: GitBranch },
  { to: "/metrics", label: "Métricas", icon: BarChart3 },
  { to: "/live", label: "Ao Vivo", icon: Zap },
  { to: "/imports", label: "Importações", icon: Upload },
  { to: "/settings", label: "Configurações", icon: Settings },
] as const;

const COLLAPSE_KEY = "funil-analytics:sidebar-collapsed";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { open: openNewFunnel } = useNewFunnel();
  // Lembrado entre sessões: quem trabalha com o conteúdo central grande
  // (o Ateliê, telas de configuração) não quer reabrir a barra toda vez
  // que recarrega a página.
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
        collapsed ? "w-16" : "w-64"
      )}
    >
      <button
        onClick={toggleCollapsed}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      >
        {collapsed ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
      </button>

      <div className="p-4 border-b border-border overflow-hidden">
        {/* Não é h1: a página já tem o seu próprio (o título no Header) —
            dois h1 na mesma tela quebra a hierarquia de heading que leitor
            de tela e SEO dependem pra entender do que a página trata. */}
        <div
          className={cn(
            "flex items-center gap-2 text-lg font-bold tracking-tight",
            collapsed && "justify-center"
          )}
        >
          <span className="text-primary shrink-0">📊</span>
          {!collapsed && (
            <span className="whitespace-nowrap">
              FUNNEL<span className="text-primary">TRON</span>
            </span>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
          return (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <Icon size={18} aria-hidden="true" className="shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border space-y-2">
        {!collapsed && user?.email && (
          <p className="px-1 text-[11px] text-muted-foreground truncate" title={user.email}>
            {user.email}
          </p>
        )}
        <button
          onClick={openNewFunnel}
          title={collapsed ? "Novo funil" : undefined}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          <Plus size={16} className="shrink-0" />
          {!collapsed && "Novo funil"}
        </button>
        <button
          onClick={handleLogout}
          title={collapsed ? "Sair" : undefined}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && "Sair"}
        </button>
      </div>
    </aside>
  );
}