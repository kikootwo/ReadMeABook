/**
 * Component: Indexer Config Modal — Torrent Seeding Fields
 * Documentation: documentation/frontend/components.md
 *
 * Renders the torrent-only "Seeding Time" + "Ratio Limit" inputs used by
 * IndexerConfigModal. Extracted to keep the parent modal under 400 lines.
 */

'use client';

import React from 'react';
import { Input } from '@/components/ui/Input';

export interface TorrentSeedingFieldsProps {
  seedingTimeMinutes: number;
  ratioLimit: number;
  errors: { seedingTimeMinutes?: string; ratioLimit?: string };
  onSeedingTimeChange: (value: string) => void;
  onRatioLimitChange: (value: string) => void;
}

export function TorrentSeedingFields({
  seedingTimeMinutes,
  ratioLimit,
  errors,
  onSeedingTimeChange,
  onRatioLimitChange,
}: TorrentSeedingFieldsProps) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Seeding Time (minutes)
        </label>
        <Input
          type="number"
          min="0"
          step="1"
          value={seedingTimeMinutes}
          onChange={(e) => onSeedingTimeChange(e.target.value)}
          placeholder="0"
          className={errors.seedingTimeMinutes ? 'border-red-500' : ''}
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          0 = unlimited seeding (files remain seeded indefinitely)
        </p>
        {errors.seedingTimeMinutes && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {errors.seedingTimeMinutes}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Ratio Limit
        </label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={ratioLimit}
          onChange={(e) => onRatioLimitChange(e.target.value)}
          placeholder="0"
          className={errors.ratioLimit ? 'border-red-500' : ''}
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Minimum upload/download ratio before files are cleaned up. 0 = no ratio requirement.
        </p>
        {errors.ratioLimit && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {errors.ratioLimit}
          </p>
        )}
      </div>
    </>
  );
}
