import { useEffect, useState } from "react";
import { Bell, BellRinging as BellRing } from "@phosphor-icons/react";
import { Button } from "./Button";
import {
  disablePush,
  enablePush,
  pushPreviouslyEnabled,
  pushSupported,
} from "@/lib/push";

/**
 * Botão de "Ativar notificações": inscreve o navegador em Web Push para
 * receber "PIX gerado"/"PIX pago" como notificação nativa do Windows
 * mesmo com a aba em segundo plano ou fechada. Some sozinho quando o
 * navegador não suporta ou o backend não tem VAPID configurado — não faz
 * sentido oferecer um botão que sempre falha.
 */
export function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(pushPreviouslyEnabled());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSupported(pushSupported());
  }, []);

  if (!supported) return null;

  const toggle = async () => {
    setLoading(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
      } else {
        const result = await enablePush();
        if (result === "enabled") setEnabled(true);
        else if (result === "unsupported") setSupported(false);
        // "denied" — usuário recusou no prompt do navegador; nada a fazer,
        // ele mesmo pode reverter nas configurações do site.
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={enabled ? "secondary" : "outline"}
      size="sm"
      loading={loading}
      onClick={toggle}
      title={
        enabled
          ? "Notificações de PIX ativadas — clique para desativar"
          : "Ativar notificação do Windows quando gerar/pagar um PIX"
      }
    >
      {enabled ? <BellRing size={14} /> : <Bell size={14} />}
      {enabled ? "Notificações ativas" : "Ativar notificações"}
    </Button>
  );
}
