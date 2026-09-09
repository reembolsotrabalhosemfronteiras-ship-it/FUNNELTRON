import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  CheckCircle,
  ArrowClockwise,
  ListChecks,
  ChartBarHorizontal,
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
import { getQuizResponses, type QuizResponsesData, type QuizQuestionResult } from "@/api/client";

// ---------------------------------------------------------------------------
// Cores para as barras de resposta (paleta cíclica)
// ---------------------------------------------------------------------------
const BAR_COLORS = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#059669", // emerald
  "#d97706", // amber
  "#dc2626", // red
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#be185d", // pink
];

function barColor(index: number): string {
  return BAR_COLORS[index % BAR_COLORS.length];
}

// ---------------------------------------------------------------------------
// Card de uma pergunta individual
// ---------------------------------------------------------------------------
function QuestionCard({ question, index }: { question: QuizQuestionResult; index: number }) {
  const maxCount = Math.max(1, ...question.answers.map((a) => a.count));

  return (
    <Card className="elev-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold leading-snug">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold mr-2 shrink-0">
                {index + 1}
              </span>
              {question.questionLabel}
            </CardTitle>
            <CardDescription className="mt-1 text-[11px]">
              {question.uniqueSessions.toLocaleString("pt-BR")} sessões · {question.totalResponses.toLocaleString("pt-BR")} respostas
            </CardDescription>
          </div>
          <Badge variant="info" className="text-[10px] shrink-0">
            {question.answers.length} opções
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2.5">
          {question.answers.map((answer, aIdx) => {
            const color = barColor(aIdx);
            const widthPct = (answer.count / maxCount) * 100;
            return (
              <div key={aIdx} className="space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium truncate pr-3 max-w-[70%]" title={answer.value}>
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
      </CardContent>
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
    const totalQuestions = data.questions.length;
    const totalSessions = data.totalSessions;
    const totalResponses = data.totalResponses;
    const avgAnswersPerSession = totalSessions > 0 ? totalResponses / totalSessions : 0;
    // Taxa de conclusão: % de sessões que responderam à última pergunta vs primeira
    const firstQ = data.questions[0];
    const lastQ = data.questions[data.questions.length - 1];
    const completionRate =
      firstQ && lastQ && firstQ.uniqueSessions > 0
        ? (lastQ.uniqueSessions / firstQ.uniqueSessions) * 100
        : 0;

    return [
      {
        label: "Perguntas no Quiz",
        value: totalQuestions.toString(),
        sub: totalQuestions > 0 ? `${totalQuestions} perguntas configuradas` : "Nenhuma pergunta encontrada",
        icon: ListChecks,
        tone: "text-blue-500",
      },
      {
        label: "Sessões Únicas",
        value: totalSessions.toLocaleString("pt-BR"),
        sub: `Período: ${periodLabel(period)}`,
        icon: Users,
        tone: "text-purple-500",
      },
      {
        label: "Respostas Totais",
        value: totalResponses.toLocaleString("pt-BR"),
        sub: `${avgAnswersPerSession.toFixed(1)} respostas/sessão em média`,
        icon: ChartBarHorizontal,
        tone: "text-cyan-500",
      },
      {
        label: "Taxa de Conclusão",
        value: `${completionRate.toFixed(1)}%`,
        sub: "P1 → última pergunta",
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
      {/* Header com período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Respostas do Quiz</h2>
          <p className="text-sm text-muted-foreground">
            Cada pergunta com suas opções de resposta e porcentagens — sem dados de campanha
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

      {/* Perguntas */}
      {!data || data.questions.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ListChecks size={40} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              Nenhuma resposta de quiz encontrada neste período.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Verifique se o tracker.js está instalado na página do quiz e se há visitantes respondendo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.questions.map((question, idx) => (
            <QuestionCard key={question.questionId} question={question} index={idx} />
          ))}
        </div>
      )}
    </div>
  );
}