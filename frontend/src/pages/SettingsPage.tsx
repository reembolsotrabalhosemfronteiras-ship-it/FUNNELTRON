import { useState } from "react";
import { Save, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Header } from "@/components/common/Header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Input, Label } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Badge } from "@/components/common/Badge";
import { getCredentials, saveCredentials, testConnection } from "@/api/client";
import type { IntegrationCredentials } from "@/api/client";
import { cn } from "@/lib/cn";
import { TrackerCard } from "@/components/settings/TrackerCard";

export function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"vturb" | "clarity" | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);
  const [showVturb, setShowVturb] = useState(false);
  const [showClarity, setShowClarity] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);

  const [form, setForm] = useState<IntegrationCredentials>({
    vturbToken: "",
    vturbTier: "pro",
    clarityClientId: "",
    clarityClientSecret: "",
    clarityProjectId: "",
    webhookSecret: "",
    webhookUrl: "/api/live/webhook",
  });

  const handleSave = async () => {
    setSaving(true);
    await saveCredentials(form);
    setSaving(false);
  };

  const handleTest = async (provider: "vturb" | "clarity") => {
    setTesting(provider);
    const result = await testConnection(provider);
    setTestResult({ provider, ...result });
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
                  Integração para conversão real por página. Requer OAuth Azure AD.
                </CardDescription>
              </div>
              <Badge variant="info">Conversão Real</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Client ID (Azure AD)</Label>
                <Input
                  type="text"
                  value={form.clarityClientId}
                  onChange={(e) => setForm({ ...form, clarityClientId: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Client Secret</Label>
                <div className="relative mt-1">
                  <Input
                    type={showClarity ? "text" : "password"}
                    value={form.clarityClientSecret}
                    onChange={(e) => setForm({ ...form, clarityClientSecret: e.target.value })}
                    placeholder="Segredo do aplicativo Azure"
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
              </div>

              <div className="md:col-span-2">
                <Label>Project ID (Clarity)</Label>
                <Input
                  type="text"
                  value={form.clarityProjectId}
                  onChange={(e) => setForm({ ...form, clarityProjectId: e.target.value })}
                  placeholder="ID do projeto no Microsoft Clarity"
                  className="mt-1"
                />
              </div>

              <div className="md:col-span-2 flex items-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleTest("clarity")}
                  disabled={testing === "clarity" || !form.clarityClientId || !form.clarityClientSecret}
                >
                  {testing === "clarity" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Testar
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
                <li>Crie um aplicativo no Azure AD (App Registrations)</li>
                <li>Adicione permissão para Microsoft Clarity API</li>
                <li>Gere um Client Secret</li>
                <li>Copie o Client ID, Secret e Project ID do Clarity</li>
              </ol>
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
                  Configure o segredo que a PerfectPay envia ao disparar o webhook
                  de venda pendente/paga.
                </CardDescription>
              </div>
              <Badge variant="info">PerfectPay</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>URL do Webhook (cole na PerfectPay)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="text"
                  readOnly
                  value={form.webhookUrl}
                  className="font-mono text-xs bg-muted/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(
                      `${window.location.origin}${form.webhookUrl}`
                    );
                  }}
                >
                  Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Endpoint público:{" "}
                <code className="font-mono">{window.location.origin}{form.webhookUrl}</code>
              </p>
            </div>

            <div>
              <Label>Segredo do Webhook (X-Webhook-Secret)</Label>
              <div className="relative mt-1">
                <Input
                  type={showWebhook ? "text" : "password"}
                  value={form.webhookSecret}
                  onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                  placeholder="Cole ou gere um segredo"
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
                A PerfectPay deve enviar esse valor no header{" "}
                <code className="font-mono">X-Webhook-Secret</code>. Deixe em
                branco para aceitar qualquer chamada.
              </p>
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

        {/* Salvar */}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setForm({
            vturbToken: "",
            vturbTier: "pro",
            clarityClientId: "",
            clarityClientSecret: "",
            clarityProjectId: "",
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