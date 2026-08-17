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
 *     endpoint: "https://seu-app.up.railway.app", // default = origem deste .js
 *     interval: 15000,                            // ms entre heartbeats
 *     debug: true,                                // loga falhas no console
 *   };
 *
 * Para conferir se está batendo, abra o console da página do funil:
 *   Funneltron.lastStatus   // 204 = heartbeat aceito
 *   Funneltron.beat()       // dispara um agora
 */
(function () {
  "use strict";

  var cfg = window.Funneltron || {};
  var FUNNEL_ID = cfg.funnelId || "";
  var INTERVAL = cfg.interval || 15000;

  /**
   * Endereço do app. Sem `endpoint` configurado, deduz da própria tag <script>
   * que carregou este arquivo — quem cola
   * `<script src="https://app.exemplo/tracker.js">` já disse onde o app mora, e
   * repetir isso no objeto de config é só mais um lugar para errar.
   *
   * Cair em caminho relativo (comportamento antigo) era o pior padrão possível:
   * o heartbeat ia para o domínio DO FUNIL, que não tem essa rota, e o
   * rastreador ficava mudo sem nenhum aviso.
   */
  function origemDoScript() {
    try {
      var script = document.currentScript;
      if (!script) {
        var todos = document.getElementsByTagName("script");
        for (var i = todos.length - 1; i >= 0; i--) {
          if ((todos[i].src || "").indexOf("tracker.js") !== -1) {
            script = todos[i];
            break;
          }
        }
      }
      if (script && script.src) return new URL(script.src).origin;
    } catch (e) {}
    return "";
  }

  var ENDPOINT = (cfg.endpoint || origemDoScript() || "").replace(/\/$/, "");

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
          // text/plain, e não application/json: com JSON o navegador dispara um
          // preflight OPTIONS antes do POST, e o preflight vinha do domínio do
          // funil — origem que a API não tem como ter cadastrado. text/plain faz
          // o POST virar "requisição simples" e ir direto. O backend lê o corpo
          // cru e faz o parse do JSON na mão.
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(payload),
          keepalive: true,
          credentials: "omit",
        })
          .then(function (r) {
            window.Funneltron.lastStatus = r.status;
          })
          .catch(function (e) {
            // Silencioso por padrão, mas deixa rastro: sem isto, um heartbeat
            // bloqueado é indistinguível de um funil sem visitante.
            window.Funneltron.lastStatus = "erro: " + e;
            if (cfg.debug && window.console) console.warn("[Funneltron]", e);
          });
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
