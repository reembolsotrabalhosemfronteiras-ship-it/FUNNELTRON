"""
Agendador em segundo plano — mantém o histórico do rastreador vivo sem
depender de alguém clicar em "Sincronizar".

Só existe um job por enquanto: fechar o snapshot do dia de todos os funis em
`tracker_snapshots`. Roda a cada `INTERVALO_SEGUNDOS` desde a subida do
processo — não é cron de verdade (não sobrevive a reinício), mas como o
snapshot é um upsert por dia, perder um ciclo não perde dado: o próximo ciclo
recalcula o dia inteiro a partir de `live_page_entries`, que é a fonte e é
append-only.
"""
import asyncio
import logging

from ..services.snapshots import capture_all_day_snapshots

logger = logging.getLogger(__name__)

INTERVALO_SEGUNDOS = 30 * 60  # a cada 30 min o dia corrente é recalculado


async def _loop() -> None:
    while True:
        try:
            total = await asyncio.to_thread(capture_all_day_snapshots)
            logger.info("Snapshot diário do rastreador: %d funil(is) atualizados", total)
        except Exception:
            logger.exception("Falha ao capturar snapshots diários do rastreador")

        await asyncio.sleep(INTERVALO_SEGUNDOS)


def start() -> asyncio.Task:
    """Dispara o laço em background; chamado uma vez na subida do app."""
    return asyncio.create_task(_loop())
