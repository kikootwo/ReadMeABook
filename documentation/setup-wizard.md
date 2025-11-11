# Setup Wizard

## Current State

**Status:** Completed ✅

The setup wizard guides first-time users through configuring ReadMeABook, connecting external services, and setting up directory paths. All six steps are implemented with connection testing, validation, and database persistence.

**Implemented Features:**
- 6-step wizard with progress indicator
- Connection testing for all external services (Plex, Prowlarr, qBittorrent)
- Path validation with write permission checking
- Configuration persistence to database
- Error handling and user feedback
- Dark mode support throughout

## Design Architecture

### Why a Setup Wizard?

**Requirements:**
- First-time users need to configure multiple external services
- Configuration must be validated before saving
- Step-by-step approach reduces overwhelm
- Progress indication improves UX
- Ability to test connections before proceeding

### User Flow

```
1. Welcome Screen
   - Explain what will be configured
   - Show estimated time (5-10 minutes)

2. Plex Configuration
   - Server URL input
   - Authentication (reuse existing Plex OAuth)
   - Library selection (choose audiobook library)
   - Test connection button

3. Prowlarr Configuration
   - Server URL input
   - API key input
   - Test connection button
   - Show available indexers count

4. Download Client Configuration
   - Choose client: qBittorrent or Transmission
   - Server URL input
   - Username/password input
   - Test connection button

5. Directory Paths
   - Download directory path
   - Media directory path (where audiobooks will be organized)
   - Validation that paths are writable

6. Review & Complete
   - Summary of all configurations
   - Save to database
   - Redirect to homepage
```

## Implementation Details

### Component Structure

```
src/app/setup/
├── page.tsx                    # Main wizard container
├── steps/
│   ├── WelcomeStep.tsx        # Step 1: Introduction
│   ├── PlexStep.tsx           # Step 2: Plex configuration
│   ├── ProwlarrStep.tsx       # Step 3: Indexer configuration
│   ├── DownloadClientStep.tsx # Step 4: Download client
│   ├── PathsStep.tsx          # Step 5: Directory paths
│   └── ReviewStep.tsx         # Step 6: Review and save
└── components/
    ├── WizardLayout.tsx       # Progress indicator, navigation
    ├── ConnectionTest.tsx     # Reusable connection test button
    └── StepNavigation.tsx     # Back/Next/Skip buttons
```

### State Management

```typescript
interface SetupState {
  currentStep: number;
  totalSteps: number;

  // Plex
  plexUrl: string;
  plexToken: string;
  plexLibraryId: string;

  // Prowlarr
  prowlarrUrl: string;
  prowlarrApiKey: string;

  // Download Client
  downloadClient: 'qbittorrent' | 'transmission';
  downloadClientUrl: string;
  downloadClientUsername: string;
  downloadClientPassword: string;

  // Paths
  downloadDir: string;
  mediaDir: string;

  // Validation
  validated: {
    plex: boolean;
    prowlarr: boolean;
    downloadClient: boolean;
    paths: boolean;
  };
}
```

### API Endpoints

**POST /api/setup/test-plex**
- Tests Plex connection
- Returns libraries if successful

**POST /api/setup/test-prowlarr**
- Tests Prowlarr connection
- Returns indexer count if successful

**POST /api/setup/test-download-client**
- Tests qBittorrent/Transmission connection
- Returns client version if successful

**POST /api/setup/complete**
- Saves all configuration to database
- Marks setup as complete
- Returns success status

## Tech Stack

**Frontend:**
- React Context for state management
- React Hook Form for validation
- Multi-step form pattern
- Progress indicators

**Backend:**
- Configuration service for storage
- Validation before saving
- Connection testing utilities

## Dependencies

**Existing:**
- Configuration service
- Plex service
- Prowlarr service
- qBittorrent service

**New:**
- None (uses existing services)

## Usage Examples

### Welcome Step

```tsx
<WizardLayout currentStep={1} totalSteps={6}>
  <WelcomeStep
    onNext={() => goToStep(2)}
  />
</WizardLayout>
```

### Plex Configuration Step

```tsx
<WizardLayout currentStep={2} totalSteps={6}>
  <PlexStep
    plexUrl={state.plexUrl}
    plexToken={state.plexToken}
    onUrlChange={setPlexUrl}
    onTokenChange={setPlexToken}
    onTest={testPlexConnection}
    onNext={() => goToStep(3)}
    onBack={() => goToStep(1)}
  />
</WizardLayout>
```

### Complete Setup

```tsx
async function completeSetup() {
  const response = await fetch('/api/setup/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });

  if (response.ok) {
    router.push('/');
  }
}
```

## Validation Rules

**Plex:**
- URL must be valid (http:// or https://)
- Token must not be empty
- Connection test must succeed
- At least one library must be available

**Prowlarr:**
- URL must be valid
- API key must not be empty
- Connection test must succeed

**Download Client:**
- URL must be valid
- Username and password required for qBittorrent
- Connection test must succeed

**Paths:**
- Paths must be absolute
- Paths must exist (or be creatable)
- Paths must be writable

## Security Considerations

**Sensitive Data:**
- API keys are encrypted before storage
- Passwords are encrypted before storage
- Tokens are never logged in plaintext

**Validation:**
- All inputs are sanitized
- Connection tests have timeouts
- Failed attempts are rate-limited

## Known Issues

### Fixed Issues ✅

**1. Plex Server Info Parsing (Fixed)**
- **Issue:** Success message showed "Connected to undefined undefined successfully!"
- **Root Cause:** Plex `/identity` endpoint returns XML by default, not JSON. The XML parsing wasn't correctly extracting server info attributes.
- **Fix:** Updated `testConnection` method in `plex.service.ts` to properly parse XML attributes from `MediaContainer.$` object. Added fallback values to prevent undefined values in success message.

**2. Library Selection Display**
- **Issue:** Library selection dropdown appears correctly after successful connection test
- **Implementation:** Dropdown is conditionally rendered when `libraries.length > 0` and properly maps library data from the test connection response.

## Future Enhancements

- **Import/Export**: Allow exporting configuration for backup
- **Advanced Mode**: Show additional optional settings
- **Auto-discovery**: Automatically find Plex/Prowlarr on local network
- **Migration**: Import settings from Radarr/Sonarr
- **Multi-user**: Setup wizard for each user's Plex account
