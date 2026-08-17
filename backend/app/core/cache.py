"""
Cache em memória com teto de tamanho e prazo de validade.

Existe por causa de um custo medido: construir um cliente do Supabase leva
~860 ms (dos quais ~430 ms são CPU pura — o mesmo tempo com uma URL falsa, sem
rede possível). O backend construía um por requisição, e as telas fazem várias
requisições por funil. A aba Geral do Ao Vivo chegava a 4 × N chamadas a cada
5 segundos: mais trabalho por ciclo do que cabe no ciclo.

As chaves aqui são JWTs. Duas consequências que o código respeita:

  - **Nunca logar a chave.** Nem em erro, nem em depuração.
  - **O teto é obrigatório.** Sem ele, cada token novo vira uma entrada que
    nunca sai, e um backend de pé por semanas vaza memória sem parecer que vaza.
"""
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Optional


class TTLCache:
    """
    Cache LRU com expiração por tempo, seguro entre threads.

    Seguro entre threads porque as dependências síncronas do FastAPI rodam num
    pool — duas requisições do mesmo usuário chegam juntas de verdade.
    """

    def __init__(self, maxsize: int, ttl_seconds: float):
        self._data: "OrderedDict[str, tuple[Any, float]]" = OrderedDict()
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._lock = threading.Lock()

    def get_or_create(self, key: str, factory: Callable[[], Any]) -> Any:
        """
        Valor da chave, criando-o na ausência.

        O `factory` roda FORA do lock: ele é a parte cara (centenas de ms), e
        segurá-lo bloquearia todas as outras chaves junto. O preço é que duas
        requisições simultâneas com a mesma chave podem construir duas vezes na
        primeira vez — desperdício pontual, e ninguém fica esperando.
        """
        achado = self.get(key)
        if achado is not None:
            return achado

        valor = factory()

        with self._lock:
            self._data[key] = (valor, time.monotonic() + self._ttl)
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

        return valor

    def get(self, key: str) -> Optional[Any]:
        """Valor válido da chave, ou None se ausente ou vencido."""
        with self._lock:
            entrada = self._data.get(key)
            if entrada is None:
                return None

            valor, vence_em = entrada
            if time.monotonic() >= vence_em:
                del self._data[key]
                return None

            self._data.move_to_end(key)
            return valor

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
