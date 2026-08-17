import { createContext, useCallback, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NewFunnelDialog, type NewFunnelChoice } from "./NewFunnelDialog";
import { createFunnel, saveFunnelLayout } from "@/api/client";
import type { FunnelEdge, FunnelStep } from "@/types";

// O popup de novo funil é disparado de dois lugares (sidebar e página de
// Funis). Em vez de duplicar o diálogo e a lógica de criação, ele mora aqui e
// os botões só pedem para abrir.
const NewFunnelContext = createContext<{ open: () => void }>({
  open: () => {},
});

export const useNewFunnel = () => useContext(NewFunnelContext);

export function NewFunnelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(
    async (choice: NewFunnelChoice) => {
      setCreating(true);
      try {
        const slugBase = choice.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        const funnel = await createFunnel({
          name: choice.name,
          slug: `${slugBase || "funil"}-${Date.now().toString(36)}`,
          status: "testing",
          baseUrl: choice.mode === "import" ? choice.urls[0]?.url ?? "" : "",
          kind: choice.kind,
        });

        if (choice.mode === "import") {
          // Páginas em linha, ligadas na ordem colada.
          // Ids são UUID porque as colunas do banco são `uuid` — id legível
          // salvava no localStorage mas era recusado pelo Postgres.
          const ids = choice.urls.map(() => crypto.randomUUID());

          const steps: FunnelStep[] = choice.urls.map((u, i) => ({
            id: ids[i],
            funnelId: funnel.id,
            label: u.label,
            url: u.url,
            type: u.type,
            positionX: i * 300,
            positionY: 0,
            parentStepId: i === 0 ? null : ids[i - 1],
            orderIndex: i,
            screenshotUrl: null,
          }));

          const edges: FunnelEdge[] = steps.slice(1).map((s, i) => ({
            id: crypto.randomUUID(),
            funnelId: funnel.id,
            sourceStepId: steps[i].id,
            targetStepId: s.id,
            condition: "default",
            label: "",
          }));

          await saveFunnelLayout(funnel.id, steps, edges, "testing");
        }

        setOpen(false);
        navigate(`/funnel/${funnel.id}/edit`);
      } finally {
        setCreating(false);
      }
    },
    [navigate]
  );

  return (
    <NewFunnelContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {open && (
        <NewFunnelDialog
          creating={creating}
          onClose={() => setOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </NewFunnelContext.Provider>
  );
}
