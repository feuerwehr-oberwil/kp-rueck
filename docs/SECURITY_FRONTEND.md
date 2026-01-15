# Frontend Security Audit

Last updated: 2025-01-12

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 4 |

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

**Risk**: Tokens visible in:
- Browser history
- URL bar
- Server logs
- Referrer headers

**Recommendation**:
- Use secure session storage instead of URL parameters
- Pass token in request body or secure cookie
- Validate token server-side with separate endpoint

---

### 2. Missing Credentials in Photo Upload

**File**: `frontend/lib/api-client.ts:1054-1073`

```typescript
async uploadRekoPhoto(incidentId: string, token: string, file: File): Promise<{ filename: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Reko-Token': token  // Token in header instead of secure cookie
    },
    body: formData,
    // MISSING: credentials: 'include'
  })
}
```

**Risk**: Inconsistent authentication mechanism bypasses cookie-based session system.

**Recommendation**: Add `credentials: 'include'` for consistency with other API calls.

---

## Medium Severity Issues

### 3. Console Logging of Sensitive Information

**Files**:
- `lib/auth-client.ts:107` - Logs successful login with username
- `lib/auth-client.ts:147` - Logs current user info
- `lib/api-client.ts:565` - Logs API response data
- `lib/contexts/notification-context.tsx` - Logs URLs and API responses

**Examples**:
```typescript
console.log('[Auth] Login successful:', user.username);
console.log(`[API Success] ${method} ${endpoint}`, data);
```

**Mitigation**: Next.js config (`next.config.mjs:9-11`) removes console.log in production but keeps `error`, `warn`, `log`. This is partial protection.

**Recommendation**: Remove all console.log statements, keep only console.error for actual errors.

---

### 4. Missing CSRF Protection

**Issue**: No CSRF token validation found in the codebase. All requests rely on httpOnly cookies for CSRF protection.

**Current Protection**:
- Login uses FormData (provides some CSRF protection)
- API requests use `credentials: 'include'`
- SameSite=None cookies configured on backend

**Recommendation**: Implement CSRF tokens for state-changing operations (POST, PUT, DELETE).

---

### 5. Token in URL Redirect Parameters

**File**: `frontend/components/reko/reko-form.tsx:253`

```typescript
setTimeout(() => {
  router.push(`/reko/success?id=${incidentId}&token=${token}`)
}, 1000)
```

**Risk**: Token exposure in browser history and referrer headers.

**Recommendation**: Use state management or secure storage instead of URL params.

---

## Low Severity Issues

### 6. Photo URL Exposure

**File**: `frontend/components/reko/photo-upload.tsx:76-79`

```typescript
function getPhotoUrl(filename: string): string {
  const apiUrl = getApiUrl()
  return `${apiUrl}/api/photos/${incidentId}/${filename}`
}
```

**Risk**: Photo URLs could be enumerable if filename pattern is predictable.

**Mitigation**: Assumes backend implements proper access control.

---

### 7. Missing Error Boundary Components

**File**: `frontend/app/layout.tsx`

```typescript
export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <AuthProvider>
          {/* No error boundary here */}
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
```

**Recommendation**: Add error boundary at root level to catch rendering errors.

---

### 8. Long Token Refresh Interval

**File**: `frontend/lib/contexts/auth-context.tsx:60`

```typescript
// 7.5 hours (450 minutes - 30 min before 8 hour expiration)
450 * 60 * 1000
```

**Current**: Refreshes at 7.5 hours before 8-hour token expiry.

**Best Practice**: Refresh at 50% of token lifetime or shorter.

---

### 9. Missing Timeout on File Uploads

**File**: `frontend/components/reko/photo-upload.tsx:27-68`

**Issue**: File upload fetch has no timeout. Large files could hang indefinitely.

**Note**: Regular API client has timeout via `fetchWithTimeout()`, but photo upload uses bare `fetch()`.

**Recommendation**: Add 30-60 second timeout for upload operations.

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

### Next.js Configuration
- CSP for images configured
- Console log removal in production
- Strict mode enabled for development

### Environment Variables
- Only `NEXT_PUBLIC_API_URL` exposed (no secrets)
- API URL resolution handles dev/prod properly
- No hardcoded credentials found

---

## File Security Assessment

| File | Status | Notes |
|------|--------|-------|
| `lib/api-client.ts` | Good | Secure implementation, proper credentials handling |
| `lib/auth-client.ts` | Good | Proper form-based login, timeout handling |
| `lib/contexts/auth-context.tsx` | Good | Secure token refresh, auto logout |
| `components/reko/reko-form.tsx` | Needs Work | Token in URL parameters |
| `app/backend-api/[...path]/route.ts` | Good | Proper cookie forwarding |
| `app/check-in/page.tsx` | Needs Work | Token in URL |
| `components/reko/photo-upload.tsx` | Needs Work | Missing credentials, no timeout |
| `app/login/page.tsx` | Good | Proper form handling |
