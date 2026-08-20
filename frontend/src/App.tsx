import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./components/common/Sidebar";
import { NewFunnelProvider } from "./components/funnel/NewFunnelProvider";
import { ThemeProvider } from "./components/common/Header";
import { AuthProvider, useAuth } from "./components/common/AuthContext";
import { NotificationsProvider } from "./components/common/NotificationsProvider";
import { DashboardPage } from "./pages/DashboardPage";
import { FunnelListPage } from "./pages/FunnelListPage";
import { FunnelViewPage } from "./pages/FunnelViewPage";
import { FunnelEditorPage } from "./pages/FunnelEditorPage";
import { MetricsPage } from "./pages/MetricsPage";
import { ImportsPage } from "./pages/ImportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LivePage } from "./pages/LivePage";
import { LoginPage } from "./pages/LoginPage";
import { Spinner } from "./components/common/Spinner";

/** Layout normal do app: sidebar fixa + conteúdo rolável. */
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // O provider envolve a sidebar também: o botão "Novo funil" de lá abre o
    // mesmo popup que o da página de Funis.
    <NewFunnelProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </NewFunnelProvider>
  );
}

/** Protege uma rota: redireciona para /login se não estiver logado. */
function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-canvas text-muted-foreground">
        <Spinner size={28} />
        <span className="text-sm">Carregando…</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <NotificationsProvider>
          <Routes>
            {/* Login é público. Se já estiver logado, vai para o app. */}
            <Route path="/login" element={<LoginPage />} />

            {/* O ateliê ocupa a tela inteira — sem sidebar, sem scroll. */}
            <Route
              path="/funnel/:id/edit"
              element={
                <Protected>
                  <FunnelEditorPage />
                </Protected>
              }
            />

            <Route
              path="*"
              element={
                <Protected>
                  <AppShell>
                    <Routes>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/funnels" element={<FunnelListPage />} />
                      <Route path="/funnel/:id" element={<FunnelViewPage />} />
                      <Route path="/funnel/:id/live" element={<LivePage />} />
                      <Route path="/live" element={<LivePage />} />
                      <Route path="/metrics" element={<MetricsPage />} />
                      <Route path="/funnel/:id/metrics" element={<MetricsPage />} />
                      <Route path="/imports" element={<ImportsPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                  </AppShell>
                </Protected>
              }
            />
          </Routes>
        </NotificationsProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
