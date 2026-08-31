import { useEffect, useState } from "react";
import {
  FloppyDisk as Save,
  CheckCircle as CheckCircle2,
  WarningCircle as AlertCircle,
  Eye,
  EyeSlash as EyeOff,
  CircleNotch as Loader2,
  VideoCamera,
  ChartLine,
  WebhooksLogo,
} from "@phosphor-icons/react";
import { Header } from "@/components/common/Header";
import { getCredentials, saveCredentials, testConnection, listFunnels } from "@/api/client";
import type { IntegrationCredentials } from "@/api/client";
import type { Funnel } from "@/types";
import { cn } from "@/lib/cn";
import { TrackerCard } from "@/components/settings/TrackerCard";
import { SlugRulesCard } from "@/components/settings/SlugRulesCard";

// `{click_id}` é o placeholder oficial da PerfectPay: ela substitui isso pelo
// valor do parâmetro `click_id` que estava na URL do checkout na hora da
// compra — o mesmo id de sessão que o tracker.js já propaga pelos links.
function perfectPayWebhookUrl(funnelId: string): string {
  return `${window.location.origin}/api/live/webhook/perfectpay/${funnelId}?click_id={click_id}`;
}

/** Card no estilo do mockup: título + ícone + tag, corpo livre. */
function SettingsCard({
  icon,
  title,
  tag,
  tagClass = "tag-neutral",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tag: string;
  tagClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card elev-sm !p-[18px]">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <p className="card-title flex items-center gap-2">
          {icon}
          {title}
        </p>
        <span className={cn("tag shrink-0", tagClass)}>{tag}</span>
      </div>
      {children}
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
  show,
  onToggle,
  readOnly,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  show: boolean;
  onToggle: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="relative">
      <input
        className="input pr-10"
        type={show ? "text" : "password"}
        value={value}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Ocultar" : "Mostrar"}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
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
  const [copied, setCopied] = useState(false);
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [webhookFunnelId, setWebhookFunnelId] = useState<string>("");

  const [form, setForm] = useState<IntegrationCredentials>({
    vturbToken: "",
    vturbTier: "pro",
    clarityToken: "",
    webhookSecret: "",
    webhookUrl: "/api/live/webhook",
  });

  useEffect(() => {
    listFunnels()
      .then((list) => {
        setFunnels(list);
        if (list.length > 0) setWebhookFunnelId(list[0].id);
      })
      .catch((err) => console.error("Erro ao carregar funis:", err));
  }, []);

  // Puxa o que já está salvo (tokens vêm mascarados do backend).
  useEffect(() => {
    getCredentials()
      .then((c) => c && setForm((f) => ({ ...f, ...c })))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await saveCredentials(form);
    setSaving(false);
  };

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

  const copyWebhook = () => {
    if (!webhookFunnelId) return;
    navigator.clipboard?.writeText(perfectPayWebhookUrl(webhookFunnelId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const TestBanner = ({ provider }: { provider: string }) =>
    testResult?.provider === provider ? (
      <div
        className={cn(
          "mt-3 flex items-center gap-2 rounded-md p-3 text-sm",
          testResult.ok
            ? "border border-success/30 bg-success/10 text-success"
            : "border border-danger/30 bg-danger/10 text-danger"
        )}
      >
        {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        {testResult.message}
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-background">
      <Header title="Configurações" subtitle="Integrações e tokens de API" />

      <main className="flex flex-col gap-[18px] p-4 md:px-7 md:py-6 max-w-[760px]">
        {/* VTurb */}
        <SettingsCard
          icon={<VideoCamera size={18} style={{ color: "var(--c-vsl)" }} />}
          title="VTurb Analytics"
          tag="VSL"
          tagClass="tag-accent-2"
        >
          <div className="field mb-3">
            <label>X-Api-Token</label>
            <SecretInput
              value={form.vturbToken}
              onChange={(v) => setForm({ ...form, vturbToken: v })}
              placeholder="Insira seu token de API"
              show={showVturb}
              onToggle={() => setShowVturb(!showVturb)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Encontre em: painel VTurb → Configurações → API Keys
            </p>
          </div>

          <div className="field mb-3">
            <label>Tier (rate limit)</label>
            <select
              className="input"
              value={form.vturbTier}
              onChange={(e) => setForm({ ...form, vturbTier: e.target.value as IntegrationCredentials["vturbTier"] })}
            >
              <option value="basic">Basic (60 req/min)</option>
              <option value="pro">Pro (120 req/min)</option>
              <option value="scale">Scale (300 req/min)</option>
              <option value="enterprise">Enterprise (800 req/min)</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-secondary"
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
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleTest("vturb")}
              disabled={testing === "vturb" || !form.vturbToken}
            >
              {testing === "vturb" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Testar
            </button>
          </div>
          <TestBanner provider="vturb" />
        </SettingsCard>

        {/* Clarity */}
        <SettingsCard
          icon={<ChartLine size={18} className="text-primary" />}
          title="Microsoft Clarity"
          tag="Conversão real"
          tagClass="tag-accent"
        >
          <div className="field mb-3">
            <label>Token de API</label>
            <SecretInput
              value={form.clarityToken}
              onChange={(v) => setForm({ ...form, clarityToken: v })}
              placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6..."
              show={showClarity}
              onToggle={() => setShowClarity(!showClarity)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O token já é do projeto — não existe Client ID, Client Secret nem Project ID aqui.
            </p>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => handleTest("clarity")}
            disabled={testing === "clarity" || !form.clarityToken}
          >
            {testing === "clarity" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Salvar e testar
          </button>
          <TestBanner provider="clarity" />

          <div className="mt-3 rounded-md bg-neutral-900/50 p-3 text-xs text-muted-foreground">
            <strong>Como configurar:</strong>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>No painel do Clarity: Configurações → Configurações do projeto → API</li>
              <li>Clique em "Gerar novo token de API"</li>
              <li>Copie o token na hora — o Clarity não mostra de novo</li>
              <li>Cole aqui e clique em "Salvar e testar"</li>
            </ol>
            <p className="mt-2">
              O Clarity permite <strong>10 consultas por dia</strong> e no máximo os{" "}
              <strong>últimos 3 dias</strong> por consulta. Cada teste gasta uma.
            </p>
          </div>
        </SettingsCard>

        {/* Webhook de venda */}
        <SettingsCard
          icon={<WebhooksLogo size={18} className="text-primary" />}
          title="Webhook de venda"
          tag="PerfectPay"
        >
          <p className="card-body mb-3">
            Cada funil tem sua própria URL — a PerfectPay não sabe o que é um "funil", então o
            link já vem com o funil embutido.
          </p>

          <div className="field mb-3">
            <label>Funil</label>
            <select
              className="input"
              value={webhookFunnelId}
              onChange={(e) => setWebhookFunnelId(e.target.value)}
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
            </select>
          </div>

          <div className="field mb-3">
            <label>URL do webhook (cole na PerfectPay)</label>
            <div className="flex items-center gap-2">
              <input
                className="input font-mono text-xs"
                readOnly
                value={webhookFunnelId ? perfectPayWebhookUrl(webhookFunnelId) : ""}
              />
              <button
                className="btn btn-secondary btn-sm shrink-0"
                disabled={!webhookFunnelId}
                onClick={copyWebhook}
              >
                {copied ? <CheckCircle2 size={13} /> : null}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cole exatamente essa URL na integração de webhook do produto, formato "Postback:
              PerfectPay". O <code>{"{click_id}"}</code> no final já vem pronto — não mexa nele.
            </p>
          </div>

          <div className="field">
            <label>Public token</label>
            <SecretInput
              value={form.webhookSecret}
              onChange={(v) => setForm({ ...form, webhookSecret: v })}
              placeholder="Cole o Public token da PerfectPay"
              show={showWebhook}
              onToggle={() => setShowWebhook(!showWebhook)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O mesmo <strong>Public token</strong> da tela de webhook da PerfectPay (campo
              "Segurança"). Deixe em branco para aceitar qualquer chamada.
            </p>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              className="btn btn-secondary"
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
            </button>
          </div>
        </SettingsCard>

        {/* Rastreador próprio (snippet) */}
        <TrackerCard apiOrigin={import.meta.env.VITE_API_ORIGIN || window.location.origin} />

        {/* Tipo de página por slug */}
        <SlugRulesCard />

        {/* Salvar tudo */}
        <div className="flex justify-end gap-2">
          <button
            className="btn btn-ghost"
            onClick={() =>
              setForm({
                vturbToken: "",
                vturbTier: "pro",
                clarityToken: "",
                webhookSecret: "",
                webhookUrl: "/api/live/webhook",
              })
            }
          >
            Limpar
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar configurações
          </button>
        </div>
      </main>
    </div>
  );
}
