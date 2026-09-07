import { useEffect, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/common/Card";
import { Select } from "@/components/common/Select";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { useWorkspace } from "@/components/common/WorkspaceContext";
import { updateWorkspaceAttributionModel } from "@/api/client";

interface Props {
  /** Ignorado — o card usa o workspace ativo do contexto. Mantido para compatibilidade. */
  workspaceId?: string;
  /** Ignorado — o card lê o modelo do workspace ativo. Mantido para compatibilidade. */
  currentModel?: "first_touch" | "last_touch";
  /** Ignorado — o card salva diretamente via API. Mantido para compatibilidade. */
  onSave?: (model: "first_touch" | "last_touch") => Promise<void>;
}

const OPTIONS = [
  { value: "first_touch", label: "First Touch" },
  { value: "last_touch", label: "Last Touch" },
];

export function AttributionSettingsCard(_props?: Props) {
  const { active, reload } = useWorkspace();
  const currentModel = (active?.attribution_model as "first_touch" | "last_touch") || "first_touch";
  const workspaceId = active?.id || "";

  const [model, setModel] = useState(currentModel);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sincroniza estado local quando o workspace ativo muda ou é recarregado
  useEffect(() => {
    setModel(currentModel);
    setDirty(false);
  }, [currentModel]);

  const handleChange = (value: string) => {
    setModel(value as "first_touch" | "last_touch");
    setDirty(value !== currentModel);
  };

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await updateWorkspaceAttributionModel(workspaceId, model);
      await reload();
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Modelo de Atribuição</CardTitle>
            <CardDescription>
              Define qual UTM é usado para atribuir leads a criativos e campanhas.
            </CardDescription>
          </div>
          <Info size={18} className="text-muted-foreground shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="w-full sm:max-w-xs">
          <Select
            value={model}
            onChange={handleChange}
            options={OPTIONS}
            placeholder="Selecione o modelo"
            className="min-h-[44px]"
          />
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
          <p>
            <strong className="text-foreground">First Touch:</strong> usa o UTM da{" "}
            <em>primeira</em> página visitada na sessão. Ideal para entender qual anúncio trouxe o lead.
          </p>
          <p>
            <strong className="text-foreground">Last Touch:</strong> usa o UTM da{" "}
            <em>última</em> página antes do quiz/conversão. Ideal para medir remarketing.
          </p>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving && <Spinner size={14} className="mr-2" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}