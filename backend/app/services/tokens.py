"""Token generation and validation for check-in forms."""
import secrets


def generate_checkin_token() -> str:
    """
    Generate a unique token for check-in session.

    Unlike Reko tokens which are deterministic per incident,
    check-in tokens are random to support multiple deployments.

    Returns:
        URL-safe token string (32+ characters)
    """
    return secrets.token_urlsafe(32)


def validate_checkin_token(token: str) -> bool:
    """
    Validate check-in token format.

    In MVP, we just check format. In production, store valid tokens in database.

    Args:
        token: The token string to validate

    Returns:
        True if token format is valid, False otherwise
    """
    # Basic validation - token should be 32+ chars, alphanumeric (with - and _)
    if not token or len(token) < 20:
        return False

    # URL-safe tokens only contain alphanumeric, hyphen, and underscore
    return token.replace('-', '').replace('_', '').isalnum()
