import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  listWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "@/api/client";
import type { Workspace } from "@/types";
import { useAuth } from "@/components/common/AuthContext";

interface WorkspaceContextType {
  workspaces: Workspace[];
  active: Workspace | null;
  loading: boolean;
  /** Troca o workspace ativo e recarrega o app (as telas são remontadas). */
  switchTo: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getActiveWorkspaceId());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    const list = await listWorkspaces().catch(() => [] as Workspace[]);
    setWorkspaces(list);
    // Escolhe o ativo: o salvo (se ainda existir) ou o primeiro.
    const saved = getActiveWorkspaceId();
    const chosen = list.find((w) => w.id === saved) ?? list[0] ?? null;
    if (chosen && chosen.id !== saved) setActiveWorkspaceId(chosen.id);
    setActiveId(chosen?.id ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) {
      setLoading(true);
      reload();
    } else {
      setWorkspaces([]);
      setLoading(false);
    }
  }, [user, reload]);

  const switchTo = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    // Recarrega tudo: cada tela busca os dados do workspace no mount, e é bem
    // mais simples (e à prova de estado preso) do que invalidar cada uma.
    window.location.assign("/");
  }, []);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  return (
    <Ctx.Provider value={{ workspaces, active, loading, switchTo, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace deve ser usado dentro de WorkspaceProvider");
  return ctx;
}
