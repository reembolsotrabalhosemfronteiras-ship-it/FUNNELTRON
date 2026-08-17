"""Rate limiter simples para APIs externas (VTurb, Clarity)"""
import time
from collections import defaultdict
from typing import Dict, Tuple


class RateLimiter:
    """
    Token bucket rate limiter.
    Limites por plano (VTurb): Basic 60/min, Pro 120/min, Scale 300/min, Enterprise 800/min
    """

    def __init__(self):
        # provider -> (tokens_disponiveis, ultimo_refill)
        self.buckets: Dict[str, Tuple[float, float]] = defaultdict(lambda: (0, time.time()))

        # Limites por tier
        self.limits = {
            'basic': 60,
            'pro': 120,
            'scale': 300,
            'enterprise': 800
        }

    def check_and_consume(self, provider: str, tier: str = 'basic') -> bool:
        """
        Verifica se há tokens disponíveis e consome um.
        Retorna True se permitido, False se rate limit atingido.
        """
        max_tokens = self.limits.get(tier, 60)
        refill_rate = max_tokens / 60.0  # tokens por segundo

        current_tokens, last_refill = self.buckets[provider]
        now = time.time()

        # Reabastece tokens com base no tempo passado
        elapsed = now - last_refill
        current_tokens = min(max_tokens, current_tokens + elapsed * refill_rate)

        if current_tokens >= 1.0:
            # Consome 1 token
            self.buckets[provider] = (current_tokens - 1.0, now)
            return True
        else:
            # Rate limit atingido
            self.buckets[provider] = (current_tokens, now)
            return False

    def get_wait_time(self, provider: str, tier: str = 'basic') -> float:
        """Retorna quantos segundos faltam até o próximo token ficar disponível"""
        max_tokens = self.limits.get(tier, 60)
        refill_rate = max_tokens / 60.0

        current_tokens, last_refill = self.buckets[provider]
        now = time.time()

        elapsed = now - last_refill
        current_tokens = min(max_tokens, current_tokens + elapsed * refill_rate)

        if current_tokens >= 1.0:
            return 0.0
        else:
            # Tempo até 1 token ficar disponível
            return (1.0 - current_tokens) / refill_rate


# Instância global
rate_limiter = RateLimiter()
