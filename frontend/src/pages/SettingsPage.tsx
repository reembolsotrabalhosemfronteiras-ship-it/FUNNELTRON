import { useEffect, useState } from "react";
import { Save, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Header } from "@/components/common/Header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Input, Label } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Badge } from "@/components/common/Badge";
import { getCredentials, saveCredentials, testConnection, listFunnels } from "@/api/client";
import type { IntegrationCredentials } from "@/api/client";
import type { Funnel } from "@/types";
import { cn } from "@/lib/cn";
import { TrackerCard } from "@/components/settings/TrackerCard";
import { SlugRulesCard } from "@/components/settings/SlugRulesCard";

// `{click_id}` é o placeholder oficial da PerfectPay (lista de parâmetros
// disponíveis na configuração de webhook dela): ela substitui isso pelo
// valor do parâmetro `click_id` que estava na URL do checkout na hora da
// compra — o mesmo id de sessão que o tracker.js já propaga pelos links do
// funil. Sem esse pedaço na URL, a venda continua sendo salva, só sem
// step/sessão associados.
function perfectPayWebhookUrl(funnelId: string): string {
  return `${window.location.origin}/api/live/webhook/perfectpay/${funnelId}?click_id={click_id}`;
}

export function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<"vturb" | "webhook" | null>(null);
  const [savedField, setSavedField] = useState<"vturb" | "webhook" | null>(null);
  const [testing, setTesting] = useState<"vturb" | "clarity" | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);
  const [showVturb, setShowVturb] = useState(false);
  const [showClarity, setShowClarity] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  // PerfectPay não sabe o que é um "funil" — cada um precisa da própria URL de
  // webhook, com o funnel_id embutido no link, não configurável em um campo só.
  const [webhookFunnelId, setWebhookFunnelId] = useState<string>("");

  useEffect(() => {
    listFunnels()
      .then((list) => {
        setFunnels(list);
        if (list.length > 0) setWebhookFunnelId(list[0].id);
      })
      .catch((err) => console.error("Erro ao carregar funis:", err));
  }, []);

  const [form, setForm] = useState<IntegrationCredentials>({
    vturbToken: "",
    vturbTier: "pro",
    clarityToken: "",
    webhookSecret: "",
    webhookUrl: "/api/live/webhook",
  });

  const handleSave = async () => {
    setSaving(true);
    await saveCredentials(form);
    setSaving(false);
  };

  // Salvar por card: cada integração é sua própria linha no banco
  // (`saveCredentials` já só manda os campos preenchidos), então dá pra
  // salvar o VTurb sem esperar o usuário mexer no Clarity ou no webhook —
  // antes só existia UM botão "Salvar Configurações" lá embaixo, e editar só
  // o token do VTurb exigia rolar a página inteira pra confirmar.
  const handleSaveField = async (field: "vturb" | "webhook") => {
    setSavingField(field);
    setSavedField(null);
    await saveCredentials(form);
    setSavingField(null);
    setSavedField(field);
    setTimeout(() => setSavedField((f) => (f === field ? null : f)), 2000);
  };

  const handleTest = async (provider: "vturb" | "clarity") => {
    setTesting(provider);
    // Salva ANTES de testar. O teste roda no backend, que lê o token do banco —
    // testar sem salvar respondia "credenciais não configuradas" mesmo com o
    // token correto digitado na tela, que é o erro mais confuso possível.
    try {
      await saveCredentials(form);
      const result = await testConnection(provider);
      setTestResult({ provider, ...result });
    } catch {
      setTestResult({
        provider,
        ok: false,
        message: "Não foi possível salvar o token antes de testar.",
      });
    }
    setTesting(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header title="Configurações" subtitle="Integrações e tokens de API" />

      <main className="p-4 max-w-3xl mx-auto space-y-6">
        {/* VTurb */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">🎬</span>
                  VTurb Analytics
                </CardTitle>
                <CardDescription>
                  Integração para conversão de VSL. Requer token de API do painel VTurb.
                </CardDescription>
              </div>
              <Badge variant="info">VSL</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>X-Api-Token</Label>
                <div className="relative mt-1">
                  <Input
                    type={showVturb ? "text" : "password"}
                    value={form.vturbToken}
                    onChange={(e) => setForm({ ...form, vturbToken: e.target.value })}
                    placeholder="Insira seu token de API"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVturb(!showVturb)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showVturb ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Encontre em: painel VTurb → Configurações → API Keys
                </p>
              </div>

              <div>
                <Label>Tier (Rate Limit)</Label>
                <Select
                  value={form.vturbTier}
                  onChange={(e) => setForm({ ...form, vturbTier: e.target.value as any })}
                  className="mt-1"
                >
                  <option value="basic">Basic (60 req/min)</option>
                  <option value="pro">Pro (120 req/min)</option>
                  <option value="scale">Scale (300 req/min)</option>
                  <option value="enterprise">Enterprise (800 req/min)</option>
                </Select>
              </div>

              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleSaveField("vturb")}
                  disabled={savingField === "vturb"}
                >
                  {savingField === "vturb" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : savedField === "vturb" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {savedField === "vturb" ? "Salvo" : "Salvar"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleTest("vturb")}
                  disabled={testing === "vturb" || !form.vturbToken}
                >
                  {testing === "vturb" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Testar
                </Button>
              </div>
            </div>

            {testResult?.provider === "vturb" && (
              <div
                className={cn(
                  "flex items-center gap-2 text-sm p-3 rounded-md",
                  testResult.ok
                    ? "bg-success/10 text-success border border-success/30"
                    : "bg-danger/10 text-danger border border-danger/30"
                )}
              >
                {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Clarity */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">📊</span>
                  Microsoft Clarity
                </CardTitle>
                <CardDescription>
                  Sessões e engajamento por página. Uma credencial só: o token de
                  API do projeto.
                </CardDescription>
              </div>
              <Badge variant="info">Conversão Real</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label>Token de API</Label>
                <div className="relative mt-1">
                  <Input
                    type={showClarity ? "text" : "password"}
                    value={form.clarityToken}
                    onChange={(e) => setForm({ ...form, clarityToken: e.target.value })}
                    placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6..."
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowClarity(!showClarity)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showClarity ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  O token já é do projeto — não existe Client ID, Client Secret
                  nem Project ID para preencher aqui.
                </p>
              </div>

              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleTest("clarity")}
                  disabled={testing === "clarity" || !form.clarityToken}
                >
                  {testing === "clarity" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Salvar e testar
                </Button>
              </div>
            </div>

            {testResult?.provider === "clarity" && (
              <div
                className={cn(
                  "flex items-center gap-2 text-sm p-3 rounded-md",
                  testResult.ok
                    ? "bg-success/10 text-success border border-success/30"
                    : "bg-danger/10 text-danger border border-danger/30"
                )}
              >
                {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}

            <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
              <strong>Como configurar:</strong>
              <ol className="list-decimal list-inside mt-2 space-y-1">
                <li>No painel do Clarity, abra Configurações → Configurações do projeto → API</li>
                <li>Clique em "Gerar novo token de API"</li>
                <li>Copie o token na hora — o Clarity não mostra ele de novo</li>
                <li>Cole aqui e clique em "Salvar e testar"</li>
              </ol>
              <p className="mt-2">
                O Clarity permite <strong>10 consultas por dia</strong> e exporta
                no máximo os <strong>últimos 3 dias</strong> por consulta. Cada
                teste gasta uma dessas consultas.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Webhook de Venda (PerfectPay) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">💳</span>
                  Webhook de Venda
                </CardTitle>
                <CardDescription>
                  Cada funil tem sua própria URL — a PerfectPay não sabe o que é
                  um "funil", então o link já vem com o funil embutido.
                </CardDescription>
              </div>
              <Badge variant="info">PerfectPay</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Funil</Label>
              <Select
                value={webhookFunnelId}
                onChange={(e) => setWebhookFunnelId(e.target.value)}
                className="mt-1"
                disabled={funnels.length === 0}
              >
                {funnels.length === 0 ? (
                  <option value="">Nenhum funil cadastrado</option>
                ) : (
                  funnels.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))
                )}
              </Select>
            </div>

            <div>
              <Label>URL do Webhook (cole na PerfectPay)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="text"
                  readOnly
                  value={webhookFunnelId ? perfectPayWebhookUrl(webhookFunnelId) : ""}
                  className="font-mono text-xs bg-muted/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!webhookFunnelId}
                  onClick={() => {
                    navigator.clipboard?.writeText(perfectPayWebhookUrl(webhookFunnelId));
                  }}
                >
                  Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cole exatamente essa URL na integração de webhook do produto
                correspondente a este funil, com "Formato postback:
                PerfectPay". O <code>{"{click_id}"}</code> no final já vem
                pronto — é o que faz o sistema saber de qual sessão/etapa
                cada venda veio; não precisa mexer nele.
              </p>
            </div>

            <div>
              <Label>Public token</Label>
              <div className="relative mt-1">
                <Input
                  type={showWebhook ? "text" : "password"}
                  value={form.webhookSecret}
                  onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                  placeholder="Cole o Public token da PerfectPay"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhook(!showWebhook)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showWebhook ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Copie o mesmo <strong>Public token</strong> que aparece na tela
                de configuração do webhook, na PerfectPay (campo "Segurança").
                Ele vem dentro de cada chamada, não em um header — deixe em
                branco para aceitar qualquer chamada.
              </p>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => handleSaveField("webhook")}
                  disabled={savingField === "webhook"}
                >
                  {savingField === "webhook" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : savedField === "webhook" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {savedField === "webhook" ? "Salvo" : "Salvar"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rastreador */}
        {/* O endereço tem que ser ABSOLUTO: o snippet é colado nas páginas do
            funil, em outro domínio. Relativo ("/tracker.js"), o navegador
            procuraria o arquivo no site de vendas e não acharia nada — o
            rastreador ficaria mudo sem nenhum erro visível.
            `VITE_API_ORIGIN` só é necessário se a API morar fora daqui. */}
        <TrackerCard
          apiOrigin={import.meta.env.VITE_API_ORIGIN || window.location.origin}
        />

        {/* Tipo de página por slug */}
        <SlugRulesCard />

        {/* Salvar */}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setForm({
            vturbToken: "",
            vturbTier: "pro",
            clarityToken: "",
            webhookSecret: "",
            webhookUrl: "/api/live/webhook",
          })}>
            Limpar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar Configurações
          </Button>
        </div>
      </main>
    </div>
  );
}