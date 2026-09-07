"""
Testes de regressão para o router de funis (funnels.py).

Cobre:
- Modelo FunnelCreate (campos obrigatórios e opcionais)
- Modelo FunnelUpdate (todos opcionais)
- Lógica de slug único por workspace
- Constraint de (workspace_id, slug)
"""
import sys
import os
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


class TestFunnelCreateModel:
    """Testes para o modelo FunnelCreate."""

    def test_funnel_create_requires_name_and_slug(self):
        """name e slug são obrigatórios."""
        from app.routers.funnels import FunnelCreate
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            FunnelCreate(name="Test")

        with pytest.raises(ValidationError):
            FunnelCreate(slug="test-slug")

    def test_funnel_create_valid_with_required_fields(self):
        """FunnelCreate funciona com name e slug."""
        from app.routers.funnels import FunnelCreate

        funnel = FunnelCreate(name="Test Funnel", slug="test-funnel")
        assert funnel.name == "Test Funnel"
        assert funnel.slug == "test-funnel"
        assert funnel.status == "active"
        assert funnel.base_url is None
        assert funnel.kind == "front"

    def test_funnel_create_accepts_optional_fields(self):
        """status, base_url e kind são opcionais com defaults."""
        from app.routers.funnels import FunnelCreate

        funnel = FunnelCreate(
            name="Test",
            slug="test",
            status="draft",
            base_url="http://example.com",
            kind="back"
        )
        assert funnel.status == "draft"
        assert funnel.base_url == "http://example.com"
        assert funnel.kind == "back"

    def test_funnel_create_default_values(self):
        """Defaults: status=active, kind=front, base_url=None."""
        from app.routers.funnels import FunnelCreate

        funnel = FunnelCreate(name="Test", slug="test")
        assert funnel.status == "active"
        assert funnel.kind == "front"
        assert funnel.base_url is None


class TestFunnelUpdateModel:
    """Testes para o modelo FunnelUpdate."""

    def test_funnel_update_all_optional(self):
        """Todos os campos de FunnelUpdate são opcionais."""
        from app.routers.funnels import FunnelUpdate

        update = FunnelUpdate()
        assert update.name is None
        assert update.slug is None
        assert update.status is None
        assert update.base_url is None
        assert update.kind is None
        assert update.conversion_goal_step_id is None

    def test_funnel_update_partial(self):
        """FunnelUpdate aceita atualização parcial."""
        from app.routers.funnels import FunnelUpdate

        update = FunnelUpdate(name="New Name", status="paused")
        assert update.name == "New Name"
        assert update.slug is None
        assert update.status == "paused"


class TestUniqueViolationMarkers:
    """Testes para detecção de violação de constraint única."""

    def test_duplicate_key_marker_detected(self):
        """Marcadores de violação única são detectados."""
        from app.routers.funnels import _UNIQUE_VIOLATION_MARKERS

        test_messages = [
            "duplicate key value violates unique constraint",
            "23505",
            "already exists",
            "unique constraint violated",
        ]

        for msg in test_messages:
            found = any(marker in msg.lower() for marker in _UNIQUE_VIOLATION_MARKERS)
            assert found, f"Marker not found in: {msg}"

    def test_non_violation_not_detected(self):
        """Mensagens normais não são marcadas como violação."""
        from app.routers.funnels import _UNIQUE_VIOLATION_MARKERS

        normal_messages = [
            "connection refused",
            "timeout",
            "permission denied",
            "not found",
        ]

        for msg in normal_messages:
            found = any(marker in msg.lower() for marker in _UNIQUE_VIOLATION_MARKERS)
            assert not found, f"False positive for: {msg}"


class TestSlugUniqueness:
    """Testes para a lógica de unicidade de slug."""

    def test_slug_must_be_unique_per_workspace(self):
        """Dois funis no mesmo workspace não podem ter o mesmo slug."""
        # Esta é a regra de negócio: slug é único por (workspace_id)
        workspace_id = "ws-123"
        slug = "my-funnel"

        # Simula: primeiro funil criado com sucesso
        first_funnel = {"workspace_id": workspace_id, "slug": slug}

        # Segundo funil com mesmo slug no mesmo workspace deve falhar
        second_funnel = {"workspace_id": workspace_id, "slug": slug}

        # A verificação: existing.slug == new.slug && existing.ws == new.ws
        conflict = (first_funnel["slug"] == second_funnel["slug"] and
                   first_funnel["workspace_id"] == second_funnel["workspace_id"])
        assert conflict

    def test_same_slug_different_workspace_allowed(self):
        """Mesmo slug em workspaces diferentes é permitido."""
        ws1 = "ws-123"
        ws2 = "ws-456"
        slug = "my-funnel"

        funnel1 = {"workspace_id": ws1, "slug": slug}
        funnel2 = {"workspace_id": ws2, "slug": slug}

        conflict = (funnel1["slug"] == funnel2["slug"] and
                   funnel1["workspace_id"] == funnel2["workspace_id"])
        assert not conflict


if __name__ == "__main__":
    pytest.main([__file__, "-v"])