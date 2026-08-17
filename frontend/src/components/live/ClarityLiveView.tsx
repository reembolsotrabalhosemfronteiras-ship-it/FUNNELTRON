import { useEffect, useState } from "react";
import { Cloud, Users, Eye, Timer, UserCheck } from "lucide-react";
import { Card, CardContent } from "@/components/common/Card";
import { Spinner } from "@/components/common/Spinner";
import { AsOfBadge, ClarityDelayNotice } from "@/components/common/AsOfBadge";
import {
  getLatestClarity,
  CLARITY_METRICS_ZERO,
  type ClaritySnapshot,
} from "@/api/client";

/**
 * O Clarity na página Ao Vivo.
 *
 * Não tem "agora" para mostrar: a API dele agrega por dia e publica com atraso.
 * Então mostra o ÚLTIMO dado disponível, e todo lugar que falaria de tempo diz
 * a que período o número se refere. Nenhum rótulo aqui usa a palavra "agora".
 */
export function ClarityLiveView({ funnelId }: { funnelId?: string }) {
  const [snap, setSnap] = useState<ClaritySnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLatestClarity(funnelId)
      .then((s) => {
        if (!cancelled) setSnap(s);
      })
      .catch(() => {
        if (!cancelled) setSnap(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Sem polling: repetir a chamada de 5 em 5s não traria número novo — o
    // Clarity só publica de tempos em tempos. O polling do rastreador existe
    // porque lá o dado realmente muda a cada segundo.
  }, [funnelId]);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  // Sem importação, a página aparece zerada em vez de sumir. O carimbo no topo
  // e em cada card já diz que não há dado — trocar os cards por um bloco de
  // texto esconderia a estrutura de quem está configurando pela primeira vez.
  const metrics = snap?.metrics ?? CLARITY_METRICS_ZERO;
  const semDados = !snap?.metrics;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-blue-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Microsoft Clarity
            </h2>
          </div>
          <AsOfBadge {...(snap ?? { empty: true })} />
        </div>
        <ClarityDelayNotice />
      </section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ClarityCard
          label="Sessões"
          value={metrics.sessions.toLocaleString("pt-BR")}
          icon={<Users size={16} className="text-blue-500" />}
          snap={snap}
        />
        <ClarityCard
          label="Visitantes únicos"
          value={metrics.distinctUsers.toLocaleString("pt-BR")}
          icon={<UserCheck size={16} className="text-blue-500" />}
          snap={snap}
        />
        <ClarityCard
          label="Páginas vistas"
          value={metrics.pageViews.toLocaleString("pt-BR")}
          icon={<Eye size={16} className="text-blue-500" />}
          snap={snap}
        />
        <ClarityCard
          label="Tempo médio"
          value={`${metrics.avgTime.toFixed(1)}s`}
          icon={<Timer size={16} className="text-blue-500" />}
          snap={snap}
        />
      </div>

      {semDados && (
        <p className="rounded-lg border border-dashed px-4 py-3 text-center text-sm text-muted-foreground">
          Ainda não houve importação do Clarity. Salve o token em Configurações e
          abra a página de Métricas para trazer o primeiro dado.
        </p>
      )}
    </div>
  );
}

function ClarityCard({
  label,
  value,
  icon,
  snap,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  snap: ClaritySnapshot | null;
}) {
  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[11px] uppercase tracking-wide">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {/* Carimbo por card, e não só no topo: os cards são lidos isolados, e
            um número sozinho na tela não conta de quando ele é. */}
        <AsOfBadge {...(snap ?? { empty: true })} className="mt-2" label="Clarity" />
      </CardContent>
    </Card>
  );
}
