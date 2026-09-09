import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  CheckCircle,
  ArrowClockwise,
  ListChecks,
  ChartBarHorizontal,
  CaretDown,
  CaretRight,
  FileText,
} from "@phosphor-icons/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { PeriodPicker, periodLabel } from "@/components/common/PeriodPicker";
import { useNotifications } from "@/components/common/NotificationsProvider";
import { cn } from "@/lib/cn";
import type { PeriodInput } from "@/types";
import {
  getQuizResponses,
  type QuizResponsesData,
  type QuizPageResult,
  type QuizQuestionBlock,
} from "@/api/client";

// ---------------------------------------------------------------------------
// Cores para as barras de resposta (paleta ciclica)
// ---------------------------------------------------------------------------
const BAR_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#4f46e5",
  "#be185d",
];

function barColor(index: number): string {
  return BAR_COLORS[index % BAR_COLORS.length];
}

// ---------------------------------------------------------------------------
// Bloco de pergunta dentro de uma pagina (label + respostas)
// ---------------------------------------------------------------------------
function QuestionBlock({ block }: { block: QuizQuestionBlock }) {
  const maxCount = Math.max(1, ...block.answers.map((a) => a.count));

  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold text-foreground/90 leading-snug">
        {block.questionLabel}
      </p>
      <div className="space-y-2.5">
        {block.answers.map((answer, aIdx) => {
          const color = barColor(aIdx);
          const widthPct = maxCount > 0 ? (answer.count / maxCount) * 100 : 0;

          return (
            <div key={aIdx} className="space-y-1">
              <div className="flex items-center justify-between text-[12px]">
                <span
                  className="font-medium truncate pr-3 max-w-[70%]"
                  title={answer.value}
                >
                  {answer.value}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="tabular-nums text-muted-foreground">
                    {answer.count.toLocaleString("pt-BR")}
                  </span>
                  <span
                    className="tabular-nums font-bold min-w-[48px] text-right"
                    style={{ color }}
                  >
                    {answer.percentage}%
                  </span>
                </span>
              </div>
              <div className="h-2.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                    boxShadow: `0 0 8px ${color}44`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de uma pagina do funil
// ---------------------------------------------------------------------------
function PageCard({ page }: { page: QuizPageResult }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className="elev-sm overflow-hidden">
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardHeader className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary text-[13px] font-bold shrink-0">
                {page.pageNumber}
              </span>
              <div className="min-w-0">
                <CardTitle className="text-sm font-bold leading-snug truncate">
                  {page.pageLabel}
                </CardTitle>
                <CardDescription className="text-[11px] mt-0.5">
                  {page.totalSessions.toLocaleString("pt-BR")} sessoes ·{" "}
                  {page.totalResponses.toLocaleString("pt-BR")} respostas ·{" "}
                  {page.questions.length} pergunta{page.questions.length !== 1 ? "s" : ""}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="info" className="text-[10px]">
                <FileText size={10} className="mr-1" />
                Pag. {page.pageNumber}
              </Badge>
              {expanded ? (
                <CaretDown size={16} className="text-muted-foreground" />
              ) : (
                <CaretRight size={16} className="text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-4 px-4 space-y-4">
          {page.questions.map((block, qIdx) => (
            <div key={qIdx}>
              {qIdx > 0 && <hr className="my-3 border-border/40" />}
              <QuestionBlock block={block} />
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function QuizAdsTab({ funnelId }: { funnelId: string }) {
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QuizResponsesData | null>(null);
  const { notify } = useNotifications();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getQuizResponses(funnelId, period);
      setData(result);
    } catch (err) {
      notify({
        title: "Falha ao carregar respostas do quiz",
        body: err instanceof Error ? err.message : "Tente novamente.",
        url: "",
      });
    } finally {
      setLoading(false);
    }
  }, [funnelId, period, notify]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kpis = useMemo(() => {
    if (!data) return [];
    const totalPages = data.pages.length;
    const totalQuestions = data.pages.reduce(
      (s, p) => s + p.questions.length,
      0
    );
    const totalSessions = data.totalSessions;
    const totalResponses = data.totalResponses;
    const avgAnswersPerSession =
      totalSessions > 0 ? totalResponses / totalSessions : 0;

    const firstPage = data.pages[0];
    const lastPage = data.pages[data.pages.length - 1];
    const completionRate =
      firstPage && lastPage && firstPage.totalSessions > 0
        ? (lastPage.totalSessions / firstPage.totalSessions) * 100
        : 0;

    return [
      {
        label: "Paginas com Quiz",
        value: totalPages.toString(),
        sub: `${totalQuestions} perguntas no total`,
        icon: FileText,
        tone: "text-blue-500",
      },
      {
        label: "Sessoes Unicas",
        value: totalSessions.toLocaleString("pt-BR"),
        sub: `Periodo: ${periodLabel(period)}`,
        icon: Users,
        tone: "text-purple-500",
      },
      {
        label: "Respostas Totais",
        value: totalResponses.toLocaleString("pt-BR"),
        sub: `${avgAnswersPerSession.toFixed(1)} respostas/sessao em media`,
        icon: ChartBarHorizontal,
        tone: "text-cyan-500",
      },
      {
        label: "Taxa de Conclusao",
        value: `${completionRate.toFixed(1)}%`,
        sub:
          firstPage && lastPage
            ? `${firstPage.pageLabel} -> ${lastPage.pageLabel}`
            : "—",
        icon: CheckCircle,
        tone: "text-emerald-500",
      },
    ];
  }, [data, period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Respostas do Quiz por Pagina</h2>
          <p className="text-sm text-muted-foreground">
            Cada pagina do funil com suas perguntas e porcentagens de cada resposta
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker value={period} onChange={setPeriod} />
          <Button size="sm" variant="ghost" onClick={fetchData}>
            <ArrowClockwise size={14} className="mr-1" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, sub, icon: Icon, tone }) => (
          <Card key={label} className="elev-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <span className="card-kicker">{label}</span>
                <Icon size={20} className={cn(tone, "shrink-0")} />
              </div>
              <p className="text-[24px] font-bold mt-1.5 mb-1">{value}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Paginas do funil */}
      {!data || data.pages.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ListChecks
              size={40}
              className="mx-auto mb-3 text-muted-foreground/40"
            />
            <p className="text-muted-foreground">
              Nenhuma resposta de quiz encontrada neste periodo.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Verifique se o tracker.js esta instalado na pagina do quiz e se ha
              visitantes respondendo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.pages.map((page) => (
            <PageCard key={page.stepId} page={page} />
          ))}
        </div>
      )}
    </div>
  );
}