"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Label } from "@/components/common/Input";
import { Select } from "@/components/common/Select";
import { Badge } from "@/components/common/Badge";
import { listFunnels } from "@/api/client";
import type { Funnel } from "@/types";

interface TrackerCardProps {
  apiOrigin?: string; // ex: "https://api.seudominio.com" ou "" para mesma origem
}

/**
 * Card de configuração do rastreador (snippet).
 * - Lista os funis do usuário para gerar o código com o funnelId correto
 * - Copia o snippet para o clipboard
 * - Mostra instruções de instalação
 */
export function TrackerCard({ apiOrigin = "" }: TrackerCardProps) {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carrega funis do usuário
  useEffect(() => {
    let cancelled = false;
    listFunnels()
      .then((f) => {
        if (!cancelled) {
          setFunnels(f);
          if (f.length > 0) setSelectedFunnelId(f[0].id);
        }
      })
      .catch((e) => {
        if (!cancelled) setError("Erro ao carregar funis");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedFunnel = funnels.find((f) => f.id === selectedFunnelId);

  // Endereço absoluto do app. O snippet roda no domínio do FUNIL, não neste —
  // sem origem explícita, `/tracker.js` e `/api/live/track` seriam procurados
  // no site de vendas, que não os tem.
  const origem = (apiOrigin || "").replace(/\/$/, "");

  const snippet = selectedFunnel
    ? `<script>
  window.Funneltron = {
    funnelId: "${selectedFunnel.id}",
    endpoint: "${origem}",
    interval: 15000
  };
<\/script>
<script src="${origem}/tracker.js"><\/script>`
    : "";

  // Colado em produção, um endereço local não alcança ninguém.
  const origemLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origem);

  const handleCopy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = snippet;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-danger/30">
        <CardContent className="p-4 flex items-center gap-2 text-danger">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </CardContent>
      </Card>
    );
  }

  if (funnels.length === 0) {
    return (
      <Card className="border-dashed border-border">
        <CardContent className="p-6 text-center text-muted-foreground">
          <p className="mb-2">Nenhum funil cadastrado.</p>
          <p className="text-sm">Crie um funil primeiro para gerar o snippet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">📡</span>
              Rastreador de Funil (Snippet)
            </CardTitle>
            <CardDescription>
              Cole este código no <code>&lt;head&gt;</code> das páginas do funil para ver visitantes
              em tempo real.
            </CardDescription>
          </div>
          <Badge variant="info">Ao Vivo</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Seletor de funil */}
        <div>
          <Label>Selecione o funil</Label>
          <Select
            value={selectedFunnelId}
            onChange={(e) => setSelectedFunnelId(e.target.value)}
            className="mt-1 w-full md:w-80"
          >
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.slug})
              </option>
            ))}
          </Select>
          {selectedFunnel && (
            <p className="text-xs text-muted-foreground mt-1">
              ID: <code className="font-mono">{selectedFunnel.id}</code>
            </p>
          )}
        </div>

        {/* Código do snippet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="mb-0">Snippet para colar no &lt;head&gt;</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!snippet}
              className="gap-1.5"
            >
              {copied ? (
                <>
                  <Check size={14} />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copiar
                </>
              )}
            </Button>
          </div>
          <div className="relative">
            <pre className="bg-slate-950 rounded-lg p-4 overflow-x-auto text-xs text-slate-100 max-h-48">
              <code>{snippet}</code>
            </pre>
          </div>
          {origemLocal && (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>
                Este snippet aponta para <code className="font-mono">{origem}</code>, que só existe
                na sua máquina. Copie o código a partir do endereço público do app — colado no
                funil, este aqui não alcança nada.
              </span>
            </p>
          )}
        </div>

        {/* Link direto do arquivo tracker.js */}
        {selectedFunnel && (
          <div className="border-t border-border pt-4 space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Ou baixe/linke o arquivo direto</Label>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <code className="font-mono bg-muted px-2 py-1 rounded">
                {apiOrigin || window.location.origin}/tracker.js
              </code>
              <a
                href={`${apiOrigin || window.location.origin}/tracker.js`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-xs h-8 px-3 bg-transparent border border-border text-foreground hover:bg-muted shadow-sm"
              >
                <ExternalLink size={12} />
                Abrir tracker.js
              </a>
            </div>
            <p className="text-xs text-muted-foreground">
              O arquivo <code className="font-mono">tracker.js</code> é servido estaticamente pelo frontend
              (pasta <code className="font-mono">public/</code>). Se hospedar em domínio separado,
              configure a variável <code className="font-mono">endpoint</code> acima.
            </p>
          </div>
        )}

        {/* Instruções */}
        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md space-y-1">
          <strong>Como instalar:</strong>
          <ol className="list-decimal list-inside mt-1 space-y-1">
            <li>Copie o snippet acima.</li>
            <li>Cole dentro de <code className="font-mono">&lt;head&gt;</code> de <strong>todas</strong> as páginas do funil (landing, VSL, checkout, obrigado, etc.).</li>
            <li>O <code className="font-mono">step_id</code> é resolvido automaticamente no banco pela URL — não precisa configurar por página.</li>
            <li>Heartbeats são enviados a cada 15s (configurável em <code className="font-mono">interval</code>).</li>
            <li>Dados aparecem em <strong>Ao Vivo</strong> segundos depois da primeira visita.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}