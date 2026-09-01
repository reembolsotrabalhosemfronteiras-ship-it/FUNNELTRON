import { useEffect, useState } from "react";
import {
  Users,
  PencilSimple,
  Trash,
  UserPlus,
  CircleNotch,
  Crown,
  Clock,
} from "@phosphor-icons/react";
import { Header } from "@/components/common/Header";
import { Spinner } from "@/components/common/Spinner";
import { useWorkspace } from "@/components/common/WorkspaceContext";
import {
  listWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  renameWorkspace,
  deleteWorkspace,
} from "@/api/client";
import type { WorkspaceMember } from "@/types";

export function WorkspacePage() {
  const { active, reload, switchTo, workspaces } = useWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [myRole, setMyRole] = useState<"owner" | "member">("member");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setName(active.name);
    setLoading(true);
    listWorkspaceMembers(active.id)
      .then((r) => {
        setMembers(r.members);
        setMyRole(r.role);
      })
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [active]);

  if (!active) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Workspace" subtitle="Conta e membros" />
        <div className="flex h-64 items-center justify-center">
          <Spinner size={28} />
        </div>
      </div>
    );
  }

  const isOwner = myRole === "owner";

  const saveName = async () => {
    if (name.trim() === active.name || !name.trim()) return;
    setBusy(true);
    try {
      await renameWorkspace(active.id, name.trim());
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const doInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!invite.trim()) return;
    setBusy(true);
    try {
      const r = await addWorkspaceMember(active.id, invite.trim());
      setMembers((m) => [
        ...m,
        { userId: null, email: r.email, role: "member", pending: r.pending },
      ]);
      setInvite("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível convidar.");
    } finally {
      setBusy(false);
    }
  };

  const kick = async (m: WorkspaceMember) => {
    if (!m.userId) return;
    setBusy(true);
    try {
      await removeWorkspaceMember(active.id, m.userId);
      setMembers((list) => list.filter((x) => x.userId !== m.userId));
    } finally {
      setBusy(false);
    }
  };

  const leaveOrDelete = async () => {
    if (isOwner) {
      if (workspaces.length <= 1) {
        setError("Este é seu único workspace — crie outro antes de apagar.");
        return;
      }
      if (!window.confirm(`Apagar "${active.name}"? Os funis dele vão junto. Sem volta.`)) return;
    }
    setBusy(true);
    try {
      await deleteWorkspace(active.id);
      const other = workspaces.find((w) => w.id !== active.id);
      if (other) switchTo(other.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falhou.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header title="Workspace" subtitle="Conta e membros — funis isolados por workspace" />

      <main className="flex flex-col gap-[18px] p-4 md:px-7 md:py-6 max-w-[720px]">
        {/* Nome */}
        <div className="card elev-sm !p-[18px]">
          <p className="card-title mb-0.5 flex items-center gap-2">
            <Users size={18} className="text-primary" />
            {active.name}
          </p>
          <p className="card-body mb-3.5">
            Você é {isOwner ? "dono" : "membro"} · {active.memberCount}{" "}
            {active.memberCount === 1 ? "pessoa" : "pessoas"}
          </p>
          {isOwner && (
            <div className="flex gap-2">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do workspace"
              />
              <button className="btn btn-secondary shrink-0" onClick={saveName} disabled={busy}>
                <PencilSimple size={14} />
                Salvar
              </button>
            </div>
          )}
        </div>

        {/* Membros */}
        <div className="card elev-sm !p-[18px]">
          <p className="card-title mb-3">Membros</p>
          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner size={22} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {members.map((m) => (
                <div
                  key={m.userId ?? m.email}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {m.role === "owner" ? (
                      <Crown size={15} style={{ color: "var(--c-mid)" }} />
                    ) : m.pending ? (
                      <Clock size={15} className="text-muted-foreground" />
                    ) : (
                      <Users size={15} className="text-muted-foreground" />
                    )}
                    <span className="truncate text-[13px]">{m.email ?? "—"}</span>
                    {m.pending && (
                      <span className="tag tag-outline shrink-0">convite pendente</span>
                    )}
                  </div>
                  {isOwner && m.role !== "owner" && m.userId && (
                    <button
                      onClick={() => kick(m)}
                      disabled={busy}
                      title="Remover"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <form onSubmit={doInvite} className="mt-3 flex gap-2">
              <input
                className="input"
                type="email"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="email@pessoa.com"
              />
              <button type="submit" className="btn btn-primary shrink-0" disabled={busy}>
                {busy ? <CircleNotch size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Convidar
              </button>
            </form>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>

        {/* Sair / apagar */}
        <div className="flex justify-end">
          <button className="btn btn-danger" onClick={leaveOrDelete} disabled={busy}>
            <Trash size={14} />
            {isOwner ? "Apagar workspace" : "Sair do workspace"}
          </button>
        </div>
      </main>
    </div>
  );
}
