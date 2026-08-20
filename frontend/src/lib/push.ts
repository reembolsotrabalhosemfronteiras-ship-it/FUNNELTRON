/**
 * Web Push: registra o service worker, pede permissão e inscreve o
 * navegador para receber notificação nativa mesmo com a aba fechada.
 *
 * Guardado tudo atrás de checagens de suporte — o app continua funcionando
 * normalmente (só sem push) em navegadores sem Service Worker/Push API, ou
 * quando o backend não tem VAPID configurado.
 */
import { getVapidPublicKey, subscribePush, unsubscribePush } from "@/api/client";

const PERMISSION_KEY = "funil-analytics:push-enabled";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Já pediu e o usuário aceitou numa sessão anterior — reinscreve sem perguntar de novo. */
export function pushPreviouslyEnabled(): boolean {
  return localStorage.getItem(PERMISSION_KEY) === "1";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Pede permissão de notificação e cria a inscrição push no backend. */
export async function enablePush(): Promise<"enabled" | "denied" | "unsupported"> {
  if (!pushSupported()) return "unsupported";

  const publicKey = await getVapidPublicKey().catch(() => "");
  if (!publicKey) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return "unsupported";
  }

  await subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });

  localStorage.setItem(PERMISSION_KEY, "1");
  return "enabled";
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem(PERMISSION_KEY);
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await unsubscribePush(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/** Reinscreve em silêncio quando o usuário já tinha ativado antes — chamar no boot do app. */
export async function resumePushIfEnabled(): Promise<void> {
  if (!pushPreviouslyEnabled() || !pushSupported()) return;
  if (Notification.permission !== "granted") return;
  await enablePush().catch(() => undefined);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

/** Ouve o postMessage que o service worker manda quando chega push com a aba em foco. */
export function onPushMessage(handler: (msg: PushMessage) => void): () => void {
  if (!pushSupported()) return () => undefined;
  const listener = (event: MessageEvent) => {
    if (event.data?.type === "funneltron:push") {
      handler({ title: event.data.title, body: event.data.body, url: event.data.url });
    }
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
