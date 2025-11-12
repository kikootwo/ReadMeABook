# Frontend Components

## Current State

**Status:** In Development

This document describes the React components for the ReadMeABook user interface, built with Next.js 14+, TypeScript, and Tailwind CSS.

## Design Architecture

### Framework: Next.js App Router

**Why Next.js App Router:**
- Server components by default (better performance)
- File-based routing
- Built-in API routes
- React Server Components and Streaming SSR
- Simplified data fetching

### UI Component Structure

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/          # Login page
│   ├── (user)/
│   │   ├── page.tsx        # Homepage (discovery)
│   │   ├── search/         # Search page
│   │   ├── requests/       # User's requests
│   │   └── profile/        # User profile
│   ├── (admin)/
│   │   └── admin/          # Admin dashboard and tools
│   └── setup/              # Setup wizard
├── components/
│   ├── audiobooks/         # Audiobook display components
│   ├── requests/           # Request cards, status badges
│   ├── layout/             # Header, navigation, footer
│   └── ui/                 # Reusable UI primitives
└── lib/
    ├── hooks/              # Custom React hooks
    └── utils/              # Client-side utilities
```

## Component Catalog

### Layout Components

**Header** - Top navigation bar
- Logo and app name
- Search input (quick search)
- User menu with avatar
- Login button (when not authenticated)

**Sidebar** - Side navigation (admin pages)
- Dashboard link
- Library management
- Requests
- Users
- Settings

**Footer** - Bottom page footer
- App version
- Links to documentation
- GitHub repository

### Audiobook Components

**AudiobookCard** - Display single audiobook
- Cover art image
- Title and author
- Narrator (if available)
- Duration and rating
- Request button
- Status badge (if requested)

**AudiobookGrid** - Grid layout of audiobook cards
- Responsive grid (1/2/3/4 columns)
- Loading skeletons
- Empty state

**AudiobookDetails** - Modal with full audiobook details
- Large cover art
- Complete metadata
- Description
- Request button with status
- Link to Audible

### Request Components

**RequestCard** - Display single request (✅ Implemented)
- Audiobook cover art with fallback icon
- Title and author
- Status badge with color coding
- Progress bar with animated shimmer (for downloads)
- Active indicator for in-progress requests
- Expandable error messages for failed requests
- Relative timestamps (e.g., "2h ago")
- Cancel button for pending/active requests
- "View in Plex" link for completed requests
- Hover effects and responsive layout

**StatusBadge** - Visual status indicator
- Color coded by status:
  - Pending: yellow
  - Searching: blue
  - Downloading: purple
  - Processing: orange
  - Completed: green
  - Failed: red

**ProgressBar** - Download progress indicator
- Animated fill
- Percentage display
- Pulse animation for active

### Form Components

**SearchBar** - Search input with suggestions
- Debounced input
- Real-time suggestions
- Loading indicator
- Clear button

**Button** - Reusable button component
- Variants: primary, secondary, outline, ghost, danger
- Sizes: sm, md, lg
- Loading state
- Disabled state
- Icon support

**Input** - Form input field
- Label and error display
- Validation states
- Helper text
- Icons

**Select** - Dropdown select
- Custom styling
- Search/filter
- Multi-select option

### Authentication Components

**ProtectedRoute** - Route protection wrapper (✅ Implemented)
- Checks authentication status from AuthContext
- Shows loading state while verifying auth
- Redirects unauthenticated users to /login
- Preserves intended destination URL for post-login redirect
- Supports optional admin role requirement
- Renders children only when authorized

**LoginPage** - Stylized login page (✅ Implemented)
- Full-screen immersive design
- Floating audiobook cover animations
- "Login with Plex" primary CTA
- Plex OAuth integration via popup
- Error handling and user feedback
- Auto-redirect after successful login
- Dark theme optimized

### Admin Components

**MetricCard** - Dashboard metric display
- Icon
- Label
- Value
- Trend indicator
- Color coding

**DataTable** - Sortable, filterable table
- Column sorting
- Search filter
- Pagination
- Row selection
- Action buttons

**Chart** - Data visualization
- Line chart (trends)
- Bar chart (comparisons)
- Pie chart (distributions)

## Tech Stack

**Framework:** Next.js 14+ (App Router)
**UI Library:** React 19
**Styling:** Tailwind CSS 4
**Icons:** Heroicons or Lucide React
**Forms:** React Hook Form + Zod
**State:** React Context API + custom hooks
**Data Fetching:** Native fetch with SWR for caching

## Dependencies

- React and Next.js (already installed)
- Tailwind CSS (already installed)
- Additional packages needed:
  - `@headlessui/react` - Accessible UI components
  - `@heroicons/react` - Icon library
  - `react-hook-form` - Form management
  - `swr` - Data fetching with caching
  - `date-fns` - Date formatting

## Component API Examples

### AudiobookCard

```typescript
interface AudiobookCardProps {
  audiobook: {
    asin: string;
    title: string;
    author: string;
    narrator?: string;
    coverArtUrl?: string;
    rating?: number;
    durationMinutes?: number;
  };
  onRequest?: (asin: string) => void;
  isRequested?: boolean;
  requestStatus?: string;
}
```

### RequestCard

```typescript
interface RequestCardProps {
  request: {
    id: string;
    status: string;
    progress: number;
    audiobook: {
      title: string;
      author: string;
      coverArtUrl?: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  showActions?: boolean;
}
```

## Styling Conventions

### Tailwind Patterns

**Container:**
```tsx
<div className="container mx-auto px-4 py-8 max-w-7xl">
```

**Card:**
```tsx
<div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
```

**Button Primary:**
```tsx
<button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors">
```

**Grid:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
```

### Dark Mode

Use Tailwind's `dark:` variant for dark mode styles:
```tsx
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
```

## State Management

### Custom Hooks

**useAuth** - Authentication state
```typescript
const { user, login, logout, isLoading } = useAuth();
```

**useAudiobooks** - Fetch audiobooks with caching
```typescript
const { audiobooks, isLoading, error } = useAudiobooks('popular');
```

**useRequest** - Create and manage requests
```typescript
const { createRequest, cancelRequest, isLoading } = useRequest();
```

### Context Providers

**AuthProvider** - User authentication context
**ToastProvider** - Toast notifications

## Usage Examples

### Homepage with Discovery

```tsx
export default function HomePage() {
  const { audiobooks: popular } = useAudiobooks('popular');
  const { audiobooks: newReleases } = useAudiobooks('new-releases');

  return (
    <div>
      <section>
        <h2>Popular Audiobooks</h2>
        <AudiobookGrid audiobooks={popular} />
      </section>

      <section>
        <h2>New Releases</h2>
        <AudiobookGrid audiobooks={newReleases} />
      </section>
    </div>
  );
}
```

### Request Creation

```tsx
function AudiobookCard({ audiobook }) {
  const { createRequest, isLoading } = useRequest();

  const handleRequest = async () => {
    await createRequest(audiobook);
    toast.success('Audiobook requested!');
  };

  return (
    <div>
      <img src={audiobook.coverArtUrl} alt={audiobook.title} />
      <h3>{audiobook.title}</h3>
      <p>{audiobook.author}</p>
      <Button
        onClick={handleRequest}
        loading={isLoading}
      >
        Request
      </Button>
    </div>
  );
}
```

### Requests Page (✅ Implemented)

The requests page (`/requests`) displays all user requests with real-time status updates:

**Features:**
- Filter tabs: All, Active, Completed, Failed, Cancelled
- Real-time auto-refresh every 5 seconds (via SWR)
- Request counts in each filter tab
- Loading skeletons for initial load
- Empty states with contextual messages
- Authentication guard (redirects to login if not authenticated)
- Cancel functionality for active requests
- Responsive layout with hover effects

```tsx
export default function RequestsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const { requests, isLoading } = useRequests(apiStatus);

  // Filter requests client-side for 'active' status
  const filteredRequests = filter === 'active'
    ? requests.filter(r => ['pending', 'searching', 'downloading', 'processing'].includes(r.status))
    : requests;

  return (
    <div>
      <Header />
      <main>
        {/* Filter Tabs */}
        <div className="border-b">
          {filterOptions.map(option => (
            <button onClick={() => setFilter(option.value)}>
              {option.label} ({count})
            </button>
          ))}
        </div>

        {/* Request Cards */}
        <div className="space-y-4">
          {filteredRequests.map(request => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      </main>
    </div>
  );
}
```

### Profile Page (✅ Implemented)

The profile page (`/profile`) displays user information and request statistics:

**Features:**
- User information card (avatar, username, email, role, Plex ID)
- Statistics grid with 5 metric cards:
  - Total requests
  - Active requests (pending, searching, downloading, processing)
  - Completed requests
  - Failed requests
  - Cancelled requests
- Active downloads section (only displayed if downloads are in progress)
- Recent requests section (last 5 requests)
- Links to view all requests
- Real-time auto-refresh every 5 seconds (via SWR)
- Loading skeletons for metrics and requests
- Empty state with call-to-action to search audiobooks
- Authentication guard

```tsx
export default function ProfilePage() {
  const { user } = useAuth();
  const { requests, isLoading } = useRequests();

  // Calculate statistics
  const stats = useMemo(() => ({
    total: requests.length,
    completed: requests.filter(r => r.status === 'completed').length,
    active: requests.filter(r => ['pending', 'searching', 'downloading', 'processing'].includes(r.status)).length,
    failed: requests.filter(r => r.status === 'failed').length,
    cancelled: requests.filter(r => r.status === 'cancelled').length,
  }), [requests]);

  return (
    <div>
      <Header />
      <main>
        {/* User Info Card with Avatar and Details */}
        {/* Statistics Grid with 5 Metric Cards */}
        {/* Active Downloads Section */}
        {/* Recent Requests Section */}
      </main>
    </div>
  );
}
```

## Responsive Design

### Breakpoints

- **Mobile:** < 768px (1 column)
- **Tablet:** 768px - 1024px (2 columns)
- **Desktop:** 1024px - 1280px (3 columns)
- **Large Desktop:** > 1280px (4 columns)

### Mobile Optimizations

- Stack navigation vertically
- Full-width cards
- Larger touch targets (min 44x44px)
- Simplified header
- Bottom navigation bar

## Accessibility

### Requirements

- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support
- Focus indicators
- Alt text for images
- Color contrast compliance (WCAG AA)

### Keyboard Shortcuts

- `/` - Focus search
- `Esc` - Close modals
- Arrow keys - Navigate lists
- Enter - Activate buttons

## Performance

### Optimizations

- Image lazy loading with Next.js Image
- Code splitting by route
- Server components where possible
- Memoization for expensive computations
- Virtual scrolling for long lists
- Debounced search input

## Testing Strategy

### Component Tests

- Render tests for all components
- User interaction tests
- Accessibility tests
- Responsive behavior tests

### Integration Tests

- Complete user flows
- Authentication flows
- Request creation flow
- Search and discovery

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **Drag and drop** - Reorder requests
- **Keyboard shortcuts panel** - Help modal
- **Themes** - Multiple color themes
- **Customizable dashboard** - Widget system
- **Advanced filters** - Complex search queries
- **Offline support** - Progressive Web App
- **Animations** - Page transitions
