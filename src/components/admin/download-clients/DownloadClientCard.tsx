/**
 * Component: Download Client Card
 * Documentation: documentation/phase3/download-clients.md
 */

'use client';

import React from 'react';
import { DownloadClientType, getClientDisplayName } from '@/lib/interfaces/download-client.interface';

interface DownloadClientCardProps {
  client: {
    id: string;
    type: DownloadClientType;
    name: string;
    url: string;
    enabled: boolean;
    category?: string;
    customPath?: string;
    postImportCategory?: string;
  };
  onEdit: () => void;
  onDelete: () => void;
}

export function DownloadClientCard({ client, onEdit, onDelete }: DownloadClientCardProps) {
  const typeName = getClientDisplayName(client.type);
  const typeColorMap: Record<string, string> = {
    qbittorrent: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    transmission: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    sabnzbd: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    nzbget: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    deluge: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
  };
  const typeColor = typeColorMap[client.type] || typeColorMap.qbittorrent;

  // Truncate URL for display
  const displayUrl = client.url.length > 40 ? `${client.url.substring(0, 40)}...` : client.url;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between gap-3">
        {/* Client Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {client.name}
            </h3>
            {!client.enabled && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                Disabled
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className={`inline-block text-xs px-2 py-1 rounded font-medium ${typeColor} w-fit`}>
              {typeName}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={client.url}>
              {displayUrl}
            </p>
            {client.category && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400 truncate" title={`Category: ${client.category}`}>
                Category: {client.category}
              </p>
            )}
            {client.customPath && (
              <p className="text-xs text-blue-600 dark:text-blue-400 truncate" title={`Custom path: ${client.customPath}`}>
                Path: {client.customPath}
              </p>
            )}
            {client.postImportCategory && (
              <p className="text-xs text-purple-600 dark:text-purple-400 truncate" title={`Post-import category: ${client.postImportCategory}`}>
                Post-import: {client.postImportCategory}
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Edit Button */}
          <button
            onClick={onEdit}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
            title="Edit client"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>

          {/* Delete Button */}
          <button
            onClick={onDelete}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            title="Delete client"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
