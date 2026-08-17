import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
  getStoredSession,
  saveSession,
  clearSession,
  type AuthSession,
  type AuthUser,
} from "@/api/client";

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaura a sessão salva (se houver) no primeiro carregamento.
  useEffect(() => {
    const session = getStoredSession();
    if (session?.user) setUser(session.user);
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const session: AuthSession = await apiLogin(email, password);
    saveSession(session);
    setUser(session.user);
  };

  const signup = async (email: string, password: string, fullName = "") => {
    const session: AuthSession = await apiSignup(email, password, fullName);
    saveSession(session);
    setUser(session.user);
  };

  const logout = async () => {
    await apiLogout().catch(() => undefined);
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
