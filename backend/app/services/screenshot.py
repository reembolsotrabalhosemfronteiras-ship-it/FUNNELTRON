"""
Captura de print de página.

Dois caminhos, nesta ordem:

1. **Playwright local** (padrão). Abre um Chromium headless, tira o print e
   guarda. Não custa nada e não depende de terceiro.
2. **API externa** (ScreenshotOne), se `SCREENSHOT_API_KEY` estiver definida.
   Serve para produção sem navegador instalado — a Vercel, por exemplo, não
   roda Chromium numa função serverless.

Antes só existia o caminho 2, o que deixava o botão "capturar print" morto
para quem não assina o serviço: ele respondia sempre "não configurado".
"""
import asyncio
import re
from pathlib import Path
from typing import Optional

import httpx

from ..core.config import get_settings
from ..core.supabase_client import get_supabase_admin, is_local_mode, LOCAL_DATA_DIR

VIEWPORT = {"width": 1280, "height": 800}

# Um print por vez em fila de 3: abrir um Chromium por página de um funil de 20
# páginas ao mesmo tempo derruba a máquina.
_semaphore = asyncio.Semaphore(3)


class ScreenshotService:
    def __init__(self):
        self.settings = get_settings()
        self.api_url = self.settings.screenshot_api_url
        self.api_key = self.settings.screenshot_api_key

    async def capture_screenshot(self, url: str, step_id: str) -> dict:
        """
        Returns:
            {"ok": True, "screenshotUrl": "..."} ou
            {"ok": False, "reason": "mensagem legível"}
        """
        async with _semaphore:
            if self.api_key:
                image = await self._via_api(url)
            else:
                image = await self._via_playwright(url)

        if isinstance(image, dict):  # veio erro
            return image

        return self._store(image, step_id)

    # -- captura ------------------------------------------------------------

    async def _via_playwright(self, url: str):
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return {
                "ok": False,
                "reason": "Playwright não instalado no backend. Rode "
                          "`pip install playwright && playwright install chromium`, "
                          "ou cole o print manualmente.",
            }

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                try:
                    page = await browser.new_page(viewport=VIEWPORT)
                    # `domcontentloaded` e não `networkidle`: página de vendas
                    # costuma ter pixel de rastreamento que nunca "assenta", e
                    # a espera estouraria o timeout em página que já carregou.
                    await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                    await page.wait_for_timeout(1_500)  # deixa a dobra renderizar
                    return await page.screenshot(type="png")
                finally:
                    await browser.close()
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if "Executable doesn't exist" in message or "playwright install" in message:
                return {
                    "ok": False,
                    "reason": "O navegador do Playwright não está instalado. "
                              "Rode `playwright install chromium` na pasta backend.",
                }
            return {"ok": False, "reason": f"Não consegui abrir a página: {message[:180]}"}

    async def _via_api(self, url: str):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    self.api_url,
                    params={
                        "access_key": self.api_key,
                        "url": url,
                        "viewport_width": VIEWPORT["width"],
                        "viewport_height": VIEWPORT["height"],
                        "format": "png",
                        "full_page": False,
                        "block_ads": True,
                        "block_cookie_banners": True,
                        "cache": True,
                        "cache_ttl": 2592000,
                    },
                )
                if response.status_code != 200:
                    return {
                        "ok": False,
                        "reason": f"Serviço de screenshot respondeu HTTP {response.status_code}",
                    }
                return response.content
        except httpx.TimeoutException:
            return {
                "ok": False,
                "reason": "Timeout ao capturar o print. A página pode estar muito lenta.",
            }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": f"Erro ao capturar o print: {str(exc)[:180]}"}

    # -- armazenamento ------------------------------------------------------

    def _store(self, image: bytes, step_id: str) -> dict:
        file_path = f"{step_id}.png"

        try:
            if is_local_mode():
                target = LOCAL_DATA_DIR / "storage" / "screenshots" / file_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(image)
                return {"ok": True, "screenshotUrl": f"/static/screenshots/{file_path}"}

            # Chave de serviço: o upload é feito PELO servidor, sem sessão de
            # usuário. Com a chave anon o Storage recusa por RLS ("new row
            # violates row-level security policy") mesmo com o bucket criado.
            supabase = get_supabase_admin()
            supabase.storage.from_("screenshots").upload(
                file_path,
                image,
                {"content-type": "image/png", "upsert": "true"},
            )
            return {
                "ok": True,
                "screenshotUrl": supabase.storage.from_("screenshots").get_public_url(
                    file_path
                ),
            }
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if "Bucket not found" in message or "bucket" in message.lower():
                return {
                    "ok": False,
                    "reason": "O bucket `screenshots` não existe no Supabase Storage. "
                              "Crie-o (público) no painel → Storage.",
                }
            return {"ok": False, "reason": f"Print capturado, mas não consegui guardar: {message[:160]}"}


    # -- VTurb player id -----------------------------------------------------

    async def find_vturb_player_id(self, url: str) -> dict:
        """
        Baixa o HTML da página e procura o player id do VTurb sozinho, pros
        casos comuns de embed:

        1. `<vturb-smartplayer id="vid-<ID>" ...>` (custom element, o mais comum)
        2. `.../players/<ID>/...` no `src` do script do player
        3. `id="vid-<ID>"` solto, quando o embed não usa o custom element

        Returns: {"ok": True, "playerId": str} ou {"ok": False, "reason": str}
        """
        try:
            # User-Agent de navegador de verdade: identificar-se como bot
            # ("FunneltronBot/1.0") fazia páginas atrás de Cloudflare/anti-bot
            # comum responderem 403 — mesmo sendo o dono lendo a própria
            # página de vendas, não um scraper de terceiro.
            async with httpx.AsyncClient(
                timeout=15.0,
                follow_redirects=True,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/131.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
                },
            ) as client:
                response = await client.get(url)
                if response.status_code != 200:
                    return {
                        "ok": False,
                        "reason": f"A página respondeu HTTP {response.status_code}",
                    }
                html = response.text
        except httpx.TimeoutException:
            return {"ok": False, "reason": "Timeout ao abrir a página."}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": f"Não consegui abrir a página: {str(exc)[:180]}"}

        patterns = [
            r"vturb-smartplayer[^>]*id=[\"']vid-([a-f0-9]{10,})[\"']",
            r"converteai\.net/[^\"']*/players/([a-f0-9]{10,})/",
            r"id=[\"']vid-([a-f0-9]{10,})[\"']",
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                return {"ok": True, "playerId": match.group(1)}

        return {
            "ok": False,
            "reason": "Não achei nenhum player VTurb nessa página. Confira se a URL "
                      "está certa e se o vídeo já está publicado (o embed às vezes "
                      "só aparece depois de um scroll/clique, e a busca só lê o HTML "
                      "que já vem pronto).",
        }


# Instância global
screenshot_service = ScreenshotService()
