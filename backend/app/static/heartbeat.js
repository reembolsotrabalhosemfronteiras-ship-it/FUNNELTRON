// ⚠️ CÓDIGO MORTO — não é importado por nada.
//
// O rastreador que o app realmente usa é `frontend/public/tracker.js`, que
// manda heartbeat para `POST /api/live/track` (o backend fala com o banco; a
// página do funil nunca recebe chave nenhuma). Este arquivo é de uma versão
// anterior que escrevia direto no Supabase pelo navegador — abordagem
// abandonada porque exigiria a chave no HTML de todas as páginas do funil.
//
// Mantido só como referência. Pode ser apagado.
export const HEARTBEAT_SCRIPT = `
(function() {
  'use strict';

  const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE'; // Substituir ao fazer deploy

  const script = document.currentScript;
  const funnelId = script?.dataset?.funnel;

  if (!funnelId) {
    console.warn('[Funneltron] data-funnel não definido no script');
    return;
  }

  // IDs de sessão
  const getSessionId = () => {
    let sid = sessionStorage.getItem('ft_session');
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem('ft_session', sid);
    }
    return sid;
  };

  const getDeviceId = () => {
    let did = localStorage.getItem('ft_device');
    if (!did) {
      did = crypto.randomUUID();
      localStorage.setItem('ft_device', did);
    }
    return did;
  };

  // Extrai UTMs
  const getUtm = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get('utm_source'),
      medium: params.get('utm_medium'),
      campaign: params.get('utm_campaign'),
      content: params.get('utm_content'),
      term: params.get('utm_term')
    };
  };

  // Envia heartbeat
  const beat = () => {
    if (document.visibilityState !== 'visible') return;

    const data = {
      funnel_id: funnelId,
      session_id: getSessionId(),
      device_id: getDeviceId(),
      url: window.location.href,
      referrer: document.referrer || null,
      utm: getUtm()
    };

    // Usando Supabase REST API diretamente
    const payload = JSON.stringify(data);

    navigator.sendBeacon(
      \`\${SUPABASE_URL}/rest/v1/live_beats\`,
      new Blob([payload], {
        type: 'application/json',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        }
      })
    );
  };

  // Batida inicial
  beat();

  // Batida a cada 30s (só se aba visível)
  setInterval(beat, 30000);
})();
`;
