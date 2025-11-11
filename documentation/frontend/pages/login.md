# Login Page

## Current State

**Status:** Implemented ✅

The login page provides a stylized entry point for unauthenticated users with Plex OAuth integration. It features floating audiobook covers in the background and a prominent "Login with Plex" call-to-action.

## Design Architecture

### Why a Dedicated Login Page?

**Requirements:**
- Prevent unauthenticated access to main application features
- Provide clear, simple login flow using Plex OAuth
- Create engaging visual experience with audiobook-themed design
- Guide users through the authentication process

### Visual Design

**Layout:**
- Full-screen immersive experience
- Centered hero section with login button
- Animated floating audiobook covers in background
- Dark theme optimized for audiobook browsing

**Key Elements:**
1. **Background Animation**: Floating audiobook cover images with subtle parallax effect
2. **Hero Section**: Application title, tagline, and primary CTA
3. **Login Button**: Prominent "Login with Plex" button with Plex branding
4. **Information Section**: Brief explanation of what the app does

## Implementation Details

### Component Structure

```
src/app/login/
└── page.tsx                 # Main login page component
```

### Authentication Flow

```
1. User visits any protected route (/, /search, etc.)
   └─> Redirected to /login if not authenticated

2. User clicks "Login with Plex"
   └─> POST /api/auth/plex/login (requests PIN)
   └─> Opens Plex OAuth in popup window
   └─> Polls /api/auth/plex/callback for authorization

3. User authorizes in Plex popup
   └─> Callback receives auth token
   └─> Creates/updates user in database
   └─> Returns JWT tokens to client

4. Client stores tokens in localStorage
   └─> Updates AuthContext
   └─> Redirects to originally requested page or homepage
```

### State Management

```typescript
interface LoginPageState {
  isLoggingIn: boolean;
  error: string | null;
  pinId: number | null;
  authWindow: Window | null;
}
```

## Tech Stack

**Framework:** Next.js 14+ (Client Component)
**Styling:** Tailwind CSS with custom animations
**Authentication:** Plex OAuth via AuthContext
**State:** React hooks (useState)

## Dependencies

- AuthContext (src/contexts/AuthContext.tsx)
- Plex OAuth API endpoints
- Button component (src/components/ui/Button.tsx)

## Usage Example

### Login Flow

```tsx
export default function LoginPage() {
  const { login } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);

    try {
      // Request PIN from Plex
      const response = await fetch('/api/auth/plex/login', {
        method: 'POST',
      });
      const { pinId, authUrl } = await response.json();

      // Open Plex OAuth in popup
      const authWindow = window.open(
        authUrl,
        'plex-auth',
        'width=600,height=700,scrollbars=yes'
      );

      // Poll for authorization
      await login(pinId);

      // Close popup
      authWindow?.close();

      // Redirect to homepage
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen relative">
      {/* Floating audiobook covers background */}
      <div className="absolute inset-0">
        {/* Animated background elements */}
      </div>

      {/* Hero section */}
      <main className="relative z-10">
        <h1>ReadMeABook</h1>
        <p>Your Personal Audiobook Library Manager</p>
        <Button onClick={handleLogin} loading={isLoggingIn}>
          Login with Plex
        </Button>
      </main>
    </div>
  );
}
```

## Styling Conventions

### Background Animation

```tsx
// Floating audiobook covers with CSS animations
<div className="animate-float-slow">
  <img src="/covers/book1.jpg" className="opacity-20" />
</div>

// Tailwind config for custom animation
{
  animation: {
    'float-slow': 'float 20s ease-in-out infinite',
    'float-medium': 'float 15s ease-in-out infinite',
    'float-fast': 'float 10s ease-in-out infinite',
  },
  keyframes: {
    float: {
      '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
      '50%': { transform: 'translateY(-20px) rotate(5deg)' },
    },
  },
}
```

### Hero Section

```tsx
<div className="min-h-screen flex items-center justify-center">
  <div className="bg-gray-900/80 backdrop-blur-md rounded-2xl p-12 max-w-md">
    <h1 className="text-5xl font-bold text-white mb-4">
      ReadMeABook
    </h1>
    <p className="text-gray-300 text-lg mb-8">
      Your Personal Audiobook Library Manager
    </p>
    <Button className="w-full text-lg py-4">
      Login with Plex
    </Button>
  </div>
</div>
```

## Route Protection

The login page is public (no authentication required). All other pages are protected and redirect here when user is not authenticated.

**Protected Routes:**
- `/` - Homepage (audiobook discovery)
- `/search` - Search page
- `/requests` - User requests
- `/profile` - User profile
- `/admin/*` - Admin pages (requires admin role)

**Public Routes:**
- `/login` - Login page
- `/setup` - Setup wizard (first-time configuration)
- `/api/*` - API endpoints (handle auth independently)

## Error Handling

### Common Errors

**Popup Blocked:**
```typescript
if (!authWindow) {
  setError('Popup was blocked. Please allow popups for this site.');
  return;
}
```

**Login Timeout:**
```typescript
// After 2 minutes of polling
throw new Error('Login timeout - please try again');
```

**Plex Server Unavailable:**
```typescript
{
  error: 'Failed to connect to Plex',
  message: 'Plex services are currently unavailable. Try again later.'
}
```

## Security Considerations

**Token Storage:**
- Access token stored in localStorage (short-lived, 1 hour)
- Refresh token stored in localStorage (7 days)
- Tokens cleared on logout
- Tokens validated on every protected route access

**CSRF Protection:**
- OAuth state parameter validation
- SameSite cookie attributes
- Referrer checking

**XSS Prevention:**
- No innerHTML usage
- Sanitized user data
- Content Security Policy headers

## Accessibility

**Requirements:**
- Keyboard navigation (Tab, Enter)
- Screen reader support (ARIA labels)
- Focus indicators
- Clear error messages
- Loading states announced

**Implementation:**
```tsx
<Button
  onClick={handleLogin}
  disabled={isLoggingIn}
  aria-label="Login with Plex Media Server"
  aria-busy={isLoggingIn}
>
  {isLoggingIn ? 'Logging in...' : 'Login with Plex'}
</Button>
```

## Performance

**Optimizations:**
- Static background images (Next.js Image optimization)
- CSS animations (GPU accelerated)
- Lazy loading for non-critical elements
- Minimal JavaScript bundle

## Known Issues

None currently.

## Future Enhancements

- **Alternative OAuth providers**: Support for additional authentication methods
- **Remember device**: Option to extend session on trusted devices
- **Social proof**: Show number of users or featured audiobooks
- **Onboarding**: Brief tutorial after first login
- **Customizable background**: Admin-configurable background images
