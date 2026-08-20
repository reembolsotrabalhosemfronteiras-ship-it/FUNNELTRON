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

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { open: openNewFunnel } = useNewFunnel();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="w-64 border-r border-border bg-card h-screen flex flex-col">
      <div className="p-4 border-b border-border">
        {/* Não é h1: a página já tem o seu próprio (o título no Header) —
            dois h1 na mesma tela quebra a hierarquia de heading que leitor
            de tela e SEO dependem pra entender do que a página trata. */}
        <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="text-primary">📊</span>
          <span>
            FUNNEL<span className="text-primary">TRON</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border space-y-2">
        {user?.email && (
          <p className="px-1 text-[11px] text-muted-foreground truncate" title={user.email}>
            {user.email}
          </p>
        )}
        <button
          onClick={openNewFunnel}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          <Plus size={16} />
          Novo funil
        </button>
        <button
          onClick={handleLogout}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </aside>
  );
}