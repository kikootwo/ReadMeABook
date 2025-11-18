# Login Page

**Status:** ✅ Implemented | Real floating book covers with professional animations

Stylized entry point with Plex OAuth integration, animated floating popular audiobook covers, and prominent "Login with Plex" CTA.

## Design

- Full-screen immersive experience with gradient background
- Centered hero with login button
- Animated floating real audiobook covers (popular releases)
- **100 randomly positioned covers** with varied sizes, animations, and depth
- Multi-layer depth effect with z-index layering (0-20)
- Dark theme optimized with glassmorphism card
- Professional streaming service aesthetic

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

## Book Covers

**Data Source:** `GET /api/audiobooks/covers`
- Returns up to 200 popular audiobook covers
- Uses cached thumbnails from `audible_cache` table
- Shuffled on each request for variety
- Fallback to placeholder elements if API fails

**Display:**
- **100 covers** shown simultaneously for immersive experience
- Varied sizes: 80-160px wide (1.5 aspect ratio)
- Opacity range: 0.15-0.35 for subtle layering and depth
- Staggered animation delays (0-10s) for natural movement
- Z-index layering (0-20) for depth perception
- Programmatic positioning using seeded random for consistency
- Lazy loading (first 10 eager, rest lazy) for performance
- Hover pauses animation and scales for interaction

**Positioning Algorithm:**
- Seeded random function ensures consistent positions per cover index
- Random distribution across full viewport (0-100% both axes)
- Each cover gets unique: size, position, opacity, delay, z-index, animation type
- Seed multipliers (7, 13, 17, 23, 29, 31) prevent pattern repetition
- Math.sin() based pseudo-random for deterministic results

## State

```typescript
interface LoginPageState {
  isLoggingIn: boolean;
  error: string | null;
  pinId: number | null;
  authWindow: Window | null;
  bookCovers: BookCover[];
  showAdminLogin: boolean;
  adminUsername: string;
  adminPassword: string;
}

interface BookCover {
  asin: string;
  title: string;
  author: string;
  coverUrl: string;
}
```

## Error Handling

**Popup Blocked:** "Popup was blocked. Please allow popups."
**Login Timeout:** 2 min polling timeout
**Plex Unavailable:** "Plex services currently unavailable."
**Covers Fail:** Silent fallback to placeholder gradient elements

## Animations

Three animation speeds with realistic floating motion:

```css
@keyframes float-slow {
  /* 22s cycle with 4 keyframes */
  0%, 100% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); }
  25% { transform: translateY(-25px) translateX(15px) rotate(2deg) scale(1.03); }
  50% { transform: translateY(-35px) translateX(25px) rotate(4deg) scale(1.05); }
  75% { transform: translateY(-20px) translateX(-10px) rotate(-2deg) scale(1.02); }
}

@keyframes float-medium {
  /* 16s cycle with 3 keyframes */
  0%, 100% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); }
  33% { transform: translateY(-30px) translateX(-20px) rotate(-3deg) scale(1.04); }
  66% { transform: translateY(-15px) translateX(10px) rotate(3deg) scale(1.02); }
}

@keyframes float-fast {
  /* 12s cycle with 2 keyframes */
  0%, 100% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); }
  50% { transform: translateY(-28px) translateX(18px) rotate(5deg) scale(1.06); }
}
```

**Features:**
- Scale transformations (1.02-1.06) for depth
- Rotation (-5° to +5°) for natural movement
- X/Y translation for floating effect
- Hover pauses animation
- Shadow-2xl for 3D depth

## Security

- Tokens in localStorage (access 1hr, refresh 7d)
- Tokens cleared on logout
- OAuth state parameter validation
- SameSite cookie attributes

## Tech Stack

- Next.js 14+ Client Component
- Tailwind CSS with custom animations
- Plex OAuth via AuthContext
