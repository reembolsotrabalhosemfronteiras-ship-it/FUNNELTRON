import { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { SignIn, UserPlus, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "@/components/common/AuthContext";
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
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup(email, password, fullName, inviteCode);
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-7">
          <h1 className="text-3xl font-semibold tracking-tight">
            <span className="text-neutral-300">FUNNEL</span>
            <span className="text-primary">TRON</span>
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Análise de funis em tempo real
          </p>
        </div>

        <div className="card elev-md !p-6">
          <div className="seg w-full mb-[18px]">
            {(["login", "signup"] as const).map((m) => (
              <label
                key={m}
                className="seg-opt flex-1 justify-center"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
              >
                <input type="radio" name="loginmode" readOnly checked={mode === m} />
                {m === "login" ? <SignIn size={15} /> : <UserPlus size={15} />}
                {m === "login" ? "Entrar" : "Criar conta"}
              </label>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            {mode === "signup" && (
              <div className="field">
                <Label>Nome completo</Label>
                <input
                  className="input"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome"
                  autoComplete="name"
                />
              </div>
            )}

            <div className="field">
              <Label>Email</Label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="field">
              <Label>Senha</Label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </div>

            {mode === "signup" && (
              <div className="field">
                <Label>Código de acesso</Label>
                <input
                  className="input"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Código fornecido para você"
                  autoComplete="off"
                  required
                />
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-danger bg-danger/10 border border-danger/30 p-3 rounded-md">
                <WarningCircle size={16} className="shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? (
                <CircleNotch size={16} className={cn("animate-spin")} />
              ) : mode === "login" ? (
                <SignIn size={16} />
              ) : (
                <UserPlus size={16} />
              )}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          {import.meta.env.VITE_USE_MOCK !== "false" && (
            <p className="text-[11px] text-muted-foreground mt-3.5 text-center">
              Modo demonstração: qualquer email e senha válidos entram.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
