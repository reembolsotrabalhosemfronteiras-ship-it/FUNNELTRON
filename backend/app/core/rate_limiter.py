"""Rate limiter simples para APIs externas (VTurb, Clarity)"""
import threading
import time
from typing import Dict, Tuple, Optional


class RateLimiter:
    """
    Token bucket rate limiter.
    Limites por plano (VTurb): Basic 60/min, Pro 120/min, Scale 300/min, Enterprise 800/min

    Thread-safe: FastAPI executa handlers sync num pool de threads, entao o acesso
    ao dict de buckets e serializado por um Lock para evitar race conditions no
    refill + consume.

    ATENCAO: Implementacao em memoria (process-local). Com N workers (ex: gunicorn
    com --workers N), o limite efetivo vira N x limite configurado, pois cada
    processo tem seu proprio RateLimiter. Para ambientes multi-worker, use
    um unico worker (uvicorn sem --workers) ou implemente um backend compartilhado
    (Redis) fora deste modulo.
    """

    # Tempo maximo de inatividade de um bucket antes de ser limpo (24h)
    BUCKET_MAX_IDLE = 24 * 60 * 60

    def __init__(self):
        # provider -> (tokens_disponiveis, ultimo_refill)
        # Inicializado preguiçosamente para comecar com bucket cheio.
        self.buckets: Dict[str, Tuple[float, float]] = {}
        self._lock = threading.Lock()

        # Limites por tier
        self.limits = {
            'basic': 60,
            'pro': 120,
            'scale': 300,
            'enterprise': 800
        }

    def _cleanup_buckets(self, now: float) -> None:
        """Remove buckets ociosos ha mais de BUCKET_MAX_IDLE segundos."""
        stale = [
            k for k, (_, last_refill) in self.buckets.items()
            if now - last_refill > self.BUCKET_MAX_IDLE
        ]
        for k in stale:
            self.buckets.pop(k, None)

    def check_and_consume(self, provider: str, tier: str = 'basic') -> bool:
        """
        Verifica se há tokens disponíveis e consome um.
        Retorna True se permitido, False se rate limit atingido.
        """
        max_tokens = self.limits.get(tier, 60)
        refill_rate = max_tokens / 60.0  # tokens por segundo
        now = time.time()

        with self._lock:
            # Inicializa bucket se necessario (bucket cheio no 1º request)
            if provider not in self.buckets:
                self.buckets[provider] = (max_tokens, now)
            current_tokens, last_refill = self.buckets[provider]

            # Reabastece tokens com base no tempo passado
            elapsed = now - last_refill
            current_tokens = min(max_tokens, current_tokens + elapsed * refill_rate)

            if current_tokens >= 1.0:
                # Consome 1 token
                self.buckets[provider] = (current_tokens - 1.0, now)
                # Limpeza periodica (a cada ~100 chamadas)
                if len(self.buckets) % 100 == 0:
                    self._cleanup_buckets(now)
                return True
            else:
                # Rate limit atingido
                self.buckets[provider] = (current_tokens, now)
                return False

    def get_wait_time(self, provider: str, tier: str = 'basic') -> float:
        """Retorna quantos segundos faltam até o próximo token ficar disponível"""
        max_tokens = self.limits.get(tier, 60)
        refill_rate = max_tokens / 60.0
        now = time.time()

        with self._lock:
            if provider not in self.buckets:
                return 0.0  # bucket novo = cheio
            current_tokens, last_refill = self.buckets[provider]

            elapsed = now - last_refill
            current_tokens = min(max_tokens, current_tokens + elapsed * refill_rate)

        if current_tokens >= 1.0:
            return 0.0
        else:
            # Tempo até 1 token ficar disponível
            return (1.0 - current_tokens) / refill_rate


# Instância global
rate_limiter = RateLimiter()
