"""
Teste de fumaça da API inteira.

Exercita cada rota com dado real, na ordem em que o app usa: cria conta, cria
funil, salva o desenho, manda heartbeat do rastreador, lê o ao vivo, importa
venda, salva credencial. É a prova de que os botões da interface têm alguém do
outro lado — teste de rota isolada não mostraria que o fluxo fecha.

Uso:
    .venv\\Scripts\\python.exe smoke_test.py [--base http://127.0.0.1:8000]
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid

import httpx

PASS, FAIL, SKIP = "PASS", "FALHOU", "PULADO"

results: list[tuple[str, str, str]] = []


def record(name: str, status: str, detail: str = "") -> None:
    results.append((name, status, detail))
    mark = {PASS: "[ok]", FAIL: "[XX]", SKIP: "[--]"}[status]
    print(f"{mark} {name}" + (f" — {detail}" if detail else ""))


def check(name: str, response: httpx.Response, expected=(200, 201, 204)) -> bool:
    if response.status_code in expected:
        record(name, PASS, f"{response.status_code}")
        return True
    body = response.text[:180].replace("\n", " ")
    record(name, FAIL, f"{response.status_code} {body}")
    return False


def _create_user_via_admin(email: str, password: str) -> bool:
    """Cria o usuário do teste com a service_role, já com email confirmado."""
    try:
        sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
        from app.core.supabase_client import get_supabase_admin

        admin = get_supabase_admin()
        admin.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"full_name": "Teste Fumaça"},
            }
        )
        return True
    except Exception as exc:  # noqa: BLE001
        record("  criar usuário via admin", FAIL, str(exc)[:160])
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    client = httpx.Client(base_url=args.base, timeout=60.0)
    stamp = uuid.uuid4().hex[:8]

    # -- saúde -------------------------------------------------------------
    health = client.get("/api/health")
    check("GET  /api/health", health)
    storage = health.json().get("storage", "?") if health.status_code == 200 else "?"
    print(f"     armazenamento: {storage}\n")

    # -- guarda de autenticação -------------------------------------------
    unauth = client.get("/api/funnels")
    if unauth.status_code == 401:
        record("GET  /api/funnels sem token devolve 401", PASS)
    else:
        record(
            "GET  /api/funnels sem token devolve 401",
            FAIL,
            f"veio {unauth.status_code} — rota desprotegida",
        )

    # -- conta -------------------------------------------------------------
    # Domínio comum de propósito: `.test` e `.example` são TLDs reservados e o
    # email-validator os rejeita antes mesmo de a requisição sair.
    email = f"smoke.{stamp}@funneltron-smoke.app"
    password = f"Sm0ke!{stamp}"

    # O cadastro é travado por código de acesso (config.signup_invite_code).
    from app.core.config import get_settings

    signup = client.post(
        "/api/auth/signup",
        json={
            "email": email,
            "password": password,
            "full_name": "Teste Fumaça",
            "invite_code": get_settings().signup_invite_code,
        },
    )

    # O cadastro agora nasce já confirmado pela API de admin (nenhum email é
    # enviado), então deve passar direto — inclusive com domínio de teste.
    if signup.status_code in (200, 201):
        record("POST /api/auth/signup", PASS, f"{signup.status_code}")
    else:
        record(
            "POST /api/auth/signup",
            FAIL,
            f"{signup.status_code} {signup.text[:160]}",
        )
        if not _create_user_via_admin(email, password):
            print("\n>> Não foi possível criar o usuário de teste.")
            return summarize()

    login = client.post(
        "/api/auth/login", json={"email": email, "password": password}
    )
    if not check("POST /api/auth/login", login):
        print("\n>> Sem login não dá para testar as rotas protegidas.")
        return summarize()

    token = login.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    # -- funis -------------------------------------------------------------
    created = client.post(
        "/api/funnels",
        headers=auth,
        json={
            "name": f"Funil de Fumaça {stamp}",
            "slug": f"fumaca-{stamp}",
            "status": "active",
            "kind": "front",
        },
    )
    if not check("POST /api/funnels", created):
        return summarize()

    funnel_id = created.json().get("id")
    print(f"     funil: {funnel_id}\n")

    check("GET  /api/funnels", client.get("/api/funnels", headers=auth))
    check(
        "GET  /api/funnels/{id}",
        client.get(f"/api/funnels/{funnel_id}", headers=auth),
    )
    check(
        "PUT  /api/funnels/{id}",
        client.put(
            f"/api/funnels/{funnel_id}",
            headers=auth,
            json={"name": f"Funil de Fumaça {stamp} (renomeado)"},
        ),
    )
    check(
        "PATCH /api/funnels/{id} (status)",
        client.patch(
            f"/api/funnels/{funnel_id}", headers=auth, json={"status": "testing"}
        ),
    )

    # -- desenho do funil --------------------------------------------------
    landing_id = str(uuid.uuid4())
    checkout_id = str(uuid.uuid4())
    thanks_id = str(uuid.uuid4())

    steps = [
        {
            "id": landing_id,
            "label": "Landing",
            "url": "https://exemplo.test/landing",
            "type": "landing",
            "position_x": 0,
            "position_y": 0,
            "order_index": 0,
        },
        {
            "id": checkout_id,
            "label": "Checkout",
            "url": "https://exemplo.test/checkout",
            "type": "checkout",
            "position_x": 320,
            "position_y": 0,
            "order_index": 1,
        },
        {
            "id": thanks_id,
            "label": "Obrigado",
            "url": "https://exemplo.test/obrigado",
            "type": "thank_you",
            "position_x": 640,
            "position_y": 0,
            "order_index": 2,
        },
    ]
    edges = [
        {
            "id": str(uuid.uuid4()),
            "source_step_id": landing_id,
            "target_step_id": checkout_id,
            "condition": "default",
        },
        {
            "id": str(uuid.uuid4()),
            "source_step_id": checkout_id,
            "target_step_id": thanks_id,
            "condition": "default",
        },
    ]

    check(
        "PUT  /api/funnels/{id}/layout",
        client.put(
            f"/api/funnels/{funnel_id}/layout",
            headers=auth,
            json={
                "steps": steps,
                "edges": edges,
                "status": "active",
                "conversion_goal_step_id": thanks_id,
            },
        ),
    )

    got_steps = client.get(f"/api/funnels/{funnel_id}/steps", headers=auth)
    if check("GET  /api/funnels/{id}/steps", got_steps):
        count = len(got_steps.json())
        if count != 3:
            record("  layout salvou as 3 etapas", FAIL, f"voltaram {count}")
        else:
            record("  layout salvou as 3 etapas", PASS)

    got_edges = client.get(f"/api/funnels/{funnel_id}/edges", headers=auth)
    if check("GET  /api/funnels/{id}/edges", got_edges):
        count = len(got_edges.json())
        record(
            "  layout salvou as 2 conexões",
            PASS if count == 2 else FAIL,
            "" if count == 2 else f"voltaram {count}",
        )

    check(
        "POST /api/funnels/{id}/steps (etapa avulsa)",
        client.post(
            f"/api/funnels/{funnel_id}/steps",
            headers=auth,
            json={
                "id": str(uuid.uuid4()),
                "label": "Upsell",
                "url": "https://exemplo.test/upsell",
                "type": "upsell",
                "position_x": 960,
                "position_y": 0,
                "order_index": 3,
            },
        ),
    )

    # -- rastreador ao vivo -------------------------------------------------
    session_id = f"smoke-{stamp}"
    tracked = client.post(
        "/api/live/track",
        json={
            "funnel_id": funnel_id,
            "session_id": session_id,
            "url": "https://exemplo.test/landing",
            "referrer": "https://facebook.com/anuncio",
            "utm": {"source": "facebook", "campaign": "smoke"},
        },
    )
    check("POST /api/live/track (heartbeat, público)", tracked, expected=(200, 204))

    # Segunda página: prova que o log de entradas registra a TROCA de página,
    # e não só a primeira visita da sessão.
    client.post(
        "/api/live/track",
        json={
            "funnel_id": funnel_id,
            "session_id": session_id,
            "url": "https://exemplo.test/checkout",
        },
    )
    time.sleep(1)

    live = client.get(f"/api/live?funnel_id={funnel_id}", headers=auth)
    if check("GET  /api/live", live):
        online = sum(item.get("online", 0) for item in live.json())
        record(
            "  heartbeat aparece como pessoa online",
            PASS if online >= 1 else FAIL,
            f"online={online}",
        )

    entries = client.get(
        f"/api/live/entries?funnel_id={funnel_id}&window=30&limit=10", headers=auth
    )
    if check("GET  /api/live/entries", entries):
        rows = entries.json()
        record(
            "  log registrou as 2 páginas visitadas",
            PASS if len(rows) >= 2 else FAIL,
            f"{len(rows)} entrada(s)",
        )
        if rows:
            step_named = all(r.get("stepId") for r in rows)
            record(
                "  entrada casou com a etapa pela URL",
                PASS if step_named else FAIL,
                "" if step_named else "stepId nulo — trigger da URL não resolveu",
            )

    check(
        "GET  /api/live/conversion (janela)",
        client.get(
            f"/api/live/conversion?funnel_id={funnel_id}&window=30", headers=auth
        ),
    )
    check(
        "GET  /api/live/conversion?scope=today",
        client.get(
            f"/api/live/conversion?funnel_id={funnel_id}&scope=today", headers=auth
        ),
    )
    check(
        "GET  /api/live/sales",
        client.get(f"/api/live/sales?funnel_id={funnel_id}&window=60", headers=auth),
    )
    check(
        "GET  /api/live/vsl",
        client.get(f"/api/live/vsl?funnel_id={funnel_id}&minutes=5", headers=auth),
    )
    check(
        "GET  /api/live/active-funnels",
        client.get("/api/live/active-funnels", headers=auth),
    )

    # -- webhook de venda ---------------------------------------------------
    check(
        "POST /api/live/webhook (venda paga)",
        client.post(
            "/api/live/webhook",
            json={
                "funnel_id": funnel_id,
                "status": "paid",
                "amount": 297.0,
                "customer": "cliente@exemplo.test",
                "url": "https://exemplo.test/checkout",
            },
        ),
        expected=(200, 201, 202, 204),
    )

    # -- métricas -----------------------------------------------------------
    check(
        "GET  /api/metrics/overview",
        client.get("/api/metrics/overview?period=30d", headers=auth),
    )
    check(
        "GET  /api/metrics/funnels/ranking",
        client.get("/api/metrics/funnels/ranking?period=30d", headers=auth),
    )
    check("GET  /api/metrics/vsl", client.get("/api/metrics/vsl?period=30d", headers=auth))
    check(
        "GET  /api/metrics/funnels/{id}",
        client.get(f"/api/metrics/funnels/{funnel_id}", headers=auth),
    )
    check(
        "GET  /api/metrics/overview (intervalo de datas)",
        client.get(
            "/api/metrics/overview?from_date=2026-08-01&to_date=2026-08-17",
            headers=auth,
        ),
    )

    # -- importações --------------------------------------------------------
    # Mesmo formato que `saveImport()` do frontend manda.
    created_import = client.post(
        "/api/imports",
        headers=auth,
        json={
            "filename": "vendas-fumaca.csv",
            "imported_at": "2026-08-17T12:00:00Z",
            "row_count": 3,
            "detected_columns": {
                "headers": ["data", "valor", "status"],
                "delimiter": ",",
            },
            "raw_data": {"sampleRows": [["2026-08-17", "297", "paid"]]},
        },
    )
    check("POST /api/imports", created_import)
    check("GET  /api/imports", client.get("/api/imports", headers=auth))
    if created_import.status_code in (200, 201):
        import_id = created_import.json().get("id")
        if import_id:
            check(
                "DELETE /api/imports/{id}",
                client.delete(f"/api/imports/{import_id}", headers=auth),
            )

    # -- captura de print ---------------------------------------------------
    shot = client.post(
        "/api/screenshots",
        headers=auth,
        json={"url": "https://example.com", "step_id": landing_id},
    )
    if check("POST /api/screenshots", shot):
        body = shot.json()
        if body.get("ok"):
            record("  print capturado e guardado", PASS, body.get("screenshotUrl", "")[:70])
        else:
            # Não é falha do teste: sem navegador do Playwright ou sem bucket, o
            # backend responde `ok: false` com o motivo — que é o comportamento
            # certo. O que seria falha é fingir sucesso.
            record("  print capturado e guardado", SKIP, body.get("reason", "")[:110])

    # -- integrações --------------------------------------------------------
    # Mesmo formato que `saveCredentials()` do frontend manda.
    check(
        "POST /api/integrations/credentials",
        client.post(
            "/api/integrations/credentials",
            headers=auth,
            json={
                "provider": "vturb",
                "api_token": f"token-fumaca-{stamp}",
                "rate_limit_tier": "basic",
            },
        ),
    )
    creds = client.get("/api/integrations/credentials", headers=auth)
    if check("GET  /api/integrations/credentials", creds):
        leaked = f"token-fumaca-{stamp}" in creds.text
        record(
            "  token volta mascarado, não em claro",
            FAIL if leaked else PASS,
            "TOKEN VAZANDO NA RESPOSTA" if leaked else "",
        )

    # -- isolamento entre contas --------------------------------------------
    # Regressão de um bug real: o cliente do Supabase era cacheado e guardava a
    # sessão de quem tinha autenticado por último. Bastava um segundo usuário
    # logar para as consultas do primeiro rodarem com a identidade errada — a
    # lista de funis dele voltava vazia, e numa rota sem filtro explícito de
    # dono voltaria com dado alheio.
    other_email = f"smoke.outro.{stamp}@funneltron-smoke.app"
    if _create_user_via_admin(other_email, password):
        other_login = client.post(
            "/api/auth/login", json={"email": other_email, "password": password}
        )
        if other_login.status_code == 200:
            other_auth = {
                "Authorization": f"Bearer {other_login.json()['access_token']}"
            }

            # O segundo usuário não pode ver o funil do primeiro...
            others = client.get("/api/funnels", headers=other_auth)
            leaked = any(
                f.get("id") == funnel_id for f in (others.json() or [])
            )
            record(
                "conta B não enxerga o funil da conta A",
                FAIL if leaked else PASS,
                "VAZAMENTO DE DADOS" if leaked else "",
            )

            # ...e o primeiro continua vendo o próprio, mesmo depois do login
            # do segundo. É aqui que o bug antigo aparecia.
            mine = client.get("/api/funnels", headers=auth)
            still_mine = any(
                f.get("id") == funnel_id for f in (mine.json() or [])
            )
            record(
                "conta A continua vendo o próprio funil após login da B",
                PASS if still_mine else FAIL,
                "" if still_mine else "sessão trocada entre requisições",
            )

            # Acesso direto ao funil alheio tem que dar 404.
            direct = client.get(f"/api/funnels/{funnel_id}", headers=other_auth)
            record(
                "conta B recebe 404 ao pedir o funil da A pelo id",
                PASS if direct.status_code == 404 else FAIL,
                f"veio {direct.status_code}",
            )

            # -- workspaces: trocador de conta + compartilhamento ----------
            ws_probe = client.get("/api/workspaces", headers=auth)
            if ws_probe.status_code == 200 and not ws_probe.json():
                # Usuário do teste nasce via admin, sem o bootstrap do signup —
                # cria o workspace pessoal na mão pra exercitar o fluxo.
                client.post("/api/workspaces", headers=auth, json={"name": f"A pessoal {stamp}"})
            ws_list = client.get("/api/workspaces", headers=auth)
            if ws_list.status_code == 200 and ws_list.json():
                ws = ws_list.json()
                a_ws_id = ws[0]["id"]
                record(
                    "conta A tem 1 workspace pessoal (backfill 009)",
                    PASS if len(ws) >= 1 and ws[0].get("role") == "owner" else FAIL,
                    f"{len(ws)} workspace(s)",
                )

                # A cria um segundo workspace e volta a ter 2.
                new_ws = client.post(
                    "/api/workspaces", headers=auth, json={"name": f"WS Fumaça {stamp}"}
                )
                if check("POST /api/workspaces", new_ws):
                    again = client.get("/api/workspaces", headers=auth)
                    record(
                        "conta A passa a ver 2 workspaces",
                        PASS if len(again.json()) == len(ws) + 1 else FAIL,
                        f"{len(again.json())}",
                    )

                # Um funil criado JÁ com o workspace pessoal ativo (o funnel_id
                # lá de cima nasceu antes de A ter workspace — é legado nulo).
                ws_funnel = client.post(
                    "/api/funnels",
                    headers={**auth, "X-Workspace-Id": a_ws_id},
                    json={"name": f"Funil WS {stamp}", "slug": f"fws-{stamp}",
                          "status": "active", "kind": "front"},
                )
                ws_funnel_id = ws_funnel.json().get("id") if ws_funnel.status_code in (200, 201) else None

                # A convida B para o workspace pessoal dela.
                invited = client.post(
                    f"/api/workspaces/{a_ws_id}/members",
                    headers=auth,
                    json={"email": other_email},
                )
                check("POST /api/workspaces/{id}/members (convida B)", invited)

                # B agora enxerga o workspace de A na lista.
                b_ws = client.get("/api/workspaces", headers=other_auth)
                sees_shared = any(w["id"] == a_ws_id for w in (b_ws.json() or []))
                record(
                    "conta B passa a ver o workspace compartilhado de A",
                    PASS if sees_shared else FAIL,
                    "" if sees_shared else "convite não apareceu para B",
                )

                # B, com o workspace de A ativo, enxerga o funil de A.
                shared_hdr = {**other_auth, "X-Workspace-Id": a_ws_id}
                shared_funnels = client.get("/api/funnels", headers=shared_hdr)
                sees_funnel = any(
                    f.get("id") == ws_funnel_id for f in (shared_funnels.json() or [])
                )
                record(
                    "conta B vê o funil de A no workspace compartilhado",
                    PASS if sees_funnel else FAIL,
                    "" if sees_funnel else "compartilhamento não propagou aos funis",
                )

                # B ganha um workspace próprio (no app real vem do signup) e,
                # sem header, o padrão cai nele — não no de A.
                client.post(
                    "/api/workspaces", headers=other_auth, json={"name": f"B pessoal {stamp}"}
                )
                own = client.get("/api/funnels", headers=other_auth)
                bleeds = any(f.get("id") == ws_funnel_id for f in (own.json() or []))
                record(
                    "conta B não vê o funil de A fora do workspace compartilhado",
                    FAIL if bleeds else PASS,
                    "VAZAMENTO ENTRE WORKSPACES" if bleeds else "",
                )

                # B (member, não owner) não pode convidar ninguém.
                b_invite = client.post(
                    f"/api/workspaces/{a_ws_id}/members",
                    headers=shared_hdr,
                    json={"email": f"terceiro.{stamp}@funneltron-smoke.app"},
                )
                record(
                    "member (B) não pode convidar no workspace de A",
                    PASS if b_invite.status_code in (403, 401) else FAIL,
                    f"veio {b_invite.status_code}",
                )
            else:
                record(
                    "workspaces (migration 009)",
                    SKIP,
                    "GET /api/workspaces vazio — 009 não rodou ou modo legado",
                )

    # -- limpeza ------------------------------------------------------------
    try:
        if ws_funnel_id:
            client.delete(f"/api/funnels/{ws_funnel_id}", headers=auth)
    except NameError:
        pass
    check(
        "DELETE /api/funnels/{id}",
        client.delete(f"/api/funnels/{funnel_id}", headers=auth),
    )
    check("POST /api/auth/logout", client.post("/api/auth/logout", headers=auth))

    return summarize()


def summarize() -> int:
    passed = sum(1 for _, s, _ in results if s == PASS)
    failed = [r for r in results if r[1] == FAIL]

    print("\n" + "=" * 70)
    print(f"{passed} passaram, {len(failed)} falharam, {len(results)} no total")

    if failed:
        print("\nFalhas:")
        for name, _, detail in failed:
            print(f"  - {name}: {detail}")
        return 1

    print("\nTudo verde.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
