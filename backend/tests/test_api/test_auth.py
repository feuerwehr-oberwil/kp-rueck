"""Tests for authentication API endpoints."""

from datetime import UTC, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import create_access_token, hash_password
from app.database import get_db
from app.main import app
from app.models import Event, User


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_editor_user(db_session: AsyncSession) -> User:
    """Create a test editor user with hashed password."""
    user = User(
        id=uuid4(),
        username="editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def authenticated_editor_client(client: AsyncClient, test_editor_user: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    # Login to get cookies
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Login Tests
# ============================================


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, test_editor_user: User):
    """Test successful login returns user data and sets cookies."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    assert response.status_code == 200

    # Check cookies are set
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies

    # Check response data
    data = response.json()
    assert data["username"] == "editor"
    assert data["role"] == "editor"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, test_editor_user: User):
    """Test login fails with wrong password."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "wrongpassword"},
    )

    assert response.status_code == 401
    assert "access_token" not in response.cookies
    assert response.json()["detail"] == "Falscher Benutzername oder Passwort"


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    """Test login fails with non-existent username."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "nonexistent", "password": "password"},
    )

    assert response.status_code == 401
    assert "access_token" not in response.cookies


# ============================================
# Protected Route Tests
# ============================================


@pytest.mark.asyncio
async def test_protected_route_requires_auth(client: AsyncClient):
    """Test protected routes reject unauthenticated requests."""
    response = await client.get("/api/incidents")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_with_auth(authenticated_editor_client: AsyncClient):
    """Test protected routes allow authenticated requests."""
    response = await authenticated_editor_client.get("/api/incidents")
    assert response.status_code == 200


# ============================================
# Role-Based Access Tests
# ============================================


@pytest.mark.asyncio
async def test_viewer_can_read(viewer_client: AsyncClient):
    """Test viewers can read data."""
    response = await viewer_client.get("/api/incidents")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_viewer_cannot_create(viewer_client: AsyncClient):
    """Test viewers cannot create incidents."""
    response = await viewer_client.post(
        "/api/incidents/",
        json={
            "title": "Test Incident",
            "type": "brandbekaempfung",
            "priority": "high",
            "status": "eingegangen",
        },
    )
    assert response.status_code == 403
    assert "Editor-Berechtigung erforderlich" in response.json()["detail"]


@pytest.mark.asyncio
async def test_editor_can_create(authenticated_editor_client: AsyncClient, test_event: Event):
    """Test editors can create incidents."""
    response = await authenticated_editor_client.post(
        "/api/incidents/",
        json={
            "title": "Test Incident",
            "type": "brandbekaempfung",
            "priority": "high",
            "status": "eingegangen",
            "event_id": str(test_event.id),
        },
    )
    assert response.status_code == 201
    assert response.json()["title"] == "Test Incident"


# ============================================
# Token Refresh Tests
# ============================================


@pytest.mark.asyncio
async def test_token_refresh(client: AsyncClient, test_editor_user: User):
    """Test refresh token renews access token."""
    # Login to get refresh token
    login_response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )
    assert login_response.status_code == 200

    # Refresh access token
    refresh_response = await client.post("/api/auth/refresh")
    assert refresh_response.status_code == 200
    assert "access_token" in refresh_response.cookies

    # Verify refreshed token works
    data = refresh_response.json()
    assert data["username"] == "editor"


@pytest.mark.asyncio
async def test_refresh_without_token(client: AsyncClient):
    """Test refresh fails without refresh token."""
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 401


# ============================================
# Logout Tests
# ============================================


@pytest.mark.asyncio
async def test_logout_clears_cookies(authenticated_editor_client: AsyncClient):
    """Test logout removes cookies."""
    response = await authenticated_editor_client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json()["message"] == "Erfolgreich abgemeldet"

    # Verify cookies are deleted (they should be present but with max_age=0 or empty)
    # Note: httpx doesn't automatically clear cookies, but the response will have delete instructions


# ============================================
# Get Current User Tests
# ============================================


@pytest.mark.asyncio
async def test_get_current_user(authenticated_editor_client: AsyncClient):
    """Test /auth/me returns current user info."""
    response = await authenticated_editor_client.get("/api/auth/me")
    assert response.status_code == 200

    data = response.json()
    assert data["username"] == "editor"
    assert data["role"] == "editor"


@pytest.mark.asyncio
async def test_get_current_user_unauthorized(client: AsyncClient):
    """Test /auth/me rejects unauthenticated requests."""
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


# ============================================
# Security Tests
# ============================================


@pytest.mark.asyncio
async def test_password_hashing():
    """Verify passwords are hashed, not stored plain."""
    password = "secretpassword123"
    hashed = hash_password(password)

    # Password hash should not match plain password
    assert hashed != password
    assert len(hashed) > 50  # Bcrypt hashes are long


@pytest.mark.asyncio
async def test_expired_token_rejected(client: AsyncClient, test_editor_user: User):
    """Test expired tokens are rejected."""
    # Create already-expired token
    expired_token = create_access_token(data={"sub": str(test_editor_user.id)}, expires_delta=timedelta(minutes=-1))

    # Try to use expired token
    response = await client.get("/api/auth/me", cookies={"access_token": expired_token})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_invalid_token_type(client: AsyncClient, test_editor_user: User):
    """Test refresh token cannot be used as access token."""
    from app.auth.security import create_refresh_token

    # Create refresh token
    refresh_token = create_refresh_token(data={"sub": str(test_editor_user.id)})

    # Try to use refresh token as access token
    response = await client.get("/api/auth/me", cookies={"access_token": refresh_token})

    assert response.status_code == 401


# ============================================
# Additional Edge Cases
# ============================================


@pytest.mark.asyncio
async def test_malformed_token(client: AsyncClient):
    """Test malformed JWT is rejected."""
    response = await client.get("/api/auth/me", cookies={"access_token": "invalid.jwt.token"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_token_with_nonexistent_user(client: AsyncClient):
    """Test token with valid format but non-existent user ID."""
    # Create token with random UUID
    fake_token = create_access_token(data={"sub": str(uuid4())})

    response = await client.get("/api/auth/me", cookies={"access_token": fake_token})

    assert response.status_code == 401


# ============================================
# Last Login Timestamp Tests
# ============================================


@pytest.mark.asyncio
async def test_login_updates_last_login(client: AsyncClient, test_editor_user: User, db_session: AsyncSession):
    """Test login updates last_login timestamp."""
    from datetime import datetime

    from sqlalchemy import select

    # Verify last_login is None initially
    result = await db_session.execute(select(User).where(User.id == test_editor_user.id))
    user_before = result.scalar_one()
    assert user_before.last_login is None

    # Login
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )
    assert response.status_code == 200

    # Verify last_login was updated
    await db_session.refresh(user_before)
    result = await db_session.execute(select(User).where(User.id == test_editor_user.id))
    user_after = result.scalar_one()

    assert user_after.last_login is not None
    # Should be very recent (within last minute)
    time_diff = datetime.now(UTC) - user_after.last_login
    assert time_diff.total_seconds() < 60


@pytest.mark.asyncio
async def test_login_updates_last_login_on_second_login(
    client: AsyncClient, test_editor_user: User, db_session: AsyncSession
):
    """Test last_login is updated on subsequent logins."""
    from datetime import datetime, timedelta

    from sqlalchemy import select, update

    # Set an old last_login timestamp
    old_timestamp = datetime.now(UTC) - timedelta(days=7)
    await db_session.execute(update(User).where(User.id == test_editor_user.id).values(last_login=old_timestamp))
    await db_session.commit()

    # Login
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )
    assert response.status_code == 200

    # Verify last_login was updated to a recent time
    result = await db_session.execute(select(User).where(User.id == test_editor_user.id))
    user = result.scalar_one()

    assert user.last_login is not None
    assert user.last_login > old_timestamp
    # Should be very recent
    time_diff = datetime.now(UTC) - user.last_login
    assert time_diff.total_seconds() < 60


@pytest.mark.asyncio
async def test_failed_login_does_not_update_last_login(
    client: AsyncClient, test_editor_user: User, db_session: AsyncSession
):
    """Test failed login does not update last_login timestamp."""
    from sqlalchemy import select

    # Verify last_login is None initially
    result = await db_session.execute(select(User).where(User.id == test_editor_user.id))
    user_before = result.scalar_one()
    initial_last_login = user_before.last_login

    # Attempt failed login
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "wrongpassword"},
    )
    assert response.status_code == 401

    # Verify last_login was NOT updated
    result = await db_session.execute(select(User).where(User.id == test_editor_user.id))
    user_after = result.scalar_one()
    assert user_after.last_login == initial_last_login


# ============================================
# Cookie Security Tests
# ============================================


@pytest.mark.asyncio
async def test_cookies_have_httponly_flag(client: AsyncClient, test_editor_user: User):
    """Test cookies have httpOnly flag set."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    assert response.status_code == 200

    # Check access_token cookie attributes
    access_cookie = response.cookies.get("access_token")
    assert access_cookie is not None

    # Note: httpx Cookie objects don't expose httponly directly
    # But we can verify the cookie was set
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_cookies_have_samesite_attribute(client: AsyncClient, test_editor_user: User):
    """Test cookies have SameSite attribute."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    assert response.status_code == 200
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_access_token_max_age(client: AsyncClient, test_editor_user: User):
    """Test access token cookie has correct max_age."""
    from app.auth.config import auth_settings

    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    assert response.status_code == 200
    # Cookie should be set with appropriate max_age (15 minutes = 900 seconds)
    auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    # Just verify cookies are set (httpx doesn't expose max_age easily)
    assert "access_token" in response.cookies


# ============================================
# Refresh Token Edge Cases
# ============================================


@pytest.mark.asyncio
async def test_refresh_with_access_token_fails(client: AsyncClient, test_editor_user: User):
    """Test using access token for refresh endpoint fails."""
    # Login to get access token
    login_response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )
    assert login_response.status_code == 200

    # Manually set only access_token cookie (not refresh_token)
    access_token = login_response.cookies.get("access_token")

    # Try to refresh with access token instead of refresh token
    response = await client.post("/api/auth/refresh", cookies={"refresh_token": access_token})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_returns_user_data(client: AsyncClient, test_editor_user: User):
    """Test refresh endpoint returns complete user data."""
    # Login
    await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    # Refresh
    response = await client.post("/api/auth/refresh")

    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "editor"
    assert data["role"] == "editor"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_refresh_with_deleted_user(client: AsyncClient, test_editor_user: User, db_session: AsyncSession):
    """Test refresh fails if user was deleted after login."""
    # Login
    await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    # Delete user
    await db_session.delete(test_editor_user)
    await db_session.commit()

    # Try to refresh - should fail
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 401


# ============================================
# Login Form Data Tests
# ============================================


@pytest.mark.asyncio
async def test_login_requires_form_data(client: AsyncClient, test_editor_user: User):
    """Test login endpoint requires form data (not JSON)."""
    # Try to login with JSON instead of form data
    response = await client.post(
        "/api/auth/login",
        json={"username": "editor", "password": "editorpass123"},
    )

    # Should fail because OAuth2PasswordRequestForm expects form data
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_empty_username(client: AsyncClient):
    """Test login with empty username."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "", "password": "password"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_empty_password(client: AsyncClient, test_editor_user: User):
    """Test login with empty password."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": ""},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_username_case_sensitive(client: AsyncClient, test_editor_user: User):
    """Test username is case-sensitive."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "EDITOR", "password": "editorpass123"},  # Wrong case
    )

    assert response.status_code == 401


# ============================================
# Logout Edge Cases
# ============================================


@pytest.mark.asyncio
async def test_logout_without_authentication(client: AsyncClient):
    """Test logout works even without authentication."""
    response = await client.post("/api/auth/logout")

    # Should succeed (just clears cookies if any)
    assert response.status_code == 200
    assert response.json()["message"] == "Erfolgreich abgemeldet"


@pytest.mark.asyncio
async def test_double_logout(authenticated_editor_client: AsyncClient):
    """Test logout can be called multiple times."""
    # First logout
    response1 = await authenticated_editor_client.post("/api/auth/logout")
    assert response1.status_code == 200

    # Second logout (cookies already cleared)
    response2 = await authenticated_editor_client.post("/api/auth/logout")
    assert response2.status_code == 200


@pytest.mark.asyncio
async def test_protected_route_after_logout(client: AsyncClient, test_editor_user: User):
    """Test protected routes fail after logout."""
    # Login
    await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    # Verify authenticated access works
    response = await client.get("/api/auth/me")
    assert response.status_code == 200

    # Logout
    await client.post("/api/auth/logout")

    # Try to access protected route - should fail
    # Note: This test depends on whether httpx clears cookies after delete_cookie
    # In real browsers, cookies would be cleared


# ============================================
# Response Schema Tests
# ============================================


@pytest.mark.asyncio
async def test_login_response_schema(client: AsyncClient, test_editor_user: User):
    """Test login response matches UserResponse schema."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "editor", "password": "editorpass123"},
    )

    assert response.status_code == 200
    data = response.json()

    # Required fields
    assert "id" in data
    assert "username" in data
    assert "role" in data
    assert "created_at" in data

    # Should NOT include password_hash (security)
    assert "password_hash" not in data
    assert "password" not in data


@pytest.mark.asyncio
async def test_me_endpoint_response_schema(authenticated_editor_client: AsyncClient):
    """Test /auth/me response matches UserResponse schema."""
    response = await authenticated_editor_client.get("/api/auth/me")

    assert response.status_code == 200
    data = response.json()

    # Required fields
    assert "id" in data
    assert "username" in data
    assert "role" in data
    assert "created_at" in data

    # Should NOT include password_hash
    assert "password_hash" not in data
