# Authentication System - Bugs Found During Testing

This document lists all bugs discovered while writing comprehensive tests for the authentication system (Task 1.2).

**Date**: 2025-10-24
**Testing Scope**: JWT Authentication System (backend/app/auth/)
**Total Tests Written**: 107 (all passing)
**Coverage Achieved**: 100% for auth module (config.py, dependencies.py, security.py)

---

## Bug #1: Bcrypt Password Length Limitation Not Handled

**Severity**: Medium
**File**: `backend/app/auth/security.py`
**Function**: `hash_password()`

### Description
The `hash_password()` function accepts passwords up to 128 characters (as per `MAX_PASSWORD_LENGTH` setting), but bcrypt has a hard limit of 72 bytes. Attempting to hash a password longer than 72 bytes raises a `ValueError`.

### Steps to Reproduce
```python
from app.auth.security import hash_password

# This will fail with ValueError
long_password = "x" * 73  # 73 bytes
hash_password(long_password)
```

### Expected Behavior
Either:
1. The code should handle passwords longer than 72 bytes (e.g., by hashing the password with SHA-256 first, then using bcrypt on the hash)
2. The `MAX_PASSWORD_LENGTH` setting should be reduced to 72
3. The function should raise a more descriptive error message

### Current Behavior
```
ValueError: password cannot be longer than 72 bytes, truncate manually if necessary (e.g. my_password[:72])
```

### Recommendation
**Option 1 (Recommended)**: Update the password validation to enforce a 72-byte maximum:

```python
# In backend/app/auth/config.py
MAX_PASSWORD_LENGTH: int = 72  # Bcrypt limitation

# In backend/app/auth/security.py
if len(password.encode('utf-8')) > auth_settings.MAX_PASSWORD_LENGTH:
    raise ValueError(f"Password must not exceed {auth_settings.MAX_PASSWORD_LENGTH} bytes")
```

**Option 2 (Advanced)**: Use a pre-hash strategy for longer passwords:

```python
import hashlib

def hash_password(password: str) -> str:
    # ... validation ...

    password_bytes = password.encode('utf-8')

    # If password is too long for bcrypt, pre-hash with SHA-256
    if len(password_bytes) > 72:
        password_bytes = hashlib.sha256(password_bytes).digest()

    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')
```

### Impact
- Users cannot set passwords longer than 72 bytes
- The error message is confusing and exposes internal implementation details
- Frontend validation does not catch this issue (allows up to 128 chars)

### Test Coverage
Added test case: `test_hash_password_exactly_max_length()` in `tests/test_auth/test_security.py`

---

## Summary

**Total Bugs Found**: 1

**Test Statistics**:
- Total authentication tests: 107
- All tests passing: ✅
- Auth module coverage: 100%
  - `auth/config.py`: 100%
  - `auth/dependencies.py`: 100%
  - `auth/security.py`: 100%

**Test Files Created**:
1. `tests/test_auth/test_config.py` - 23 tests for authentication configuration
2. `tests/test_auth/test_dependencies.py` - 19 tests for dependency injection
3. `tests/test_auth/test_security.py` - 29 tests for password hashing and JWT tokens
4. `tests/test_api/test_auth.py` - Enhanced with 36 tests for API endpoints (was already partially implemented)

**Test Categories**:
- Password hashing and validation: 11 tests
- JWT token generation: 8 tests
- JWT token validation: 6 tests
- Dependency injection: 12 tests
- Configuration management: 23 tests
- API endpoints (login/logout/refresh): 22 tests
- Role-based access control: 5 tests
- Last login tracking: 3 tests
- Cookie security: 3 tests
- Edge cases and error handling: 14 tests

---

## Notes for Implementation Team

The authentication system is well-implemented overall. The only issue found is the bcrypt password length limitation, which should be addressed by either:

1. Reducing `MAX_PASSWORD_LENGTH` to 72 in the config (simple fix)
2. Implementing a pre-hash strategy for longer passwords (more complex but allows longer passwords)

All other acceptance criteria from Task 1.2 are met:
- ✅ Password hashing uses bcrypt (rounds=12)
- ✅ JWT tokens stored in httpOnly cookies
- ✅ Access tokens expire after 15 minutes
- ✅ Refresh tokens work correctly
- ✅ Protected routes require authentication
- ✅ Editor-only routes reject viewers
- ✅ Invalid credentials return 401
- ✅ Expired tokens return 401
- ✅ Last login timestamp updated on successful login
- ✅ No password leaks in logs or responses

**Coverage Report**:
```
Name                       Stmts   Miss  Cover
----------------------------------------------
app/auth/config.py            16      0   100%
app/auth/dependencies.py      36      0   100%
app/auth/security.py          39      0   100%
```
