"""Resolução de IP → cidade/UF/lat/lon para o mapa do Ao Vivo.

O IP nunca sai do backend. A resolução usa o serviço gratuito e sem chave
`ip-api.com` (HTTP, ~45 req/min na faixa grátis), com cache agressivo por IP:
o heartbeat repete de 15 em 15s do MESMO IP, então na prática a chamada
externa acontece ~uma vez por visitante a cada `_TTL`. Falha de resolução é
silenciosa — o visitante só não aparece no mapa, nenhuma rota quebra.
"""
from __future__ import annotations

import ipaddress
import logging
import threading
import time
from collections import OrderedDict
from typing import Optional, TypedDict

import httpx

logger = logging.getLogger(__name__)

_ENDPOINT = "http://ip-api.com/json/{ip}"
_FIELDS = "status,message,country,countryCode,regionName,region,city,lat,lon"
_TTL = 12 * 60 * 60  # 12h
_NEGATIVE_TTL = 30 * 60  # não achou / erro: tenta de novo em 30 min
_TIMEOUT = 4.0


class Geo(TypedDict):
    city: str
    uf: str
    lat: float
    lon: float


_cache: OrderedDict[str, tuple[Optional[Geo], float]] = OrderedDict()
_lock = threading.Lock()


def client_ip(headers: dict, fallback: Optional[str]) -> Optional[str]:
    """IP real do visitante, resistente a spoofing de X-Forwarded-For.

    Hierarquia:
    1. ``request.client.host`` (``fallback``) — IP da conexão TCP direta.
       Se for público, é o visitante; confiamos nele e ignoramos XFF, que o
       próprio cliente pode forjar.
    2. ``X-Forwarded-For[0]`` — só quando o direto é privado/loopback,
       indicando que estamos atrás de um proxy confiável (Railway/Render/Fly).
       Nesse caso o primeiro item é o IP real do cliente.
    """
    direct = None
    if fallback:
        try:
            direct = ipaddress.ip_address(fallback)
        except ValueError:
            direct = None

    if direct and (direct.is_private or direct.is_loopback):
        xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
        if xff:
            candidate = xff.split(",")[0].strip()
        else:
            candidate = None
    elif direct:
        candidate = fallback
    else:
        candidate = None

    if not candidate:
        return None
    try:
        ip = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    # IPv6 mapped IPv4 (ex.: ::ffff:1.2.3.4) → usar o IPv4 interno
    if hasattr(ip, "ipv4_mapped") and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        return None
    return str(ip)


def resolve(ip: Optional[str]) -> Optional[Geo]:
    """Cidade/UF/lat/lon do IP, ou None. Cacheado; nunca lança."""
    if not ip:
        return None

    now = time.monotonic()
    with _lock:
        hit = _cache.get(ip)
        if hit is not None and hit[1] > now:
            _cache.move_to_end(ip)
            return hit[0]

    geo: Optional[Geo] = None
    try:
        r = httpx.get(
            _ENDPOINT.format(ip=ip),
            params={"fields": _FIELDS},
            timeout=_TIMEOUT,
        )
        data = r.json()
        if data.get("status") == "success" and data.get("lat") is not None:
            geo = Geo(
                city=data.get("city") or data.get("regionName") or "—",
                uf=(data.get("region") or data.get("countryCode") or "").upper(),
                lat=float(data["lat"]),
                lon=float(data["lon"]),
            )
    except Exception:  # noqa: BLE001 — resolução é best-effort
        logger.debug("Falha ao resolver geo do IP (silencioso)", exc_info=True)

    with _lock:
        _cache[ip] = (geo, now + (_TTL if geo else _NEGATIVE_TTL))
        _cache.move_to_end(ip)
        # Teto (LRU): remove os mais antigos quando excede 20k.
        while len(_cache) > 20000:
            _cache.popitem(last=False)

    return geo
