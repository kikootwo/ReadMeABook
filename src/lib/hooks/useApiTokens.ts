/**
 * Component: Shared API Token Management Hook
 * Documentation: documentation/backend/services/api-tokens.md
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { ApiToken } from '@/lib/types/api-tokens';

/** Typed request body for creating an API token */
export interface CreateTokenBody {
  name: string;
  expiresAt: string | null;
  userId?: string;
  role?: string;
}

interface UseApiTokensConfig {
  /** Base API path, e.g. '/api/admin/api-tokens' or '/api/user/api-tokens' */
  basePath: string;
}

export interface UseApiTokensReturn<T extends ApiToken = ApiToken> {
  tokens: T[];
  loading: boolean;
  creating: boolean;
  error: string | null;
  newTokenName: string;
  setNewTokenName: (name: string) => void;
  newTokenExpiry: string;
  setNewTokenExpiry: (expiry: string) => void;
  showCreateForm: boolean;
  setShowCreateForm: (show: boolean) => void;
  createdToken: string | null;
  copied: boolean;
  deletingId: string | null;
  confirmRevokeId: string | null;
  setConfirmRevokeId: (id: string | null) => void;
  fetchTokens: () => Promise<void>;
  handleCreate: (extraBody?: Partial<CreateTokenBody>) => Promise<boolean>;
  handleDeleteConfirmed: () => Promise<void>;
  handleCopy: () => Promise<void>;
  dismissCreatedToken: () => void;
  resetForm: () => void;
  formatDate: (dateStr: string | null) => string;
}

/**
 * Shared hook for API token CRUD operations.
 * Used by both the admin ApiTab and the user ApiTokensSection.
 */
export function useApiTokens<T extends ApiToken = ApiToken>(
  config: UseApiTokensConfig
): UseApiTokensReturn<T> {
  const [tokens, setTokens] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState('never');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const response = await fetchWithAuth(config.basePath);
      if (!response.ok) {
        let message = 'Failed to load API tokens';
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {
          // Keep default message when response body is not JSON
        }
        setError(message);
        return;
      }

      const data = await response.json();
      setTokens(data.tokens);
      setError(null);
    } catch {
      setError('Failed to load API tokens');
    } finally {
      setLoading(false);
    }
  }, [config.basePath]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const computeExpiresAt = (): string | null => {
    if (newTokenExpiry === 'never') return null;
    const date = new Date();
    switch (newTokenExpiry) {
      case '30d': date.setDate(date.getDate() + 30); break;
      case '90d': date.setDate(date.getDate() + 90); break;
      case '1y': date.setFullYear(date.getFullYear() + 1); break;
    }
    return date.toISOString();
  };

  const handleCreate = async (extraBody?: Partial<CreateTokenBody>) => {
    if (!newTokenName.trim()) {
      setError('Token name is required');
      return false;
    }

    setCreating(true);
    setError(null);

    try {
      const body: CreateTokenBody = {
        name: newTokenName.trim(),
        expiresAt: computeExpiresAt(),
        ...extraBody,
      };

      const response = await fetchWithAuth(config.basePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        setCreatedToken(data.fullToken);
        setNewTokenName('');
        setNewTokenExpiry('never');
        setShowCreateForm(false);
        await fetchTokens();
        return true;
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to create token');
        return false;
      }
    } catch {
      setError('Failed to create token');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    const id = confirmRevokeId;
    if (!id) return;

    setConfirmRevokeId(null);
    setDeletingId(id);
    setError(null);

    try {
      const response = await fetchWithAuth(`${config.basePath}/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setTokens(tokens.filter((t) => t.id !== id));
      } else {
        setError('Failed to revoke token');
      }
    } catch {
      setError('Failed to revoke token');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = async () => {
    if (createdToken) {
      try {
        await navigator.clipboard.writeText(createdToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Failed to copy to clipboard. Please select and copy the token manually.');
      }
    }
  };

  const dismissCreatedToken = () => setCreatedToken(null);

  const resetForm = () => {
    setShowCreateForm(false);
    setNewTokenName('');
    setNewTokenExpiry('never');
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return {
    tokens,
    loading,
    creating,
    error,
    newTokenName,
    setNewTokenName,
    newTokenExpiry,
    setNewTokenExpiry,
    showCreateForm,
    setShowCreateForm,
    createdToken,
    copied,
    deletingId,
    confirmRevokeId,
    setConfirmRevokeId,
    fetchTokens,
    handleCreate,
    handleDeleteConfirmed,
    handleCopy,
    dismissCreatedToken,
    resetForm,
    formatDate,
  };
}
