# Frontend Components

**Status:** ⏳ In Development

React components for ReadMeABook UI built with Next.js 14+, TypeScript, and Tailwind CSS.

## Structure

```
src/app/
├── (auth)/login/
├── (user)/page.tsx, search/, requests/, profile/
├── (admin)/admin/
└── setup/

src/components/
├── audiobooks/    # Audiobook display
├── requests/      # Request cards, status
├── layout/        # Header, nav, footer
└── ui/            # Reusable primitives
```

## Key Components

**Layout**
- **Header** - Top nav, search input, user menu
- **Sidebar** - Admin side nav
- **Footer** - Version, links

**Audiobooks**
- **AudiobookCard** ✅ - Cover, title, author, narrator, duration, request button, clickable to open details modal. Shows "Requested by [username]" when someone else has requested the book, "Requested" when current user has requested it
- **AudiobookGrid** - Responsive grid (1/2/3/4 cols)
- **AudiobookDetailsModal** ✅ - Full-screen modal with comprehensive metadata (description, genres, rating, release date, narrator, request functionality). Shows requesting user's name when applicable

**Requests**
- **RequestCard** ✅ - Cover, title, author, status badge, progress bar, timestamps, action buttons (cancel, manual search, interactive search)
- **StatusBadge** - Color-coded status (pending=yellow, searching=blue, downloading=purple, downloaded=green, processing=orange, available=green, completed=green, failed=red, warn=orange, cancelled=gray). Shows "Initializing..." when downloading with 0% progress (fetching torrent info), "Downloading" when progress > 0%
- **ProgressBar** - Animated fill with percentage
- **InteractiveTorrentSearchModal** ✅ - Responsive table of ranked torrent results, uses ConfirmModal for downloads, hides columns on smaller screens (size on mobile, seeds on tablet, indexer on desktop)
- Active indicator: "Setting up..." with spinner when progress = 0%, "Active" with pulsing dot when progress > 0%

**Forms**
- **SearchBar** - Debounced input with suggestions
- **Button** - Variants (primary/secondary/outline/ghost/danger), sizes (sm/md/lg), loading state
- **Input** - Label, error display, validation, icons
- **Select** - Custom styling, search/filter
- **Modal** ✅ - Dialog overlay with backdrop, sizes (sm/md/lg/xl/full), ESC to close, body scroll lock
- **ConfirmModal** ✅ - Confirmation dialog with customizable title, message, buttons, loading state, and variant (primary/danger)
- **Pagination** ✅ - Traditional page navigation with prev/next buttons, smart ellipsis (shows 1...4 5 6...10)
- **StickyPagination** ✅ - Minimal floating pill at bottom center with prev/next arrows, quick jump input, section label. Shows/hides based on section visibility (IntersectionObserver). Rounded-full design, backdrop blur, subtle shadow, auto-scroll on page change

**Auth**
- **ProtectedRoute** ✅ - Auth check, loading state, redirects, admin role support
- **LoginPage** ✅ - Full-screen design, floating covers, Plex OAuth popup

**Admin**
- **MetricCard** - Icon, label, value, trend
- **DataTable** - Sorting, filtering, pagination
- **Chart** - Line/bar/pie

## Pages Implemented ✅

**Homepage** (`/`)
- Popular Audiobooks and New Releases sections with distinct visual separation
- Sticky section headers with rounded-2xl design matching section card aesthetic
- Gradient accent bars for each section (blue/purple for Popular, emerald/teal for New Releases)
- Headers use rounded cards (bg-white/90 dark:bg-gray-800/90) with backdrop blur
- Section content wrapped in semi-transparent rounded cards (bg-white/40 dark:bg-gray-800/40)
- Cohesive rounded design language throughout (rounded-2xl on headers and containers)
- Floating pagination pill at bottom center of viewport
- Minimal design: section label | ← | Page X of Y | →
- Quick jump input (type page number + Enter)
- Auto-shows when scrolling through a section (IntersectionObserver)
- Auto-scrolls to section top on page change
- Rounded-full design with backdrop blur and subtle shadow
- Responsive grid layouts (1/2/3/4 cols)
- Enhanced CTA section with gradient background (blue-to-indigo)

**Requests Page** (`/requests`)
- Filter tabs: All, Active, Waiting, Completed, Failed, Cancelled
- Auto-refresh every 5s (SWR)
- Request counts per tab
- Cancel functionality
- Loading skeletons, empty states
- Waiting filter shows awaiting_search and awaiting_import statuses

**Profile Page** (`/profile`)
- User info card (avatar, username, email, role, Plex ID)
- Stats: Total/Active/Waiting/Completed/Failed/Cancelled requests
- Active downloads section
- Recent requests (last 5)
- Auto-refresh every 5s
- Waiting stat shows awaiting_search and awaiting_import statuses

## Component APIs

```typescript
interface AudiobookCardProps {
  audiobook: {asin, title, author, narrator?, coverArtUrl?, rating?, durationMinutes?, isRequested?, requestStatus?, requestedByUsername?};
  onRequest?: (asin: string) => void;
  isRequested?: boolean;
  requestStatus?: string;
  onRequestSuccess?: () => void;
}

interface AudiobookDetailsModalProps {
  asin: string;
  isOpen: boolean;
  onClose: () => void;
  onRequestSuccess?: () => void;
  isRequested?: boolean;
  requestStatus?: string | null;
  isAvailable?: boolean;
  requestedByUsername?: string | null;
}

interface RequestCardProps {
  request: {id, status, progress, audiobook: {title, author, coverArtUrl?}, createdAt, updatedAt};
  showActions?: boolean;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
}

interface InteractiveTorrentSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  audiobook: {title: string, author: string};
}

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  variant?: 'danger' | 'primary';
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

interface StickyPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  sectionRef: React.RefObject<HTMLElement | null>;
  label: string;
}
```

## Custom Hooks

- **useAuth** - `{user, login, logout, isLoading}`
- **useAudiobooks** - `{audiobooks, isLoading, error, totalPages, hasMore}`
- **useAudiobookDetails** ✅ - `{audiobook, isLoading, error}` - Fetches individual audiobook by ASIN
- **useRequest** - `{createRequest, cancelRequest, isLoading}`

## Styling

**Tailwind Patterns:**
- Container: `container mx-auto px-4 py-8 max-w-7xl`
- Card: `bg-white dark:bg-gray-800 rounded-lg shadow-md p-6`
- Button: `bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md`
- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6`

**Dark Mode:** Use `dark:` variant

## Responsive Breakpoints

- Mobile: <768px (1 col)
- Tablet: 768-1024px (2 cols)
- Desktop: 1024-1280px (3 cols)
- Large: >1280px (4 cols)

## Tech Stack

- Next.js 14+ App Router
- React 19
- Tailwind CSS 4
- Heroicons/Lucide React
- React Hook Form + Zod
- SWR (data fetching)
- date-fns (formatting)
