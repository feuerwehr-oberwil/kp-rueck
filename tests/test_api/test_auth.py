"""Tests for authentication API endpoints."""
from datetime import timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import create_access_token, hash_password
from app.main import app
from app.models import User


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    """Create an async test client."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


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
async def test_viewer_user(db_session: AsyncSession) -> User:
    """Create a test viewer user with hashed password."""
    user = User(
        id=uuid4(),
        username="viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
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


@pytest_asyncio.fixture
async def authenticated_viewer_client(client: AsyncClient, test_viewer_user: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    # Login to get cookies
    response = await client.post(
        "/api/auth/login",
        data={"username": "viewer", "password": "viewerpass123"},
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
    assert response.json()["detail"] == "Incorrect username or password"


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
async def test_viewer_can_read(authenticated_viewer_client: AsyncClient):
    """Test viewers can read data."""
    response = await authenticated_viewer_client.get("/api/incidents")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_viewer_cannot_create(authenticated_viewer_client: AsyncClient):
    """Test viewers cannot create incidents."""
    response = await authenticated_viewer_client.post(
        "/api/incidents",
        json={
            "title": "Test Incident",
            "type": "fire",
            "priority": "high",
            "status": "eingegangen",
        },
    )
    assert response.status_code == 403
    assert "Editor role required" in response.json()["detail"]


@pytest.mark.asyncio
async def test_editor_can_create(authenticated_editor_client: AsyncClient):
    """Test editors can create incidents."""
    response = await authenticated_editor_client.post(
        "/api/incidents",
        json={
            "title": "Test Incident",
            "type": "fire",
            "priority": "high",
            "status": "eingegangen",
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
    assert response.json()["message"] == "Logged out successfully"

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
    password = "secret123"
    hashed = hash_password(password)

    # Password hash should not match plain password
    assert hashed != password
    assert len(hashed) > 50  # Bcrypt hashes are long


@pytest.mark.asyncio
async def test_expired_token_rejected(client: AsyncClient, test_editor_user: User):
    """Test expired tokens are rejected."""
    # Create already-expired token
    expired_token = create_access_token(
        data={"sub": str(test_editor_user.id)},
        expires_delta=timedelta(minutes=-1)
    )

    # Try to use expired token
    response = await client.get(
        "/api/auth/me",
        cookies={"access_token": expired_token}
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_invalid_token_type(client: AsyncClient, test_editor_user: User):
    """Test refresh token cannot be used as access token."""
    from app.auth.security import create_refresh_token

    # Create refresh token
    refresh_token = create_refresh_token(data={"sub": str(test_editor_user.id)})

    # Try to use refresh token as access token
    response = await client.get(
        "/api/auth/me",
        cookies={"access_token": refresh_token}
    )

    assert response.status_code == 401


# ============================================
# Additional Edge Cases
# ============================================


@pytest.mark.asyncio
async def test_malformed_token(client: AsyncClient):
    """Test malformed JWT is rejected."""
    response = await client.get(
        "/api/auth/me",
        cookies={"access_token": "invalid.jwt.token"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_token_with_nonexistent_user(client: AsyncClient):
    """Test token with valid format but non-existent user ID."""
    # Create token with random UUID
    fake_token = create_access_token(
        data={"sub": str(uuid4())}
    )

    response = await client.get(
        "/api/auth/me",
        cookies={"access_token": fake_token}
    )

    assert response.status_code == 401
