import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Save, Loader2, CheckCircle2, RotateCcw, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { getSlugRules, saveSlugRules } from "@/api/client";
import { DEFAULT_SLUG_RULES, type SlugTypeRule } from "@/lib/urlImport";
import { STEP_TYPE_LABEL } from "@/components/funnel/AtelierNode";
import type { StepType } from "@/types";

/** Tipos atribuíveis por regra — "landing"/"outra" são o resultado padrão
 * quando nada bate, não faz sentido escolher isso NUMA regra; e o funil de
 * upsell não é algo que um slug sozinho decide. */
const ASSIGNABLE_TYPES: StepType[] = [
  "vsl",
  "checkout",
  "upsell",
  "downsell",
  "order_bump",
  "thank_you",
];

/**
 * Regras de "esse pedaço do slug sempre vira esse tipo de página", usadas na
 * importação por lista de URLs. Checadas na ordem — a primeira que bater
 * vence, então uma regra colocada antes na lista sempre tem prioridade.
 */
export function SlugRulesCard() {
  const [rules, setRules] = useState<SlugTypeRule[]>(DEFAULT_SLUG_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customized, setCustomized] = useState(false);
  // Falha na leitura fica marcada à parte de "nunca personalizou" — as duas
  // pareciam a mesma coisa antes (getSlugRules devolvia null pros dois
  // casos), e um "Salvar" nessa hora sobrescrevia uma personalização real
  // com os padrões, sem aviso nenhum.
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getSlugRules()
      .then((r) => {
        if (r && r.length > 0) {
          setRules(r);
          setCustomized(true);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateRule = (index: number, patch: Partial<SlugTypeRule>) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  };

  const addRule = () => {
    setRules((prev) => [...prev, { keyword: "", type: "vsl" }]);
    setSaved(false);
  };

  const resetToDefaults = () => {
    setRules(DEFAULT_SLUG_RULES.map((r) => ({ ...r })));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Linha em branco não serve pra nada além de poluir a lista salva.
      const clean = rules.filter((r) => r.keyword.trim().length > 0);
      await saveSlugRules(clean);
      setRules(clean);
      setCustomized(true);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">🏷️</span>
              Tipo de página por slug
            </CardTitle>
            <CardDescription>
              Quando um slug colado na importação por URL contém uma dessas
              palavras, a página já nasce classificada com o tipo ao lado —
              sem precisar trocar depois, uma por uma. A primeira regra que
              bater vence.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Carregando…
          </div>
        ) : (
          <>
            {loadError && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={13} />
                  Não deu pra carregar suas regras salvas — salvar agora
                  sobrescreveria com os padrões. Tente de novo antes de
                  editar.
                </span>
                <Button type="button" variant="outline" size="sm" onClick={load}>
                  Tentar de novo
                </Button>
              </div>
            )}

            {!loadError && !customized && (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Estas são as regras padrão. Edite, adicione ou remova à
                vontade — nada é salvo até clicar em "Salvar".
              </p>
            )}

            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={rule.keyword}
                    onChange={(e) => updateRule(i, { keyword: e.target.value })}
                    placeholder="pedaço do slug, ex: vsl"
                    className="flex-1 font-mono text-xs"
                  />
                  <Select
                    value={rule.type}
                    onChange={(e) =>
                      updateRule(i, { type: e.target.value as StepType })
                    }
                    className="w-40"
                  >
                    {ASSIGNABLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {STEP_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeRule(i)}
                    title="Remover regra"
                    className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {rules.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Nenhuma regra — toda página importada nasce "Outra" (exceto
                  a primeira, que nasce "Landing").
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addRule}>
                  <Plus size={14} />
                  Adicionar regra
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={resetToDefaults}>
                  <RotateCcw size={14} />
                  Restaurar padrões
                </Button>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving || loadError}
                title={loadError ? "Recarregue antes de salvar" : undefined}
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : saved ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <Save size={14} />
                )}
                {saving ? "Salvando…" : saved ? "Salvo" : "Salvar"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
