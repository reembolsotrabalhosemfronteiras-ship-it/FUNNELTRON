import { useEffect, useState } from "react";
import {
  Sparkles,
  Package,
  ClipboardList,
  ArrowLeft,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { STEP_TYPE_LABEL } from "./AtelierNode";
import {
  guessStepType,
  parseUrlList,
  DEFAULT_SLUG_RULES,
  type ParsedUrl,
  type SlugTypeRule,
} from "@/lib/urlImport";
import { getSlugRules } from "@/api/client";
import type { FunnelKind } from "@/types";

export type NewFunnelChoice =
  | { mode: "blank"; kind: FunnelKind; name: string }
  | { mode: "import"; kind: FunnelKind; name: string; urls: ParsedUrl[] };

type Screen = "choose" | "blank" | "import";

export function NewFunnelDialog({
  onClose,
  onCreate,
  creating,
}: {
  onClose: () => void;
  onCreate: (choice: NewFunnelChoice) => void;
  creating: boolean;
}) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [kind, setKind] = useState<FunnelKind>("front");
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  // Regras do usuário (Configurações), com os padrões embutidos enquanto
  // carrega — sem isso o primeiro palpite da sessão sairia sempre "outra".
  const [rules, setRules] = useState<SlugTypeRule[]>(DEFAULT_SLUG_RULES);

  useEffect(() => {
    // Leitura, não escrita — se falhar, os padrões embutidos já em `rules`
    // servem de sobra pra este palpite não travar o diálogo.
    getSlugRules()
      .then((r) => {
        if (r && r.length > 0) setRules(r);
      })
      .catch(() => {});
  }, []);

  const parsed = parseUrlList(raw, rules);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {screen !== "choose" && (
              <button
                onClick={() => setScreen("choose")}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <h2 className="font-semibold">
              {screen === "choose"
                ? "Novo funil"
                : screen === "blank"
                ? kind === "upsell"
                  ? "Funil de upsell do zero"
                  : "Funil do zero"
                : "Importar funil por lista de URLs"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {screen === "choose" && (
          <div className="space-y-2 p-4">
            <Choice
              icon={<Sparkles size={18} className="text-primary" />}
              title="Funil do zero"
              description="Canvas vazio. Você desenha página por página no ateliê."
              onClick={() => {
                setKind("front");
                setScreen("blank");
              }}
            />
            <Choice
              icon={<Package size={18} className="text-cyan-500" />}
              title="Funil de upsell"
              description="Mesmo ateliê, mas reaproveitável dentro de qualquer funil de front como um bloco só."
              onClick={() => {
                setKind("upsell");
                setScreen("blank");
              }}
            />
            <Choice
              icon={<ClipboardList size={18} className="text-success" />}
              title="Importar funil"
              description="Cole a lista de URLs na ordem do fluxo. As páginas são criadas e ligadas automaticamente."
              onClick={() => {
                setKind("front");
                setScreen("import");
              }}
            />
          </div>
        )}

        {screen === "blank" && (
          <div className="space-y-4 p-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                Nome do funil
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === "upsell" ? "Upsell Mentoria" : "Webinar Tráfego Pago"
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={() =>
                onCreate({ mode: "blank", kind, name: name.trim() })
              }
              disabled={!name.trim() || creating}
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Criando…" : "Criar e abrir o ateliê"}
            </button>
          </div>
        )}

        {screen === "import" && (
          <div className="space-y-4 p-4">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                Nome do funil
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Trabalho Sem Fronteiras"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                URLs na ordem do funil — uma por linha
              </label>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={7}
                placeholder={"https://site.com/\nhttps://site.com/vsl\nhttps://site.com/checkout"}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
              />
            </div>

            {parsed.invalid.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-xs text-warning">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {parsed.invalid.length}{" "}
                {parsed.invalid.length === 1 ? "linha ignorada" : "linhas ignoradas"}{" "}
                por não parecerem URL: {parsed.invalid.slice(0, 3).join(", ")}
                {parsed.invalid.length > 3 && "…"}
              </p>
            )}

            {parsed.urls.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm">
                  <span className="font-medium">
                    {parsed.urls.length} páginas
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · o tipo foi deduzido do slug e pode ser trocado depois
                  </span>
                </p>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                  {parsed.urls.map((u, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="truncate font-medium">{u.label}</span>
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {STEP_TYPE_LABEL[u.type]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs leading-snug text-muted-foreground">
              As páginas entram em linha, ligadas na ordem colada. Os cards
              nascem sem print — abra o ateliê e use "capturar print" em cada
              um, ou cole a imagem direto (Ctrl+V).
            </p>

            <button
              onClick={() =>
                onCreate({
                  mode: "import",
                  kind,
                  name: name.trim(),
                  urls: parsed.urls,
                })
              }
              disabled={!name.trim() || parsed.urls.length === 0 || creating}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating && <Loader2 size={14} className="animate-spin" />}
              {creating
                ? "Montando o funil…"
                : `Criar funil com ${parsed.urls.length} páginas`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Choice({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors",
        "hover:border-primary hover:bg-primary/5"
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

export { guessStepType };
