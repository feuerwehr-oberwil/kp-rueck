"""Sign-in runs bcrypt off the event loop, and exactly once whether or not the user exists.

Timing itself is not asserted — a wall-clock test of a 250 ms hash is a flaky test. What is
asserted is the mechanism that makes the timing uniform: every login attempt, known user or
not, performs one bcrypt check, and it runs on a worker thread rather than the loop's.
"""

import threading

import bcrypt
import pytest
from httpx import AsyncClient

from app.auth import security
from app.models import User
from tests.conftest import TEST_PASSWORD


@pytest.fixture
def checkpw_calls(monkeypatch) -> list[int]:
    """Record the thread every bcrypt check runs on."""
    calls: list[int] = []
    real = bcrypt.checkpw

    def spy(password: bytes, hashed: bytes) -> bool:
        calls.append(threading.get_ident())
        return real(password, hashed)

    monkeypatch.setattr(security.bcrypt, "checkpw", spy)
    return calls


async def _login(client: AsyncClient, username: str, password: str):
    return await client.post("/api/auth/login", data={"username": username, "password": password})


async def test_a_correct_login_checks_the_password_off_the_event_loop(
    client: AsyncClient, test_editor: User, checkpw_calls
):
    loop_thread = threading.get_ident()
    response = await _login(client, "fixture_editor", TEST_PASSWORD)
    assert response.status_code == 200
    assert len(checkpw_calls) == 1
    assert checkpw_calls[0] != loop_thread


@pytest.mark.parametrize("password", ["wrong-password-123", TEST_PASSWORD])
async def test_an_unknown_username_costs_the_same_bcrypt_check(client: AsyncClient, checkpw_calls, password):
    """No user, no hash — and still one full check, so the answer is not measurably faster."""
    loop_thread = threading.get_ident()
    response = await _login(client, f"nobody-{len(password)}", password)
    assert response.status_code == 401
    assert response.json()["detail"] == "Falscher Benutzername oder Passwort"
    assert len(checkpw_calls) == 1
    assert checkpw_calls[0] != loop_thread


async def test_a_wrong_password_for_a_known_user_answers_identically(
    client: AsyncClient, test_editor: User, checkpw_calls
):
    response = await _login(client, "fixture_editor", "wrong-password-123")
    assert response.status_code == 401
    assert response.json()["detail"] == "Falscher Benutzername oder Passwort"
    assert len(checkpw_calls) == 1


async def test_a_password_past_bcrypts_limit_is_a_401_not_a_500(client: AsyncClient, test_editor: User, checkpw_calls):
    """bcrypt 5 raises on >72 bytes; the form accepted it, so this used to be a 500."""
    response = await _login(client, "fixture_editor", "x" * 100)
    assert response.status_code == 401
    assert len(checkpw_calls) == 1


async def test_the_dummy_hash_never_matches():
    assert await security.verify_login_password("", None) is False
    assert await security.verify_login_password(TEST_PASSWORD, None) is False
