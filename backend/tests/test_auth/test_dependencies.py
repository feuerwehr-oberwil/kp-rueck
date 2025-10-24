"""Tests for authentication dependency injection functions."""
from datetime import timedelta
from uuid import uuid4
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, get_current_editor
from app.auth.security import create_access_token, create_refresh_token
from app.models import User


@pytest.fixture
def mock_request():
    """Create a mock request object for dependency tests."""
    request = MagicMock()
    request.state = MagicMock()
    return request


# ============================================
# get_current_user Tests
# ============================================


@pytest.mark.asyncio
async def test_get_current_user_valid_token(db_session: AsyncSession, mock_request):
    """Test get_current_user returns user with valid token."""
    # Create test user
    user = User(
        id=uuid4(),
        username="testuser",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Create valid access token
    access_token = create_access_token(data={"sub": str(user.id)})

    # Mock function call
    result = await get_current_user(request=mock_request, access_token=access_token, db=db_session)

    assert result.id == user.id
    assert result.username == "testuser"
    assert result.role == "editor"


@pytest.mark.asyncio
async def test_get_current_user_no_token(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 when no token provided."""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=None, db=db_session)

    assert exc_info.value.status_code == 401
    assert "Anmeldedaten konnten nicht validiert werden" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_user_expired_token(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 with expired token."""
    user = User(
        id=uuid4(),
        username="testuser",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(user)
    await db_session.commit()

    # Create already-expired token
    expired_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(seconds=-1)
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=expired_token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_invalid_token_format(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 with malformed token."""
    invalid_token = "invalid.jwt.token"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=invalid_token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_wrong_token_type(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 when refresh token is used."""
    user = User(
        id=uuid4(),
        username="testuser",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(user)
    await db_session.commit()

    # Create refresh token instead of access token
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=refresh_token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_nonexistent_user(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 when user not found in database."""
    # Create token for non-existent user
    fake_user_id = uuid4()
    access_token = create_access_token(data={"sub": str(fake_user_id)})

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=access_token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_missing_sub_claim(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 when token missing 'sub' claim."""
    # Manually create token without 'sub' claim
    from app.auth.config import auth_settings
    from datetime import datetime, timezone
    from jose import jwt

    token_data = {
        "username": "testuser",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "type": "access"
    }
    token = jwt.encode(token_data, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_invalid_uuid_format(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 when 'sub' is not valid UUID."""
    from app.auth.config import auth_settings
    from datetime import datetime, timezone
    from jose import jwt

    token_data = {
        "sub": "not-a-valid-uuid",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "type": "access"
    }
    token = jwt.encode(token_data, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_tampered_token(db_session: AsyncSession, mock_request):
    """Test get_current_user raises 401 with tampered token."""
    user = User(
        id=uuid4(),
        username="testuser",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(user)
    await db_session.commit()

    # Create valid token then tamper with it
    valid_token = create_access_token(data={"sub": str(user.id)})
    tampered_token = valid_token[:-5] + "XXXXX"

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=tampered_token, db=db_session)

    assert exc_info.value.status_code == 401


# ============================================
# get_current_editor Tests
# ============================================


@pytest.mark.asyncio
async def test_get_current_editor_with_editor_role(db_session: AsyncSession):
    """Test get_current_editor allows users with editor role."""
    editor = User(
        id=uuid4(),
        username="editor",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(editor)
    await db_session.commit()
    await db_session.refresh(editor)

    # get_current_editor expects a User object (from get_current_user dependency)
    result = await get_current_editor(current_user=editor)

    assert result.id == editor.id
    assert result.role == "editor"


@pytest.mark.asyncio
async def test_get_current_editor_with_viewer_role(db_session: AsyncSession):
    """Test get_current_editor raises 403 for viewer role."""
    viewer = User(
        id=uuid4(),
        username="viewer",
        password_hash="hashed",
        role="viewer"
    )
    db_session.add(viewer)
    await db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await get_current_editor(current_user=viewer)

    assert exc_info.value.status_code == 403
    assert "Editor-Berechtigung erforderlich" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_current_editor_returns_same_user():
    """Test get_current_editor returns the same user object passed in."""
    editor = User(
        id=uuid4(),
        username="editor",
        password_hash="hashed",
        role="editor"
    )

    result = await get_current_editor(current_user=editor)

    # Should return the exact same user object
    assert result is editor


# ============================================
# Role-Based Access Control Tests
# ============================================


@pytest.mark.asyncio
async def test_editor_role_exact_match():
    """Test editor role check is exact (case-sensitive)."""
    # Test with capitalized role
    user_caps = User(
        id=uuid4(),
        username="test1",
        password_hash="hashed",
        role="Editor"  # Wrong case
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_current_editor(current_user=user_caps)

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_invalid_role_rejected():
    """Test invalid role is rejected."""
    user_invalid = User(
        id=uuid4(),
        username="test",
        password_hash="hashed",
        role="admin"  # Not a valid role
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_current_editor(current_user=user_invalid)

    assert exc_info.value.status_code == 403


# ============================================
# Integration Tests
# ============================================


@pytest.mark.asyncio
async def test_full_dependency_chain_editor(db_session: AsyncSession, mock_request):
    """Test complete dependency chain for editor user."""
    # Create editor user
    editor = User(
        id=uuid4(),
        username="editor",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(editor)
    await db_session.commit()
    await db_session.refresh(editor)

    # Create token
    access_token = create_access_token(data={"sub": str(editor.id)})

    # First dependency: get_current_user
    current_user = await get_current_user(request=mock_request, access_token=access_token, db=db_session)
    assert current_user.id == editor.id

    # Second dependency: get_current_editor
    current_editor = await get_current_editor(current_user=current_user)
    assert current_editor.id == editor.id
    assert current_editor.role == "editor"


@pytest.mark.asyncio
async def test_full_dependency_chain_viewer(db_session: AsyncSession, mock_request):
    """Test dependency chain rejects viewer at editor check."""
    # Create viewer user
    viewer = User(
        id=uuid4(),
        username="viewer",
        password_hash="hashed",
        role="viewer"
    )
    db_session.add(viewer)
    await db_session.commit()
    await db_session.refresh(viewer)

    # Create token
    access_token = create_access_token(data={"sub": str(viewer.id)})

    # First dependency: get_current_user - should succeed
    current_user = await get_current_user(request=mock_request, access_token=access_token, db=db_session)
    assert current_user.id == viewer.id

    # Second dependency: get_current_editor - should fail
    with pytest.raises(HTTPException) as exc_info:
        await get_current_editor(current_user=current_user)

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_www_authenticate_header(mock_request):
    """Test 401 responses include WWW-Authenticate header."""
    from app.auth.dependencies import get_current_user

    db_mock = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=None, db=db_mock)

    assert exc_info.value.status_code == 401
    assert "WWW-Authenticate" in exc_info.value.headers
    assert exc_info.value.headers["WWW-Authenticate"] == "Bearer"


# ============================================
# Edge Case Tests
# ============================================


@pytest.mark.asyncio
async def test_get_current_user_with_deleted_user(db_session: AsyncSession, mock_request):
    """Test get_current_user handles case where user was deleted after token creation."""
    # Create user and token
    user = User(
        id=uuid4(),
        username="testuser",
        password_hash="hashed",
        role="editor"
    )
    db_session.add(user)
    await db_session.commit()
    user_id = user.id

    access_token = create_access_token(data={"sub": str(user_id)})

    # Delete user
    await db_session.delete(user)
    await db_session.commit()

    # Token should now be invalid
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token=access_token, db=db_session)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_empty_string_token(db_session: AsyncSession, mock_request):
    """Test empty string token is rejected."""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(request=mock_request, access_token="", db=db_session)

    assert exc_info.value.status_code == 401
