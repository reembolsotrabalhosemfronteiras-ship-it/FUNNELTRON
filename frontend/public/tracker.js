/*!
 * Funneltron — Rastreador de funil (snippet standalone)
 * -------------------------------------------------------
 * Cole este arquivo (ou o <script> equivalente) no <head> das páginas
 * do seu funil. Ele dispara heartbeats a cada 15s para POST /api/live/track,
 * populando a tabela live_beats (o step_id é resolvido pela URL no banco).
 *
 * Configuração (obrigatório): substitua FUNNEL_ID abaixo.
 *   window.Funneltron = { funnelId: "uuid-do-funil" };
 *
 * Configuração opcional:
 *   window.Funneltron = {
 *     funnelId: "uuid",
 *     endpoint: "https://sua-api.vercel.app", // default = mesma origem
 *     interval: 15000,                          // ms entre heartbeats
 *   };
 */
(function () {
  "use strict";

  var cfg = window.Funneltron || {};
  var FUNNEL_ID = cfg.funnelId || "";
  var ENDPOINT = (cfg.endpoint || "").replace(/\/$/, "");
  var INTERVAL = cfg.interval || 15000;

  if (!FUNNEL_ID) {
    if (window.console) console.warn("[Funneltron] funnelId ausente — rastreador desativado.");
    return;
  }

  // Session ID estável por visitante (survive reload dentro da sessão do navegador).
  var SESSION_KEY = "funneltron:sid";
  var sessionId;
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = "sid_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch (e) {
    // sessionStorage bloqueado (modo privado) — gera efêmero
    sessionId = "sid_" + Date.now().toString(36);
  }

  // Device ID persistente entre sessões (opcional, p/ dedupe cross-session).
  var deviceId;
  try {
    deviceId = localStorage.getItem("funneltron:did");
    if (!deviceId) {
      deviceId = "did_" + Math.random().toString(36).slice(2, 12);
      localStorage.setItem("funneltron:did", deviceId);
    }
  } catch (e) {}

  /** Extrai UTM da query string quando presente. */
  function getUtm() {
    var params = {};
    try {
      var sp = new URLSearchParams(window.location.search);
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
        var v = sp.get(k);
        if (v) params[k] = v;
      });
    } catch (e) {}
    return Object.keys(params).length ? params : null;
  }

  var utm = getUtm();
  var pendingUrl = null;

  /** Envia um heartbeat agora. */
  function beat() {
    try {
      var payload = {
        funnel_id: FUNNEL_ID,
        session_id: sessionId,
        device_id: deviceId,
        url: window.location.href,
        referrer: document.referrer || null,
        utm: utm,
      };
      pendingUrl = payload.url;

      var url = ENDPOINT ? ENDPOINT + "/api/live/track" : "/api/live/track";
      if (window.fetch) {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
          credentials: "omit",
        }).catch(function () {});
      } else {
        // Fallback beacon p/ navegadores antigos
        try {
          navigator.sendBeacon && navigator.sendBeacon(url, JSON.stringify(payload));
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Heartbeat imediato + intervalo fixo.
  beat();
  var timer = setInterval(beat, INTERVAL);

  // Re-bate ao voltar pra aba (visibility) e ao navegar (SPA).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") beat();
  });

  // Disconexão limpa: último heartbeat via sendBeacon (fire-and-forget).
  window.addEventListener("beforeunload", function () {
    try {
      navigator.sendBeacon &&
        navigator.sendBeacon(
          ENDPOINT ? ENDPOINT + "/api/live/track" : "/api/live/track",
          JSON.stringify({
            funnel_id: FUNNEL_ID,
            session_id: sessionId,
            device_id: deviceId,
            url: window.location.href,
            referrer: null,
            utm: utm,
          })
        );
    } catch (e) {}
  });

  // Expõe p/ debug/manual flush.
  window.Funneltron = Object.assign({}, cfg, {
    sessionId: sessionId,
    deviceId: deviceId,
    beat: beat,
  });
})();
