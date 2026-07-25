"""Tests for the production seed guards (audit point 15).

A fresh/restored production DB must never come up with the weak default
editor/viewer credentials — the deployment is internet-facing.
"""

import pytest

from app.seed import get_admin_password, get_shared_account_password


@pytest.fixture
def production_env(monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")


@pytest.fixture
def dev_env(monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)


class TestSharedAccountPassword:
    def test_dev_falls_back_to_default(self, dev_env, monkeypatch):
        monkeypatch.delenv("EDITOR_PASSWORD", raising=False)
        assert get_shared_account_password("EDITOR_PASSWORD", dev_default="editor") == "editor"

    def test_production_requires_env_var(self, production_env, monkeypatch):
        monkeypatch.delenv("EDITOR_PASSWORD", raising=False)
        with pytest.raises(ValueError, match="EDITOR_PASSWORD .* required in production"):
            get_shared_account_password("EDITOR_PASSWORD", dev_default="editor")

    def test_production_requires_viewer_password_too(self, production_env, monkeypatch):
        monkeypatch.delenv("VIEWER_PASSWORD", raising=False)
        with pytest.raises(ValueError, match="VIEWER_PASSWORD .* required in production"):
            get_shared_account_password("VIEWER_PASSWORD", dev_default="viewer")

    def test_short_password_rejected_everywhere(self, dev_env, monkeypatch):
        monkeypatch.setenv("EDITOR_PASSWORD", "short")
        with pytest.raises(ValueError, match="at least 12 characters"):
            get_shared_account_password("EDITOR_PASSWORD", dev_default="editor")

    def test_explicit_strong_password_wins(self, production_env, monkeypatch):
        monkeypatch.setenv("EDITOR_PASSWORD", "a-strong-password-123")
        assert get_shared_account_password("EDITOR_PASSWORD", dev_default="editor") == "a-strong-password-123"


class TestAdminPassword:
    def test_production_requires_env_var(self, production_env, monkeypatch):
        monkeypatch.delenv("ADMIN_SEED_PASSWORD", raising=False)
        with pytest.raises(ValueError, match="ADMIN_SEED_PASSWORD .* required in production"):
            get_admin_password()

    def test_dev_generates_random_password(self, dev_env, monkeypatch):
        monkeypatch.delenv("ADMIN_SEED_PASSWORD", raising=False)
        password = get_admin_password()
        assert len(password) >= 12
