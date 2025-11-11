/**
 * Component: Setup Wizard Page
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WizardLayout } from './components/WizardLayout';
import { WelcomeStep } from './steps/WelcomeStep';
import { PlexStep } from './steps/PlexStep';
import { ProwlarrStep } from './steps/ProwlarrStep';
import { DownloadClientStep } from './steps/DownloadClientStep';
import { PathsStep } from './steps/PathsStep';
import { ReviewStep } from './steps/ReviewStep';

interface SelectedIndexer {
  id: number;
  name: string;
  priority: number;
}

interface SetupState {
  currentStep: number;
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
    validated: {
      plex: false,
      prowlarr: false,
      downloadClient: false,
      paths: false,
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = 6;

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
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to complete setup');
      }

      // Redirect to homepage after successful setup
      router.push('/');
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
          <PlexStep
            plexUrl={state.plexUrl}
            plexToken={state.plexToken}
            plexLibraryId={state.plexLibraryId}
            onUpdate={updateField}
            onNext={() => goToStep(3)}
            onBack={() => goToStep(1)}
          />
        );

      case 3:
        return (
          <ProwlarrStep
            prowlarrUrl={state.prowlarrUrl}
            prowlarrApiKey={state.prowlarrApiKey}
            onUpdate={updateField}
            onNext={() => goToStep(4)}
            onBack={() => goToStep(2)}
          />
        );

      case 4:
        return (
          <DownloadClientStep
            downloadClient={state.downloadClient}
            downloadClientUrl={state.downloadClientUrl}
            downloadClientUsername={state.downloadClientUsername}
            downloadClientPassword={state.downloadClientPassword}
            onUpdate={updateField}
            onNext={() => goToStep(5)}
            onBack={() => goToStep(3)}
          />
        );

      case 5:
        return (
          <PathsStep
            downloadDir={state.downloadDir}
            mediaDir={state.mediaDir}
            onUpdate={updateField}
            onNext={() => goToStep(6)}
            onBack={() => goToStep(4)}
          />
        );

      case 6:
        return (
          <ReviewStep
            config={state}
            loading={loading}
            error={error}
            onComplete={completeSetup}
            onBack={() => goToStep(5)}
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
