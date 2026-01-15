# Frontend Security Audit

Last updated: 2025-01-15

## Summary

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 1 |
| Low | 3 |

The frontend demonstrates strong overall security practices with proper authentication handling and secure API client implementation.

---

## High Severity Issues

### 1. Token Exposure in URL Parameters

**File**: `frontend/components/reko/reko-form.tsx:253`

```typescript
router.push(`/reko/success?id=${incidentId}&token=${token}`)
```

**Also affected**:
- `reko-form.tsx` retrieves token from `searchParams.get('token')` (line 56)
- `check-in/page.tsx` retrieves token from `searchParams.get('token')` (line 13)

**Risk**: Tokens visible in browser history, URL bar, server logs, referrer headers.

**Note**: This is a design decision for field use (Reko forms accessed via shared links). Consider if acceptable for the use case.

**Recommendation**:
- Use secure session storage instead of URL parameters
- Pass token in request body or secure cookie

---

## Medium Severity Issues

### 2. Missing CSRF Protection

**Issue**: No CSRF token validation found in the codebase. All requests rely on httpOnly cookies for CSRF protection.

**Current Protection**:
- Login uses FormData (provides some CSRF protection)
- API requests use `credentials: 'include'`
- SameSite cookies configured on backend

**Recommendation**: Implement CSRF tokens for state-changing operations (POST, PUT, DELETE).

---

## Low Severity Issues

### 3. Photo URL Exposure

**File**: `frontend/components/reko/photo-upload.tsx:76-79`

**Risk**: Photo URLs could be enumerable if filename pattern is predictable.

**Mitigation**: Backend implements proper access control.

---

### 4. Missing Error Boundary Components

**File**: `frontend/app/layout.tsx`

**Recommendation**: Add error boundary at root level to catch rendering errors.

---

### 5. Long Token Refresh Interval

**File**: `frontend/lib/contexts/auth-context.tsx:60`

**Current**: Refreshes at 7.5 hours before 8-hour token expiry.

**Best Practice**: Refresh at 50% of token lifetime or shorter.

---

## Positive Security Findings

### Strong Authentication Implementation
- HTTPOnly cookies for token storage (not accessible to JavaScript)
- Proper CORS handling with `credentials: 'include'`
- Token refresh mechanism with automatic renewal
- Logout clears cookies properly

### Secure API Client
- Retry logic with exponential backoff
- Error handling prevents sensitive data leakage
- URL encoding with `encodeURIComponent()` prevents injection
- No `eval()` or `dangerouslySetInnerHTML` found

### Protected Routes
- Role-based access control (Editor vs Viewer) properly implemented
- `ProtectedRoute` component redirects unauthorized users
- `EditorRoute` component prevents viewers from accessing editor features
- `ProtectedButton` shows helpful UI feedback for locked features

---

## Completed Items (2025-01-15)

- ✅ Missing credentials in photo upload → added `credentials: 'include'`
- ✅ Console logging of sensitive information → removed console.log statements
- ✅ Missing timeout on file uploads → added 60s timeout with AbortController
