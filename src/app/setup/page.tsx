/**
 * Component: Setup Wizard Page
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WizardLayout } from './components/WizardLayout';
import { WelcomeStep } from './steps/WelcomeStep';
import { AdminAccountStep } from './steps/AdminAccountStep';
import { PlexStep } from './steps/PlexStep';
import { ProwlarrStep } from './steps/ProwlarrStep';
import { DownloadClientStep } from './steps/DownloadClientStep';
import { PathsStep } from './steps/PathsStep';
import { BookDateStep } from './steps/BookDateStep';
import { ReviewStep } from './steps/ReviewStep';
import { FinalizeStep } from './steps/FinalizeStep';

interface SelectedIndexer {
  id: number;
  name: string;
  priority: number;
}

interface SetupState {
  currentStep: number;
  adminUsername: string;
  adminPassword: string;
  plexUrl: string;
  plexToken: string;
  plexLibraryId: string;
  prowlarrUrl: string;
  prowlarrApiKey: string;
  prowlarrIndexers: SelectedIndexer[];
  downloadClient: 'qbittorrent' | 'transmission';
  downloadClientUrl: string;
  downloadClientUsername: string;
  downloadClientPassword: string;
  downloadDir: string;
  mediaDir: string;
  bookdateProvider: string;
  bookdateApiKey: string;
  bookdateModel: string;
  bookdateLibraryScope: string;
  bookdateCustomPrompt: string;
  bookdateConfigured: boolean;
  validated: {
    plex: boolean;
    prowlarr: boolean;
    downloadClient: boolean;
    paths: boolean;
  };
}

export default function SetupWizard() {
  const router = useRouter();
  const [state, setState] = useState<SetupState>({
    currentStep: 1,
    adminUsername: 'admin',
    adminPassword: '',
    plexUrl: '',
    plexToken: '',
    plexLibraryId: '',
    prowlarrUrl: '',
    prowlarrApiKey: '',
    prowlarrIndexers: [],
    downloadClient: 'qbittorrent',
    downloadClientUrl: '',
    downloadClientUsername: 'admin',
    downloadClientPassword: '',
    downloadDir: '/downloads',
    mediaDir: '/media/audiobooks',
    bookdateProvider: 'openai',
    bookdateApiKey: '',
    bookdateModel: '',
    bookdateLibraryScope: 'full',
    bookdateCustomPrompt: '',
    bookdateConfigured: false,
    validated: {
      plex: false,
      prowlarr: false,
      downloadClient: false,
      paths: false,
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = 9;

  const updateState = (updates: Partial<SetupState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  };

  const updateField = (field: string, value: any) => {
    setState((prev) => ({ ...prev, [field]: value }));
  };

  const goToStep = (step: number) => {
    setState((prev) => ({ ...prev, currentStep: step }));
    setError(null);
  };

  const completeSetup = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin: {
            username: state.adminUsername,
            password: state.adminPassword,
          },
          plex: {
            url: state.plexUrl,
            token: state.plexToken,
            audiobook_library_id: state.plexLibraryId,
          },
          prowlarr: {
            url: state.prowlarrUrl,
            api_key: state.prowlarrApiKey,
            indexers: state.prowlarrIndexers,
          },
          downloadClient: {
            type: state.downloadClient,
            url: state.downloadClientUrl,
            username: state.downloadClientUsername,
            password: state.downloadClientPassword,
          },
          paths: {
            download_dir: state.downloadDir,
            media_dir: state.mediaDir,
          },
          bookdate: state.bookdateConfigured ? {
            provider: state.bookdateProvider,
            apiKey: state.bookdateApiKey,
            model: state.bookdateModel,
            libraryScope: state.bookdateLibraryScope,
            customPrompt: state.bookdateCustomPrompt || null,
          } : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to complete setup');
      }

      const data = await response.json();

      // Store admin auth tokens
      if (data.accessToken && data.refreshToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('user', JSON.stringify(data.user));

        // Go to finalize step to run initial jobs
        goToStep(9);
      } else {
        // Fallback if no tokens returned
        goToStep(9);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (state.currentStep) {
      case 1:
        return <WelcomeStep onNext={() => goToStep(2)} />;

      case 2:
        return (
          <AdminAccountStep
            adminUsername={state.adminUsername}
            adminPassword={state.adminPassword}
            onUpdate={updateField}
            onNext={() => goToStep(3)}
            onBack={() => goToStep(1)}
          />
        );

      case 3:
        return (
          <PlexStep
            plexUrl={state.plexUrl}
            plexToken={state.plexToken}
            plexLibraryId={state.plexLibraryId}
            onUpdate={updateField}
            onNext={() => goToStep(4)}
            onBack={() => goToStep(2)}
          />
        );

      case 4:
        return (
          <ProwlarrStep
            prowlarrUrl={state.prowlarrUrl}
            prowlarrApiKey={state.prowlarrApiKey}
            onUpdate={updateField}
            onNext={() => goToStep(5)}
            onBack={() => goToStep(3)}
          />
        );

      case 5:
        return (
          <DownloadClientStep
            downloadClient={state.downloadClient}
            downloadClientUrl={state.downloadClientUrl}
            downloadClientUsername={state.downloadClientUsername}
            downloadClientPassword={state.downloadClientPassword}
            onUpdate={updateField}
            onNext={() => goToStep(6)}
            onBack={() => goToStep(4)}
          />
        );

      case 6:
        return (
          <PathsStep
            downloadDir={state.downloadDir}
            mediaDir={state.mediaDir}
            onUpdate={updateField}
            onNext={() => goToStep(7)}
            onBack={() => goToStep(5)}
          />
        );

      case 7:
        return (
          <BookDateStep
            bookdateProvider={state.bookdateProvider}
            bookdateApiKey={state.bookdateApiKey}
            bookdateModel={state.bookdateModel}
            bookdateLibraryScope={state.bookdateLibraryScope}
            bookdateCustomPrompt={state.bookdateCustomPrompt}
            bookdateConfigured={state.bookdateConfigured}
            onUpdate={updateField}
            onNext={() => goToStep(8)}
            onSkip={() => goToStep(8)}
            onBack={() => goToStep(6)}
          />
        );

      case 8:
        return (
          <ReviewStep
            config={state}
            loading={loading}
            error={error}
            onComplete={completeSetup}
            onBack={() => goToStep(7)}
          />
        );

      case 9:
        return (
          <FinalizeStep
            onComplete={() => {
              // Force full page reload to initialize auth context with new tokens
              window.location.href = '/';
            }}
            onBack={() => goToStep(8)}
          />
        );

      default:
        return null;
    }
  };

  return (
    <WizardLayout currentStep={state.currentStep} totalSteps={totalSteps}>
      {renderStep()}
    </WizardLayout>
  );
}
