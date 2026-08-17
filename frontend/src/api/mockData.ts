import type {
  Funnel,
  FunnelStep,
  FunnelEdge,
  StepMetric,
  VslInsight,
  FunnelComparisonRow,
  OverviewMetrics,
  Period,
} from "@/types";

import type { LiveVslData, LiveStepData } from "./client";

// ---------------------------------------------------------------------------
// DADOS MOCKADOS — quando o backend estiver pronto, trocar `api/client.ts`
// para fazer fetch em `/api/...`. A forma dos objetos já espelha o schema.
// ---------------------------------------------------------------------------

export const MOCK_FUNNELS: Funnel[] = [
  {
    id: "f1",
    name: "Webinar Tráfego Pago",
    slug: "webinar-trafego",
    status: "active",
    baseUrl: "https://exemplo.com/webinar",
    createdAt: "2026-07-01T10:00:00Z",
    updatedAt: "2026-08-10T10:00:00Z",
    kind: "front",
  },
  {
    id: "f2",
    name: "Lançamento Infoproduto",
    slug: "lancamento-info",
    status: "testing",
    baseUrl: "https://exemplo.com/lancamento",
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-08-12T10:00:00Z",
    kind: "front",
  },
  {
    id: "f3",
    name: "Funil Consultoria",
    slug: "consultoria",
    status: "inactive",
    baseUrl: "https://exemplo.com/consultoria",
    createdAt: "2026-06-10T10:00:00Z",
    updatedAt: "2026-07-30T10:00:00Z",
    kind: "front",
  },
  {
    id: "f4",
    name: "Black Friday 2026",
    slug: "bf-2026",
    status: "active",
    baseUrl: "https://exemplo.com/bf",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-14T10:00:00Z",
    kind: "front",
  },
  // Funis de upsell: desenhados no mesmo ateliê, mas reaproveitáveis dentro
  // de qualquer funil de front como um bloco só.
  {
    id: "u1",
    name: "Upsell Mentoria 12x",
    slug: "upsell-mentoria",
    status: "active",
    baseUrl: "https://exemplo.com/upsell-mentoria",
    createdAt: "2026-07-05T10:00:00Z",
    updatedAt: "2026-08-15T10:00:00Z",
    kind: "upsell",
  },
  {
    id: "u2",
    name: "Upsell Vitalício",
    slug: "upsell-vitalicio",
    status: "testing",
    baseUrl: "https://exemplo.com/upsell-vitalicio",
    createdAt: "2026-08-02T10:00:00Z",
    updatedAt: "2026-08-15T10:00:00Z",
    kind: "upsell",
  },
];

const placeholderImg = (seed: string) =>
  `https://picsum.photos/seed/${seed}/640/400`;

export const MOCK_STEPS: Record<string, FunnelStep[]> = {
  f1: [
    {
      id: "s1",
      funnelId: "f1",
      label: "Landing Page",
      url: "https://exemplo.com/webinar",
      type: "landing",
      positionX: 0,
      positionY: 0,
      parentStepId: null,
      orderIndex: 0,
      screenshotUrl: placeholderImg("f1-landing"),
    },
    {
      id: "s2",
      funnelId: "f1",
      label: "VSL (Vídeo)",
      url: "https://exemplo.com/webinar/vsl",
      type: "vsl",
      positionX: 320,
      positionY: 0,
      parentStepId: "s1",
      orderIndex: 1,
      screenshotUrl: placeholderImg("f1-vsl"),
    },
    {
      id: "s3",
      funnelId: "f1",
      label: "Checkout",
      url: "https://exemplo.com/webinar/checkout",
      type: "checkout",
      positionX: 640,
      positionY: 0,
      parentStepId: "s2",
      orderIndex: 2,
      screenshotUrl: placeholderImg("f1-checkout"),
    },
    {
      id: "s4",
      funnelId: "f1",
      label: "Upsell 1",
      url: "https://exemplo.com/webinar/upsell",
      type: "upsell",
      positionX: 960,
      positionY: -120,
      parentStepId: "s3",
      orderIndex: 3,
      screenshotUrl: placeholderImg("f1-upsell"),
    },
    {
      id: "s5",
      funnelId: "f1",
      label: "Order Bump",
      url: "https://exemplo.com/webinar/bump",
      type: "order_bump",
      positionX: 960,
      positionY: 120,
      parentStepId: "s3",
      orderIndex: 4,
      screenshotUrl: placeholderImg("f1-bump"),
    },
    {
      id: "s6",
      funnelId: "f1",
      label: "Obrigado",
      url: "https://exemplo.com/webinar/obrigado",
      type: "thank_you",
      positionX: 1280,
      positionY: 0,
      parentStepId: "s3",
      orderIndex: 5,
      screenshotUrl: placeholderImg("f1-thanks"),
    },
    // Segunda VSL do mesmo funil — a do upsell. Um funil pode ter várias.
    {
      id: "s7",
      funnelId: "f1",
      label: "VSL do Upsell",
      url: "https://exemplo.com/webinar/upsell/vsl",
      type: "vsl",
      positionX: 960,
      positionY: -280,
      parentStepId: "s3",
      orderIndex: 6,
      screenshotUrl: placeholderImg("f1-vsl-upsell"),
    },
  ],
  f2: [
    {
      id: "s21",
      funnelId: "f2",
      label: "Landing",
      url: "https://exemplo.com/lancamento",
      type: "landing",
      positionX: 0,
      positionY: 0,
      parentStepId: null,
      orderIndex: 0,
      screenshotUrl: placeholderImg("f2-landing"),
    },
    {
      id: "s22",
      funnelId: "f2",
      label: "VSL",
      url: "https://exemplo.com/lancamento/vsl",
      type: "vsl",
      positionX: 320,
      positionY: 0,
      parentStepId: "s21",
      orderIndex: 1,
      screenshotUrl: placeholderImg("f2-vsl"),
    },
    {
      id: "s23",
      funnelId: "f2",
      label: "Checkout",
      url: "https://exemplo.com/lancamento/checkout",
      type: "checkout",
      positionX: 640,
      positionY: 0,
      parentStepId: "s22",
      orderIndex: 2,
      screenshotUrl: placeholderImg("f2-checkout"),
    },
    {
      id: "s24",
      funnelId: "f2",
      label: "Downsell",
      url: "https://exemplo.com/lancamento/downsell",
      type: "downsell",
      positionX: 960,
      positionY: 120,
      parentStepId: "s23",
      orderIndex: 3,
      screenshotUrl: placeholderImg("f2-down"),
    },
  ],
  f3: [
    {
      id: "s31",
      funnelId: "f3",
      label: "Landing",
      url: "https://exemplo.com/consultoria",
      type: "landing",
      positionX: 0,
      positionY: 0,
      parentStepId: null,
      orderIndex: 0,
      screenshotUrl: placeholderImg("f3-landing"),
    },
    {
      id: "s32",
      funnelId: "f3",
      label: "VSL",
      url: "https://exemplo.com/consultoria/vsl",
      type: "vsl",
      positionX: 320,
      positionY: 0,
      parentStepId: "s31",
      orderIndex: 1,
      screenshotUrl: placeholderImg("f3-vsl"),
    },
  ],
  f4: [
    {
      id: "s41",
      funnelId: "f4",
      label: "Landing BF",
      url: "https://exemplo.com/bf",
      type: "landing",
      positionX: 0,
      positionY: 0,
      parentStepId: null,
      orderIndex: 0,
      screenshotUrl: placeholderImg("f4-landing"),
    },
    {
      id: "s42",
      funnelId: "f4",
      label: "VSL Oferta",
      url: "https://exemplo.com/bf/vsl",
      type: "vsl",
      positionX: 320,
      positionY: 0,
      parentStepId: "s41",
      orderIndex: 1,
      screenshotUrl: placeholderImg("f4-vsl"),
    },
    {
      id: "s43",
      funnelId: "f4",
      label: "Checkout",
      url: "https://exemplo.com/bf/checkout",
      type: "checkout",
      positionX: 640,
      positionY: 0,
      parentStepId: "s42",
      orderIndex: 2,
      screenshotUrl: placeholderImg("f4-checkout"),
    },
  ],
  u1: [
    { id: "us1", funnelId: "u1", label: "Oferta Mentoria", url: "https://exemplo.com/upsell-mentoria", type: "upsell", positionX: 0, positionY: 0, parentStepId: null, orderIndex: 0, screenshotUrl: placeholderImg("u1-oferta") },
    { id: "us2", funnelId: "u1", label: "VSL da Mentoria", url: "https://exemplo.com/upsell-mentoria/vsl", type: "vsl", positionX: 320, positionY: 0, parentStepId: "us1", orderIndex: 1, screenshotUrl: placeholderImg("u1-vsl") },
    { id: "us3", funnelId: "u1", label: "Downsell 6x", url: "https://exemplo.com/upsell-mentoria/downsell", type: "downsell", positionX: 640, positionY: 140, parentStepId: "us2", orderIndex: 2, screenshotUrl: placeholderImg("u1-down") },
    { id: "us4", funnelId: "u1", label: "Obrigado Mentoria", url: "https://exemplo.com/upsell-mentoria/obrigado", type: "thank_you", positionX: 640, positionY: -60, parentStepId: "us2", orderIndex: 3, screenshotUrl: placeholderImg("u1-thanks") },
  ],
  u2: [
    { id: "uv1", funnelId: "u2", label: "Oferta Vitalício", url: "https://exemplo.com/upsell-vitalicio", type: "upsell", positionX: 0, positionY: 0, parentStepId: null, orderIndex: 0, screenshotUrl: placeholderImg("u2-oferta") },
    { id: "uv2", funnelId: "u2", label: "Obrigado Vitalício", url: "https://exemplo.com/upsell-vitalicio/obrigado", type: "thank_you", positionX: 320, positionY: 0, parentStepId: "uv1", orderIndex: 1, screenshotUrl: placeholderImg("u2-thanks") },
  ],
};

export const MOCK_EDGES: Record<string, FunnelEdge[]> = {
  f1: [
    { id: "e1", funnelId: "f1", sourceStepId: "s1", targetStepId: "s2", condition: "default", label: "" },
    { id: "e2", funnelId: "f1", sourceStepId: "s2", targetStepId: "s3", condition: "default", label: "" },
    { id: "e3", funnelId: "f1", sourceStepId: "s3", targetStepId: "s4", condition: "on_accept", label: "Ao aceitar" },
    { id: "e4", funnelId: "f1", sourceStepId: "s3", targetStepId: "s5", condition: "on_bump", label: "Com Bump" },
    { id: "e5", funnelId: "f1", sourceStepId: "s3", targetStepId: "s6", condition: "default", label: "" },
    { id: "e6", funnelId: "f1", sourceStepId: "s7", targetStepId: "s4", condition: "on_accept", label: "Ao aceitar" },
  ],
  f2: [
    { id: "e21", funnelId: "f2", sourceStepId: "s21", targetStepId: "s22", condition: "default", label: "" },
    { id: "e22", funnelId: "f2", sourceStepId: "s22", targetStepId: "s23", condition: "default", label: "" },
    { id: "e23", funnelId: "f2", sourceStepId: "s23", targetStepId: "s24", condition: "on_decline", label: "Ao recusar" },
  ],
  f3: [
    { id: "e31", funnelId: "f3", sourceStepId: "s31", targetStepId: "s32", condition: "default", label: "" },
  ],
  f4: [
    { id: "e41", funnelId: "f4", sourceStepId: "s41", targetStepId: "s42", condition: "default", label: "" },
    { id: "e42", funnelId: "f4", sourceStepId: "s42", targetStepId: "s43", condition: "default", label: "" },
  ],
  u1: [
    { id: "ue1", funnelId: "u1", sourceStepId: "us1", targetStepId: "us2", condition: "default", label: "" },
    { id: "ue2", funnelId: "u1", sourceStepId: "us2", targetStepId: "us4", condition: "on_accept", label: "Ao aceitar" },
    { id: "ue3", funnelId: "u1", sourceStepId: "us2", targetStepId: "us3", condition: "on_decline", label: "Ao recusar" },
  ],
  u2: [
    { id: "uf1", funnelId: "u2", sourceStepId: "uv1", targetStepId: "uv2", condition: "on_accept", label: "Ao aceitar" },
  ],
};

// Métricas por etapa (funil f1) — base para conversão por etapa
export const MOCK_STEP_METRICS: Record<string, StepMetric[]> = {
  f1: [
    { id: "m1", funnelId: "f1", stepId: "s1", date: "2026-08-14", visitors: 12000, conversions: 5400, conversionRate: 45.0, source: "clarity" },
    { id: "m2", funnelId: "f1", stepId: "s2", date: "2026-08-14", visitors: 5400, conversions: 2100, conversionRate: 38.9, source: "vturb" },
    { id: "m3", funnelId: "f1", stepId: "s3", date: "2026-08-14", visitors: 2100, conversions: 420, conversionRate: 20.0, source: "clarity" },
    { id: "m4", funnelId: "f1", stepId: "s4", date: "2026-08-14", visitors: 420, conversions: 150, conversionRate: 35.7, source: "clarity" },
    { id: "m5", funnelId: "f1", stepId: "s5", date: "2026-08-14", visitors: 2100, conversions: 630, conversionRate: 30.0, source: "clarity" },
    { id: "m6", funnelId: "f1", stepId: "s6", date: "2026-08-14", visitors: 420, conversions: 420, conversionRate: 100, source: "clarity" },
    { id: "m7", funnelId: "f1", stepId: "s7", date: "2026-08-14", visitors: 420, conversions: 150, conversionRate: 35.7, source: "vturb" },
  ],
  f2: [
    { id: "m21", funnelId: "f2", stepId: "s21", date: "2026-08-14", visitors: 3100, conversions: 1180, conversionRate: 38.1, source: "clarity" },
    { id: "m22", funnelId: "f2", stepId: "s22", date: "2026-08-14", visitors: 1180, conversions: 261, conversionRate: 22.1, source: "vturb" },
    { id: "m23", funnelId: "f2", stepId: "s23", date: "2026-08-14", visitors: 261, conversions: 68, conversionRate: 26.1, source: "clarity" },
    { id: "m24", funnelId: "f2", stepId: "s24", date: "2026-08-14", visitors: 193, conversions: 21, conversionRate: 10.9, source: "clarity" },
  ],
  f3: [
    { id: "m31", funnelId: "f3", stepId: "s31", date: "2026-08-14", visitors: 6300, conversions: 1260, conversionRate: 20.0, source: "clarity" },
    { id: "m32", funnelId: "f3", stepId: "s32", date: "2026-08-14", visitors: 1260, conversions: 189, conversionRate: 15.0, source: "vturb" },
  ],
  f4: [
    { id: "m41", funnelId: "f4", stepId: "s41", date: "2026-08-14", visitors: 8800, conversions: 4840, conversionRate: 55.0, source: "clarity" },
    { id: "m42", funnelId: "f4", stepId: "s42", date: "2026-08-14", visitors: 4840, conversions: 2144, conversionRate: 44.3, source: "vturb" },
    { id: "m43", funnelId: "f4", stepId: "s43", date: "2026-08-14", visitors: 2144, conversions: 1240, conversionRate: 57.8, source: "clarity" },
  ],
  u1: [
    { id: "mu1", funnelId: "u1", stepId: "us1", date: "2026-08-14", visitors: 1240, conversions: 868, conversionRate: 70.0, source: "clarity" },
    { id: "mu2", funnelId: "u1", stepId: "us2", date: "2026-08-14", visitors: 868, conversions: 295, conversionRate: 34.0, source: "vturb" },
    { id: "mu3", funnelId: "u1", stepId: "us3", date: "2026-08-14", visitors: 573, conversions: 92, conversionRate: 16.1, source: "clarity" },
    { id: "mu4", funnelId: "u1", stepId: "us4", date: "2026-08-14", visitors: 295, conversions: 295, conversionRate: 100, source: "clarity" },
  ],
  u2: [
    { id: "mv1", funnelId: "u2", stepId: "uv1", date: "2026-08-14", visitors: 420, conversions: 71, conversionRate: 16.9, source: "clarity" },
    { id: "mv2", funnelId: "u2", stepId: "uv2", date: "2026-08-14", visitors: 71, conversions: 71, conversionRate: 100, source: "clarity" },
  ],
};

// Insights de VSL vindos da VTurb (dashboard geral)
// Um funil pode ter várias VSLs — cada uma amarrada à sua etapa pelo `stepId`.
export const MOCK_VSL: VslInsight[] = [
  { id: "v1", name: "VSL Webinar Tráfego", funnelId: "f1", funnelName: "Webinar Tráfego Pago", stepId: "s2", engagementRate: 62.4, conversionRate: 38.9, views: 5400, completions: 3370, source: "vturb" },
  { id: "v1b", name: "VSL do Upsell", funnelId: "f1", funnelName: "Webinar Tráfego Pago", stepId: "s7", engagementRate: 48.1, conversionRate: 35.7, views: 420, completions: 202, source: "vturb" },
  { id: "v2", name: "VSL Lançamento", funnelId: "f2", funnelName: "Lançamento Infoproduto", stepId: "s22", engagementRate: 51.2, conversionRate: 22.1, views: 3100, completions: 1587, source: "vturb" },
  { id: "v3", name: "VSL Oferta BF", funnelId: "f4", funnelName: "Black Friday 2026", stepId: "s42", engagementRate: 71.8, conversionRate: 44.3, views: 8800, completions: 6322, source: "vturb" },
  { id: "v4", name: "VSL Consultoria", funnelId: "f3", funnelName: "Funil Consultoria", stepId: "s32", engagementRate: 40.5, conversionRate: 15.0, views: 900, completions: 365, source: "vturb" },
  { id: "v5", name: "VSL da Mentoria", funnelId: "u1", funnelName: "Upsell Mentoria 12x", stepId: "us2", engagementRate: 58.3, conversionRate: 34.0, views: 868, completions: 506, source: "vturb" },
];

export const MOCK_OVERVIEW: OverviewMetrics = {
  totalFunnels: 4,
  activeFunnels: 2,
  testingFunnels: 1,
  inactiveFunnels: 1,
  totalVisitors: 30200,
  totalConversions: 4320,
  avgConversionRate: 14.3,
  estRevenue: 486500,
};

export const MOCK_COMPARISON: FunnelComparisonRow[] = [
  { id: "f4", name: "Black Friday 2026", status: "active", visitors: 8800, conversions: 1240, conversionRate: 14.1, trend: 8.2, source: "clarity" },
  { id: "f1", name: "Webinar Tráfego Pago", status: "active", visitors: 12000, conversions: 1470, conversionRate: 12.3, trend: 3.1, source: "clarity" },
  { id: "f2", name: "Lançamento Infoproduto", status: "testing", visitors: 3100, conversions: 290, conversionRate: 9.4, trend: -1.5, source: "vturb" },
  { id: "f3", name: "Funil Consultoria", status: "inactive", visitors: 6300, conversions: 320, conversionRate: 5.1, trend: -4.0, source: "clarity" },
];

// --- Dados "Ao Vivo" (mock) ---

export const MOCK_LIVE_VSL: Record<string, LiveVslData[]> = {
  f1: [
    { stepId: "s2", playerId: "player_s2", label: "VSL (Vídeo)", liveUsers: 34, domain: "exemplo.com", windowMinutes: 5 },
    { stepId: "s7", playerId: "player_s7", label: "VSL do Upsell", liveUsers: 8, domain: "exemplo.com", windowMinutes: 5 },
  ],
  f2: [
    { stepId: "s22", playerId: "player_s22", label: "VSL", liveUsers: 21, domain: "exemplo.com", windowMinutes: 5 },
  ],
  f4: [
    { stepId: "s42", playerId: "player_s42", label: "VSL Oferta", liveUsers: 67, domain: "exemplo.com", windowMinutes: 5 },
  ],
  f3: [
    { stepId: "s32", playerId: "player_s32", label: "VSL", liveUsers: 12, domain: "exemplo.com", windowMinutes: 5 },
  ],
};

export const MOCK_LIVE_FLOW: Record<string, LiveStepData[]> = {
  f1: [
    { stepId: "s1", online: 18 },
    { stepId: "s2", online: 9 },
    { stepId: "s3", online: 4 },
    { stepId: "s4", online: 2 },
    { stepId: "s5", online: 3 },
    { stepId: "s6", online: 1 },
    { stepId: "s7", online: 0 },
  ],
  f2: [
    { stepId: "s21", online: 7 },
    { stepId: "s22", online: 3 },
    { stepId: "s23", online: 1 },
    { stepId: "s24", online: 0 },
  ],
  f4: [
    { stepId: "s41", online: 24 },
    { stepId: "s42", online: 11 },
    { stepId: "s43", online: 6 },
  ],
  f3: [
    { stepId: "s31", online: 5 },
    { stepId: "s32", online: 2 },
  ],
};
