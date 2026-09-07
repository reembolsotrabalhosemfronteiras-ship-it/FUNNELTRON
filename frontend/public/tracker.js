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

  // Persiste UTM da primeira página visitada na sessão (first-touch).
  // Sobrevive a navegações internas onde a URL perde os UTMs originais.
  var FIRST_UTM_KEY = "funneltron:first_utm";
  var firstUtm = null;
  try {
    var storedFirst = sessionStorage.getItem(FIRST_UTM_KEY);
    if (storedFirst) {
      firstUtm = JSON.parse(storedFirst);
    } else if (utm) {
      firstUtm = utm;
      sessionStorage.setItem(FIRST_UTM_KEY, JSON.stringify(utm));
    }
  } catch (e) {}

  var pendingUrl = null;

  /**
   * Identidade da visualização de página atual.
   *
   * Um MESMO event_id vale para todos os heartbeats da mesma página. É o que
   * permite ao backend gravar a entrada em página uma vez só: o navegador
   * reenvia o mesmo beat sozinho (retry de rede, sendBeacon no fechamento da
   * aba, volta de aba em segundo plano), e sem chave de evento cada reenvio
   * virava uma entrada nova — inflando o topo do funil com gente que nunca
   * existiu.
   *
   * Troca só quando a URL troca, que é exatamente quando existe entrada nova.
   */
  var eventId = null;
  var eventUrl = null;

  function eventIdAtual(url) {
    if (url !== eventUrl) {
      eventUrl = url;
      eventId =
        "evt_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 10);
    }
    return eventId;
  }

  /** Corpo do heartbeat. Um lugar só — o beforeunload manda o mesmo formato. */
  function montarPayload(comReferrer) {
    var url = window.location.href;
    return {
      funnel_id: FUNNEL_ID,
      session_id: sessionId,
      device_id: deviceId,
      event_id: eventIdAtual(url),
      url: url,
      referrer: comReferrer ? document.referrer || null : null,
      utm: utm,
      first_utm: firstUtm,
    };
  }

  /** Envia um heartbeat agora. */
  function beat() {
    try {
      var payload = montarPayload(true);
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

  function stop() {
    clearInterval(timer);
  }

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
          JSON.stringify(montarPayload(false))
        );
    } catch (e) {}
  });

  /**
   * Propaga `click_id=<sessionId>` para os links de saída da página (ex: o
   * botão que leva ao checkout). É o gancho que fecha o círculo até o
   * webhook: gateways como a PerfectPay têm um placeholder {click_id} na
   * URL de postback que eles preenchem com o valor desse parâmetro — assim
   * o backend sabe, ao receber a venda, de qual sessão/step ela veio.
   *
   * SÓ adiciona em links INTERNOS (mesmo hostname da página atual).
   * Links externos (checkout de terceiros, redes sociais, etc.) NÃO recebem
   * o click_id — evitar vazamento de session_id para domínios externos.
   *
   * Só adiciona se o link ainda não tiver click_id (não sobrescreve um
   * click_id de anúncio que já esteja lá) e não mexe em nenhum outro
   * parâmetro — utm_*, fbclid, gclid etc. continuam intocados.
   */
  function propagarClickId() {
    try {
      var links = document.getElementsByTagName("a");
      var currentHost = window.location.hostname;
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var href = a.getAttribute("href");
        if (!href || href.indexOf("#") === 0 || href.indexOf("javascript:") === 0) continue;
        // Só links internos: mesmo hostname
        try {
          var linkUrl = new URL(href, window.location.origin);
          if (linkUrl.hostname !== currentHost) continue;
        } catch (e) {
          // URL relativa (./page, ../page, /checkout) ou malformada — trata como EXTERNA
          continue;
        }
        if (href.indexOf("click_id=") !== -1) continue;
        var sep = href.indexOf("?") === -1 ? "?" : "&";
        a.setAttribute("href", href + sep + "click_id=" + encodeURIComponent(sessionId));
      }
    } catch (e) {}
  }

  propagarClickId();
  // Reaplica quando o DOM muda (SPA, checkout carregado async) sem precisar
  // rebater a cada intervalo — MutationObserver só quando o navegador tem.
  try {
    if (window.MutationObserver) {
      new MutationObserver(propagarClickId).observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  } catch (e) {}

  /**
   * Hash determinístico simples para gerar IDs estáveis a partir de texto.
   * Não precisa ser criptográfico — só consistente entre sessões.
   */
  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Detecta elementos de quiz e extrai dados do clique.
   * Prioridade: data-attributes explícitos > heurística por classe/estrutura.
   */
  function extrairQuizDoElemento(el) {
    var questionId = null;
    var answerId = null;
    var answerValue = null;

    // 1) Data-attributes explícitos (prioritários)
    var q = el.closest('[data-funneltron-question]');
    if (q) {
      questionId = q.getAttribute('data-funneltron-question');
    }
    var a = el.closest('[data-funneltron-answer]');
    if (a) {
      answerId = a.getAttribute('data-funneltron-answer');
      answerValue = a.getAttribute('data-funneltron-answer-value') || a.getAttribute('value') || a.textContent?.trim() || null;
    }

    // 2) Fallback heurístico universal: detecta perguntas por estrutura DOM
    // Escuta button, input[radio/checkbox], select, [role=button] dentro de
    // containers que parecem ser uma pergunta (h2/h3/.question/.pergunta ou "?")
    if (!questionId || !answerId) {
      var quizContainer = el.closest('.quiz, .pergunta, [data-quiz], .question, .typebot-input-container, .tf-card');
      if (!quizContainer) {
        // Busca container com heading ou "?" próximo ao elemento clicado
        var parent = el.parentElement;
        for (var i = 0; i < 5 && parent; i++) {
          var hasHeading = parent.querySelector('h2, h3, h4, .question-title, .pergunta-titulo');
          var hasQuestionMark = parent.textContent && parent.textContent.indexOf('?') !== -1;
          if (hasHeading || hasQuestionMark) {
            quizContainer = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (quizContainer) {
        if (!questionId) {
          var heading = quizContainer.querySelector('h2, h3, h4, .question-title, .pergunta-titulo');
          var qText = heading ? heading.textContent.trim() : null;
          questionId = quizContainer.getAttribute('data-quiz') ||
                       quizContainer.getAttribute('id') ||
                       (qText ? 'q_' + simpleHash(qText) : null) ||
                       quizContainer.className?.match(/(?:quiz|pergunta|question)[-\s]?(\w+)/)?.[1] ||
                       'quiz_' + Math.random().toString(36).slice(2, 8);
        }
        if (!answerId) {
          if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) {
            answerId = el.value || el.name || el.id || 'input_' + Math.random().toString(36).slice(2, 8);
            answerValue = el.value || el.nextElementSibling?.textContent?.trim() || el.parentElement?.textContent?.trim() || null;
          } else if (el.tagName === 'SELECT') {
            answerId = el.name || el.id || 'select_' + Math.random().toString(36).slice(2, 8);
            answerValue = el.options[el.selectedIndex]?.value || el.options[el.selectedIndex]?.text || null;
          } else if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.type === 'button' || el.type === 'submit') {
            answerId = el.getAttribute('data-value') || el.id || 'btn_' + Math.random().toString(36).slice(2, 8);
            answerValue = el.getAttribute('data-value') || el.textContent?.trim() || el.value || null;
          } else if (el.tagName === 'LABEL') {
            var inp = el.querySelector('input[type=radio], input[type=checkbox]') || document.getElementById(el.getAttribute('for'));
            if (inp) {
              answerId = inp.value || inp.name || inp.id || 'label_' + Math.random().toString(36).slice(2, 8);
              answerValue = inp.value || el.textContent?.trim() || null;
            }
          } else if (el.tagName === 'A' || el.onclick) {
            // Links ou elementos clicáveis genéricos como resposta
            answerId = el.getAttribute('data-value') || el.id || 'link_' + Math.random().toString(36).slice(2, 8);
            answerValue = el.getAttribute('data-value') || el.textContent?.trim() || null;
          }
        }
      }
    }

    if (questionId && answerId) {
      return {
        question_id: questionId,
        answer_id: answerId,
        answer_value: answerValue
      };
    }
    return null;
  }

  /**
   * Envia evento de resposta de quiz para o backend.
   * Usa o mesmo endpoint e formato do heartbeat, com event_type='quiz_answer'.
   */
  function trackQuiz(quizData) {
    try {
      var url = window.location.href;
      var payload = {
        funnel_id: FUNNEL_ID,
        session_id: sessionId,
        device_id: deviceId,
        event_id: eventIdAtual(url),
        url: url,
        referrer: document.referrer || null,
        utm: utm,
        first_utm: firstUtm,
        event_type: 'quiz_answer',
        question_id: quizData.question_id,
        answer_id: quizData.answer_id,
        answer_value: quizData.answer_value,
        timestamp: new Date().toISOString()
      };

      var trackUrl = ENDPOINT ? ENDPOINT + "/api/live/track" : "/api/live/track";
      if (window.fetch) {
        fetch(trackUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(payload),
          keepalive: true,
          credentials: "omit",
        }).catch(function (e) {
          if (cfg.debug && window.console) console.warn("[Funneltron] quiz track error:", e);
        });
      } else {
        navigator.sendBeacon && navigator.sendBeacon(trackUrl, JSON.stringify(payload));
      }
    } catch (e) {
      if (cfg.debug && window.console) console.warn("[Funneltron] quiz track error:", e);
    }
  }

  /**
   * Delegação de evento para cliques em elementos de quiz.
   * Captura cliques em: buttons, inputs radio, labels, elementos com data-funneltron-answer.
   */
  function initQuizTracking() {
    var quizSelectors = [
      '[data-funneltron-answer]',
      '[data-funneltron-question] [data-funneltron-answer-value]',
      '.quiz button, .quiz input[type=radio], .quiz label',
      '.pergunta button, .pergunta input[type=radio], .pergunta label',
      '[data-quiz] button, [data-quiz] input[type=radio], [data-quiz] label'
    ].join(', ');

    document.addEventListener('click', function (e) {
      var target = e.target;
      var match = target.closest(quizSelectors);
      if (!match) return;

      var quizData = extrairQuizDoElemento(match);
      if (quizData) {
        trackQuiz(quizData);
      }
    }, true); // useCapture=true para pegar antes de outros handlers
  }

  // Inicia tracking de quiz quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQuizTracking);
  } else {
    initQuizTracking();
  }

  /**
   * Auto-detect universal de formulários de contato.
   * Captura nome/email de qualquer form com input[type=email] ou campos
   * comuns de nome (name, nome, full_name, etc). Similar ao auto-detect de
   * quiz: funciona sem data-attributes, por heurística de estrutura DOM.
   *
   * Envia event_type='contact_form' no próximo heartbeat — não dispara
   * requisição extra, só anota os campos no payload do beat seguinte.
   */
  var pendingContact = null;

  function initContactFormTracking() {
    var emailSelectors = 'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]';
    var nameSelectors = 'input[name*="name" i], input[id*="name" i], input[name="nome"], input[id="nome"], input[name="full_name"], input[name="fullname"]';

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;

      var emailEl = form.querySelector(emailSelectors);
      var nameEl = form.querySelector(nameSelectors);

      if (!emailEl && !nameEl) return;

      var contactName = nameEl ? (nameEl.value || '').trim() : null;
      var contactEmail = emailEl ? (emailEl.value || '').trim() : null;

      if (!contactName && !contactEmail) return;

      pendingContact = {
        contact_name: contactName || null,
        contact_email: contactEmail || null,
      };

      // Envia imediatamente para não perder se o usuário fechar a aba
      // antes do próximo heartbeat.
      try {
        var url = window.location.href;
        var payload = montarPayload(false);
        payload.event_type = 'contact_form';
        payload.contact_name = contactName;
        payload.contact_email = contactEmail;

        var trackUrl = ENDPOINT ? ENDPOINT + "/api/live/track" : "/api/live/track";
        if (window.fetch) {
          fetch(trackUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: JSON.stringify(payload),
            keepalive: true,
            credentials: "omit",
          }).catch(function (err) {
            if (cfg.debug && window.console) console.warn("[Funneltron] contact track error:", err);
          });
        } else {
          navigator.sendBeacon && navigator.sendBeacon(trackUrl, JSON.stringify(payload));
        }
      } catch (err) {
        if (cfg.debug && window.console) console.warn("[Funneltron] contact track error:", err);
      }
    }, true);

    // Também captura blur em campos de email fora de forms (SPAs, popups).
    document.addEventListener('blur', function (e) {
      var el = e.target;
      if (!el || el.tagName !== 'INPUT') return;
      var isEmail = el.type === 'email' ||
                    (el.name || '').toLowerCase().indexOf('email') !== -1 ||
                    (el.id || '').toLowerCase().indexOf('email') !== -1;
      if (!isEmail) return;

      var val = (el.value || '').trim();
      if (!val || val.indexOf('@') === -1) return;

      // Busca campo de nome próximo no mesmo container
      var container = el.closest('form') || el.parentElement;
      var nameEl = container ? container.querySelector(nameSelectors) : null;
      var nameVal = nameEl ? (nameEl.value || '').trim() : null;

      pendingContact = {
        contact_name: nameVal || null,
        contact_email: val,
      };
    }, true);
  }

  // Inicia tracking de formulários quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContactFormTracking);
  } else {
    initContactFormTracking();
  }

  // Expõe p/ debug/manual flush.
  window.Funneltron = Object.assign({}, cfg, {
    sessionId: sessionId,
    deviceId: deviceId,
    beat: beat,
    stop: stop,
    trackQuiz: trackQuiz
  });
})();
