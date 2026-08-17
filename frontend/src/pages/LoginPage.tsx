import { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { LogIn, UserPlus, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "@/components/common/AuthContext";
import { Button } from "@/components/common/Button";
import { Input, Label } from "@/components/common/Input";
import { cn } from "@/lib/cn";

export function LoginPage() {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Já logado? vai para a página de origem (ou dashboard).
  if (user) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup(email, password, fullName);
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-muted-foreground">FUNNEL</span>
            <span className="text-primary">TRON</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Análise de funis em tempo real
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-lg p-6">
          <div className="flex mb-6 rounded-lg bg-muted/50 p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "login" ? <LogIn size={15} /> : <UserPlus size={15} />}
                {m === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <Label>Nome completo</Label>
                <Input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome"
                  className="mt-1"
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                className="mt-1"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <Label>Senha</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-danger bg-danger/10 border border-danger/30 p-3 rounded-md">
                <AlertCircle size={16} className="shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : mode === "login" ? (
                <LogIn size={16} />
              ) : (
                <UserPlus size={16} />
              )}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          {import.meta.env.VITE_USE_MOCK !== "false" && (
            <p className="text-[11px] text-muted-foreground mt-4 text-center">
              Modo demonstração: qualquer email e senha válidos entram.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
