// Service worker só para Web Push. Sem cache de assets de propósito: um SW
// que também faz cache-first vira dor de cabeça pra sempre servir build
// velho depois de deploy — aqui a única responsabilidade é ouvir push do SO
// e, se alguma aba do app estiver em primeiro plano, repassar pra ela em vez
// de mostrar notificação nativa duplicada.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "FUNNELTRON", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "FUNNELTRON";
  const url = data.url || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = windows.find((c) => c.focused);

      // Aba em primeiro plano: manda pro app renderizar o toast in-app em
      // vez de duplicar com a notificação nativa do Windows.
      if (focused) {
        focused.postMessage({
          type: "funneltron:push",
          title,
          body: data.body || "",
          url,
        });
        return;
      }

      await self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag || "funneltron-sale",
        // Nova venda com a mesma tag substitui a anterior na central de
        // notificações em vez de empilhar uma por evento.
        renotify: true,
        data: { url },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) {
          client.focus();
          client.navigate ? client.navigate(url) : null;
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
