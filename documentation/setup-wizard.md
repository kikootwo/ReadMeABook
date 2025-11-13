# Setup Wizard

## Current State

**Status:** Completed ✅

The setup wizard guides first-time users through configuring ReadMeABook, connecting external services, and setting up directory paths. All eight steps are implemented with connection testing, validation, database persistence, and automated initial job execution.

**Implemented Features:**
- 8-step wizard with progress indicator
- Connection testing for all external services (Plex, Prowlarr, qBittorrent)
- Path validation with write permission checking
- Configuration persistence to database
- Automated initial job execution (Audible refresh, Plex scan)
- Auto-enabling of scheduled jobs
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
   - Display available indexers with checkbox selection
   - Assign priority (1-25) to each selected indexer
   - Higher priority indexers are preferred when ranking search results

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
   - Create admin account and generate auth tokens

7. Finalize Setup
   - Run initial Audible data refresh
   - Run initial Plex library scan
   - Show job execution status
   - Enable scheduled jobs for future runs
   - Redirect to homepage
```

## Implementation Details

### Component Structure

```
src/app/setup/
├── page.tsx                    # Main wizard container
├── steps/
│   ├── WelcomeStep.tsx        # Step 1: Introduction
│   ├── AdminAccountStep.tsx   # Step 2: Admin account creation
│   ├── PlexStep.tsx           # Step 3: Plex configuration
│   ├── ProwlarrStep.tsx       # Step 4: Indexer configuration
│   ├── DownloadClientStep.tsx # Step 5: Download client
│   ├── PathsStep.tsx          # Step 6: Directory paths
│   ├── ReviewStep.tsx         # Step 7: Review and save
│   └── FinalizeStep.tsx       # Step 8: Run initial jobs
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
  prowlarrIndexers: Array<{
    id: number;
    name: string;
    priority: number;
  }>;

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
- Returns indexer count and indexer details (id, name, protocol) if successful
- Allows user to select which indexers to use and assign priorities

**POST /api/setup/test-download-client**
- Tests qBittorrent/Transmission connection
- Returns client version if successful

**POST /api/setup/complete**
- Saves all configuration to database
- Creates admin user account
- Enables auto jobs (Plex Library Scan, Audible Data Refresh)
- Marks setup as complete
- Returns JWT tokens for auto-login

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
    const data = await response.json();

    // Store auth tokens
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Go to finalize step
    goToStep(8);
  }
}
```

### Finalize Step

```tsx
<WizardLayout currentStep={8} totalSteps={8}>
  <FinalizeStep
    onComplete={() => window.location.href = '/'}
    onBack={() => goToStep(7)}
  />
</WizardLayout>
```

The FinalizeStep automatically:
1. Fetches all scheduled jobs from `/api/admin/jobs`
2. Finds the `plex_library_scan` and `audible_refresh` jobs
3. Triggers both jobs via `/api/admin/jobs/:id/trigger`
4. Shows real-time status of each job execution
5. Enables "Finish Setup" button when complete

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
- At least one indexer must be selected
- Each selected indexer must have a priority between 1-25

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

**3. Authentication Requirement for Setup Completion (Fixed)**
- **Issue:** Setup completion endpoint returned "Error No authentication token provided" when completing the wizard.
- **Root Cause:** The `/api/setup/complete` endpoint used `requireAuth` middleware, but the setup wizard runs before user login.
- **Fix:** Removed authentication requirement from the setup completion endpoint since it runs before users can authenticate.

**4. Plex Token Hint Incorrect (Fixed)**
- **Issue:** The hint for finding the Plex token showed incorrect path: "Find your token in Plex settings → Network → "Show Advanced" → X-Plex-Token"
- **Fix:** Updated to link to official Plex documentation: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/

**5. Prowlarr Indexer Selection Added (Feature)**
- **Issue:** Users were unable to select which Prowlarr indexers to use - all indexers were used by default.
- **Implementation:**
  - Added indexer selection UI with checkboxes for each available indexer
  - Added priority input (1-25) for each selected indexer
  - Higher priority indexers are preferred when ranking search results
  - Indexers with equal priority compete on a level playing field
  - Auto-selects all indexers with default priority of 10 on successful connection
  - Validates that at least one indexer is selected before proceeding
  - Saves indexer configuration (id, name, priority) to database as JSON

**6. Initial Job Execution Added (Feature)**
- **Implementation:** Added FinalizeStep (step 8) that automatically runs initial jobs after setup completion
  - Audible Data Refresh: Fetches popular and new releases to populate browse catalog
  - Plex Library Scan: Discovers audiobooks already in user's Plex library
  - Both jobs are enabled by default in the scheduler
  - Shows real-time execution status with visual indicators
  - Provides descriptive text explaining what each job does
  - Prevents navigation until jobs complete or fail

## Future Enhancements

- **Import/Export**: Allow exporting configuration for backup
- **Advanced Mode**: Show additional optional settings
- **Auto-discovery**: Automatically find Plex/Prowlarr on local network
- **Migration**: Import settings from Radarr/Sonarr
- **Multi-user**: Setup wizard for each user's Plex account
