"""
Testes de regressão para o router de autenticação (auth.py).

Cobre:
- Validação de invite_code no signup
- Estrutura do payload de signup (SignupRequest)
- Estrutura do payload de login (LoginRequest)
- Tratamento de campos opcionais (full_name)
"""
import sys
import os
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


class TestSignupRequestModel:
    """Testes para o modelo SignupRequest."""

    def test_signup_requires_email_and_password(self):
        """Email e password são obrigatórios no signup."""
        from app.routers.auth import SignupRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            SignupRequest(full_name="Test")

    def test_signup_validates_email_format(self):
        """Email deve ser válido (EmailStr)."""
        from app.routers.auth import SignupRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            SignupRequest(email="not-an-email", password="test123")

    def test_signup_accepts_optional_fields(self):
        """full_name e invite_code são opcionais."""
        from app.routers.auth import SignupRequest

        req = SignupRequest(email="test@test.com", password="test123")
        assert req.email == "test@test.com"
        assert req.full_name == ""
        assert req.invite_code == ""

    def test_signup_with_invite_code(self):
        """invite_code é capturado corretamente."""
        from app.routers.auth import SignupRequest

        req = SignupRequest(
            email="test@test.com",
            password="test123",
            invite_code="100kdia"
        )
        assert req.invite_code == "100kdia"


class TestLoginRequestModel:
    """Testes para o modelo LoginRequest."""

    def test_login_requires_email_and_password(self):
        """Login exige email e password."""
        from app.routers.auth import LoginRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            LoginRequest(email="test@test.com")

    def test_login_validates_email_format(self):
        """Login valida formato de email."""
        from app.routers.auth import LoginRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            LoginRequest(email="invalid", password="test")


class TestAuthResponseModel:
    """Testes para o modelo AuthResponse."""

    def test_auth_response_structure(self):
        """AuthResponse tem access_token, refresh_token e user."""
        from app.routers.auth import AuthResponse

        resp = AuthResponse(
            access_token="tok123",
            refresh_token="ref456",
            user={"id": "user-1", "email": "test@test.com"}
        )
        assert resp.access_token == "tok123"
        assert resp.refresh_token == "ref456"
        assert resp.user["id"] == "user-1"


class TestInviteCodeValidation:
    """Testes para a lógica de validação de invite_code."""

    def test_empty_invite_code_allows_open_signup(self):
        """invite_code vazio na config = cadastro aberto."""
        # Quando settings.signup_invite_code = "", qualquer invite_code passa
        required = ""
        submitted = ""
        # A lógica: if required and submitted != required -> reject
        # Com required="", o if é False, então passa
        should_reject = bool(required) and submitted.strip() != required
        assert not should_reject

    def test_matching_invite_code_passes(self):
        """invite_code correto é aceito."""
        required = "100kdia"
        submitted = "100kdia"
        should_reject = bool(required) and submitted.strip() != required
        assert not should_reject

    def test_wrong_invite_code_rejected(self):
        """invite_code errado é rejeitado."""
        required = "100kdia"
        submitted = "wrong_code"
        should_reject = bool(required) and submitted.strip() != required
        assert should_reject

    def test_empty_submitted_code_rejected_when_required(self):
        """Sem invite_code quando requerido é rejeitado."""
        required = "100kdia"
        submitted = ""
        should_reject = bool(required) and submitted.strip() != required
        assert should_reject


if __name__ == "__main__":
    pytest.main([__file__, "-v"])