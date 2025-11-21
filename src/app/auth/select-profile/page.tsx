/**
 * Component: Plex Home Profile Selection Page
 * Documentation: documentation/backend/services/auth.md
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface PlexHomeUser {
  id: string;
  uuid: string;
  title: string;
  friendlyName: string;
  username: string;
  email: string;
  thumb: string;
  hasPassword: boolean;
  restricted: boolean;
  admin: boolean;
  guest: boolean;
  protected: boolean;
}

function SelectProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuthData } = useAuth();

  const [profiles, setProfiles] = useState<PlexHomeUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [showPinInput, setShowPinInput] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get token from session storage (set by OAuth callback)
  const mainAccountToken = typeof window !== 'undefined' ? sessionStorage.getItem('plex_main_token') : null;
  const pinId = searchParams.get('pinId');

  useEffect(() => {
    if (!mainAccountToken || !pinId) {
      setError('Invalid session. Please try logging in again.');
      setIsLoading(false);
      return;
    }

    // Fetch home users
    const fetchProfiles = async () => {
      try {
        const response = await fetch('/api/auth/plex/home-users', {
          headers: {
            'X-Plex-Token': mainAccountToken,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch profiles');
        }

        const data = await response.json();
        setProfiles(data.users || []);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to fetch profiles:', err);
        setError('Failed to load profiles. Please try again.');
        setIsLoading(false);
      }
    };

    fetchProfiles();
  }, [mainAccountToken, pinId]);

  const handleProfileSelect = async (profile: PlexHomeUser) => {
    setSelectedProfile(profile.id);
    setPinError(null);

    // If profile is protected, show PIN input
    if (profile.protected && profile.hasPassword) {
      setShowPinInput(true);
      return;
    }

    // Otherwise, proceed with selection
    await completeProfileSelection(profile.id, undefined);
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile || !pin) return;

    await completeProfileSelection(selectedProfile, pin);
  };

  const completeProfileSelection = async (profileId: string, profilePin?: string) => {
    if (!mainAccountToken) return;

    setIsSubmitting(true);
    setPinError(null);

    // Get the selected profile info
    const selectedProfileInfo = profiles.find(p => p.id === profileId);
    if (!selectedProfileInfo) {
      setError('Selected profile not found');
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/plex/switch-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plex-Token': mainAccountToken,
        },
        body: JSON.stringify({
          userId: profileId,
          pin: profilePin,
          pinId,
          profileInfo: {
            friendlyName: selectedProfileInfo.friendlyName,
            email: selectedProfileInfo.email,
            thumb: selectedProfileInfo.thumb,
            uuid: selectedProfileInfo.uuid,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setPinError('Invalid PIN. Please try again.');
          setPin('');
          setIsSubmitting(false);
          return;
        }
        throw new Error(data.message || 'Failed to switch profile');
      }

      // Success! Store auth data and redirect
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Update auth context
      setAuthData(data.user, data.accessToken);

      // Clear session storage
      sessionStorage.removeItem('plex_main_token');

      // Redirect to home
      router.push('/');
    } catch (err: any) {
      console.error('Failed to select profile:', err);
      setError(err.message || 'Failed to select profile. Please try again.');
      setIsSubmitting(false);
      setShowPinInput(false);
      setSelectedProfile(null);
      setPin('');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading profiles...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full">
          <h1 className="text-2xl font-bold text-red-500 mb-4">Error</h1>
          <p className="text-gray-300 mb-6">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (showPinInput && selectedProfile) {
    const profile = profiles.find(p => p.id === selectedProfile);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full">
          <button
            onClick={() => {
              setShowPinInput(false);
              setSelectedProfile(null);
              setPin('');
              setPinError(null);
            }}
            className="text-gray-400 hover:text-gray-300 mb-4"
          >
            ← Back to profiles
          </button>

          <div className="text-center mb-6">
            {profile?.thumb && (
              <div className="w-24 h-24 mx-auto mb-4 rounded-full overflow-hidden bg-gray-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={profile.thumb}
                  alt={profile.friendlyName}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <h2 className="text-2xl font-bold text-white mb-2">{profile?.friendlyName}</h2>
            <p className="text-gray-400">Enter PIN to continue</p>
          </div>

          <form onSubmit={handlePinSubmit}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-orange-500 text-center text-2xl tracking-widest"
              maxLength={4}
              autoFocus
              disabled={isSubmitting}
            />

            {pinError && (
              <p className="text-red-500 text-sm mb-4">{pinError}</p>
            )}

            <button
              type="submit"
              disabled={!pin || isSubmitting}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {isSubmitting ? 'Continuing...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-4xl w-full">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">Who's listening?</h1>
        <p className="text-gray-400 mb-8 text-center">Select your profile to continue</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => handleProfileSelect(profile)}
              disabled={isSubmitting}
              className="group flex flex-col items-center p-4 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="relative w-24 h-24 mb-3 rounded-full overflow-hidden bg-gray-700 ring-4 ring-transparent group-hover:ring-orange-500 transition-all">
                {profile.thumb ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={profile.thumb}
                    alt={profile.friendlyName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-500 to-red-600">
                    <span className="text-3xl font-bold text-white">
                      {profile.friendlyName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                {profile.protected && (
                  <div className="absolute bottom-0 right-0 bg-gray-900 rounded-full p-1">
                    <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
              <span className="text-white font-medium text-center group-hover:text-orange-500 transition-colors">
                {profile.friendlyName}
              </span>
              {profile.restricted && (
                <span className="text-xs text-gray-500 mt-1">Managed</span>
              )}
            </button>
          ))}
        </div>

        {profiles.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-4">No profiles found for this account.</p>
            <button
              onClick={() => router.push('/login')}
              className="text-orange-500 hover:text-orange-400"
            >
              Back to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SelectProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-gray-300">Loading...</p>
          </div>
        </div>
      }
    >
      <SelectProfileContent />
    </Suspense>
  );
}
