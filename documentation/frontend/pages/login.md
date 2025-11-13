# Login Page

**Status:** ✅ Implemented

Stylized entry point with Plex OAuth integration, floating audiobook covers, and prominent "Login with Plex" CTA.

## Design

- Full-screen immersive experience
- Centered hero with login button
- Animated floating audiobook covers (background)
- Dark theme optimized

## Authentication Flow

1. User visits protected route → redirected to `/login`
2. Clicks "Login with Plex"
3. `POST /api/auth/plex/login` → requests PIN
4. Opens Plex OAuth in popup
5. Polls `/api/auth/plex/callback` for authorization
6. User authorizes in Plex popup
7. Callback receives auth token
8. Creates/updates user in DB
9. Returns JWT tokens
10. Client stores tokens in localStorage
11. Redirects to originally requested page or homepage

## State

```typescript
interface LoginPageState {
  isLoggingIn: boolean;
  error: string | null;
  pinId: number | null;
  authWindow: Window | null;
}
```

## Error Handling

**Popup Blocked:** "Popup was blocked. Please allow popups."
**Login Timeout:** 2 min polling timeout
**Plex Unavailable:** "Plex services currently unavailable."

## Animations

Floating covers with CSS:
```css
@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-20px) rotate(5deg); }
}
```

Speeds: slow (20s), medium (15s), fast (10s)

## Security

- Tokens in localStorage (access 1hr, refresh 7d)
- Tokens cleared on logout
- OAuth state parameter validation
- SameSite cookie attributes

## Tech Stack

- Next.js 14+ Client Component
- Tailwind CSS with custom animations
- Plex OAuth via AuthContext
