import { describe, it, expect } from "vitest";
import { computeStats, estimateVslConversionFromTracker } from "./funnelStats";
import type { FunnelStep, StepMetric, FunnelEdge } from "@/types";

function step(id: string, orderIndex: number, type: FunnelStep["type"] = "other"): FunnelStep {
  return {
    id,
    funnelId: "f1",
    label: id,
    url: `https://x.test/${id}`,
    type,
    positionX: 0,
    positionY: 0,
    parentStepId: null,
    orderIndex,
  };
}

function metric(stepId: string, visitors: number): StepMetric {
  return {
    id: `${stepId}-metric`,
    funnelId: "f1",
    stepId,
    date: "2026-01-01",
    visitors,
    conversions: 0,
    conversionRate: 0,
    source: "tracker",
  };
}

describe("computeStats", () => {
  it("visitors = entrantes da primeira etapa, não a soma de pageviews de todas as etapas", () => {
    // Este era o bug que confundia "39.6%" com "495" — visitors somava
    // TODAS as etapas (contando a mesma pessoa várias vezes), enquanto a
    // taxa dividia pela entrada. Agora os dois usam a mesma base.
    const steps = [step("home", 0), step("t1", 1), step("t2", 2)];
    const metrics = [metric("home", 53), metric("t1", 41), metric("t2", 36)];
    const stats = computeStats(null, steps, metrics);
    expect(stats.visitors).toBe(53);
  });

  it("conversions = quem chegou na última etapa, não a soma de conversões por etapa", () => {
    const steps = [step("home", 0), step("t1", 1), step("fim", 2)];
    const metrics = [metric("home", 53), metric("t1", 41), metric("fim", 21)];
    const stats = computeStats(null, steps, metrics);
    expect(stats.conversions).toBe(21);
  });

  it("avgRate = entrada até a última etapa, ponta a ponta", () => {
    const steps = [step("home", 0), step("fim", 1)];
    const metrics = [metric("home", 100), metric("fim", 25)];
    const stats = computeStats(null, steps, metrics);
    expect(stats.avgRate).toBe(25);
  });

  it("avgRate é 0 quando não há entrada, nunca divide por zero", () => {
    const steps = [step("home", 0), step("fim", 1)];
    const stats = computeStats(null, steps, []);
    expect(stats.avgRate).toBe(0);
    expect(stats.visitors).toBe(0);
  });

  it("purchaseRate exige salesCount real — não cai de volta para visita de página", () => {
    // Bug fixado: antes purchaseRate usava visitantes da página de obrigado,
    // então "chegar na página" contava como "comprou" mesmo sem pagamento.
    const steps = [step("home", 0), step("obrigado", 1, "thank_you")];
    const metrics = [metric("home", 50), metric("obrigado", 30)];

    const semVendas = computeStats(null, steps, metrics);
    expect(semVendas.purchaseRate).toBeNull();

    const comVendas = computeStats(null, steps, metrics, 5);
    expect(comVendas.purchaseRate).toBe(10); // 5 vendas / 50 entradas
  });

  it("purchaseRate não usa visitantes da página de obrigado no cálculo", () => {
    // 30 pessoas chegaram na página de obrigado, mas só 2 pagaram de verdade.
    const steps = [step("home", 0), step("obrigado", 1, "thank_you")];
    const metrics = [metric("home", 50), metric("obrigado", 30)];
    const stats = computeStats(null, steps, metrics, 2);
    expect(stats.purchaseRate).toBe(4); // 2/50, não 30/50 (60%)
  });
});

describe("estimateVslConversionFromTracker", () => {
  it("ignora etapas VSL sem visitantes ou sem próxima etapa", () => {
    const steps = [step("home", 0), step("vsl1", 1, "vsl")];
    const edges: FunnelEdge[] = [];
    const metrics = [metric("home", 10), metric("vsl1", 5)];
    const result = estimateVslConversionFromTracker(steps, edges, metrics);
    expect(result.count).toBe(0);
    expect(result.avgConversion).toBeNull();
  });

  it("calcula conversão de vídeo → próxima página usando o rastreador, sem VTurb", () => {
    const steps = [step("home", 0), step("vsl1", 1, "vsl"), step("pergunta1", 2)];
    const edges: FunnelEdge[] = [
      { id: "e1", funnelId: "f1", sourceStepId: "vsl1", targetStepId: "pergunta1", condition: "default", label: "" },
    ];
    const metrics = [metric("home", 30), metric("vsl1", 30), metric("pergunta1", 9)];
    const result = estimateVslConversionFromTracker(steps, edges, metrics);
    expect(result.count).toBe(1);
    expect(result.avgConversion).toBe(30); // 9/30 = 30%
  });
});
