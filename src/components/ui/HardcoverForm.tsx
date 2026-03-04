/**
 * Component: Hardcover Shelf Form
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import { Input } from './Input';

// ---------------------------------------------------------------------------
// Status option definitions
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  {
    id: '1',
    label: 'Want to Read',
    description: 'Books saved to read later',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
      </svg>
    ),
  },
  {
    id: '2',
    label: 'Currently Reading',
    description: 'Books actively being read',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    id: '3',
    label: 'Read',
    description: 'Books already finished',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    id: '4',
    label: 'Did Not Finish',
    description: 'Books started but set aside',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HardcoverFormProps {
  apiToken: string;
  setApiToken: (v: string) => void;
  listType: 'status' | 'custom';
  setListType: (v: 'status' | 'custom') => void;
  statusId: string;
  setStatusId: (v: string) => void;
  customListId: string;
  setCustomListId: (v: string) => void;
  validationError: string;
  setValidationError: (v: string) => void;
  isLoading: boolean;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HardcoverForm({
  apiToken, setApiToken,
  listType, setListType,
  statusId, setStatusId,
  customListId, setCustomListId,
  validationError, setValidationError,
  isLoading, success,
}: HardcoverFormProps) {
  const disabled = isLoading || success;
  const isTokenError = validationError === 'Hardcover API Token is required';
  const isListError = !isTokenError && !!validationError;

  return (
    <div className="space-y-5">

      {/* API Token */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            API Token
          </label>
          <a
            href="https://hardcover.app/account/api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors flex items-center gap-1 group"
          >
            Get your token
            <svg className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
        <input
          type="password"
          value={apiToken}
          onChange={(e) => {
            setApiToken(e.target.value);
            if (isTokenError) setValidationError('');
          }}
          placeholder="Paste your Hardcover API token"
          disabled={disabled}
          className={[
            'block w-full rounded-lg border px-4 py-2 text-sm transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/60',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'bg-white dark:bg-gray-800/60 text-gray-900 dark:text-white',
            'placeholder-gray-400 dark:placeholder-gray-500',
            isTokenError
              ? 'border-red-400 dark:border-red-500'
              : 'border-gray-200 dark:border-gray-700',
          ].join(' ')}
        />
        {isTokenError && (
          <p className="text-xs text-red-500 dark:text-red-400">{validationError}</p>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          Found under{' '}
          <span className="font-medium text-gray-500 dark:text-gray-400">Settings &rarr; API</span>
          {' '}on hardcover.app. Stored securely and never shared.
        </p>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100 dark:border-gray-700/60" />

      {/* List Type Selection */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Which list should we watch?
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Choose a reading status or one of your custom lists.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <ListTypeCard
            active={listType === 'status'}
            onClick={() => setListType('status')}
            disabled={disabled}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
              </svg>
            }
            title="Reading Status"
            subtitle="Want to Read, Reading, Read, etc."
          />
          <ListTypeCard
            active={listType === 'custom'}
            onClick={() => setListType('custom')}
            disabled={disabled}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            }
            title="Custom List"
            subtitle="A list you created on Hardcover"
          />
        </div>
      </div>

      {/* Status picker or Custom list input */}
      {listType === 'status' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Status to sync</p>
          <div className="space-y-1.5">
            {STATUS_OPTIONS.map((opt) => (
              <StatusRow
                key={opt.id}
                opt={opt}
                selected={statusId === opt.id}
                onSelect={() => setStatusId(opt.id)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            type="text"
            label="List URL or Slug"
            value={customListId}
            onChange={(e) => {
              setCustomListId(e.target.value);
              if (isListError) setValidationError('');
            }}
            placeholder="https://hardcover.app/@username/lists/..."
            error={isListError ? validationError : ''}
            disabled={disabled}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            Paste the list URL from Hardcover, or enter just the slug (e.g.{' '}
            <code className="font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1 py-0.5 rounded text-[11px]">my-audiobooks</code>
            ) or a numeric ID.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ListTypeCard({
  active, onClick, disabled, icon, title, subtitle,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'relative text-left p-3 rounded-xl border-2 transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        active
          ? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50/70 dark:bg-indigo-500/[0.08]'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/60',
      ].join(' ')}
    >
      {active && (
        <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400" />
      )}
      <div className={[
        'w-7 h-7 rounded-lg flex items-center justify-center mb-2',
        active
          ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
      ].join(' ')}>
        {icon}
      </div>
      <p className={`text-sm font-medium leading-tight ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}>
        {title}
      </p>
      <p className={`text-xs mt-0.5 leading-snug ${active ? 'text-indigo-500/80 dark:text-indigo-400/70' : 'text-gray-400 dark:text-gray-500'}`}>
        {subtitle}
      </p>
    </button>
  );
}

function StatusRow({
  opt, selected, onSelect, disabled,
}: {
  opt: typeof STATUS_OPTIONS[number];
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={[
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-150 text-left',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        selected
          ? 'border-indigo-400/70 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/[0.08]'
          : 'border-gray-200 dark:border-gray-700/80 bg-white dark:bg-gray-800/30 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50/80 dark:hover:bg-gray-800/50',
      ].join(' ')}
    >
      <span className={`flex-shrink-0 ${selected ? 'text-indigo-500 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'}`}>
        {opt.icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium ${selected ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}>
          {opt.label}
        </span>
        <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {opt.description}
        </span>
      </span>
      {selected && (
        <span className="flex-shrink-0">
          <svg className="w-4 h-4 text-indigo-500 dark:text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
          </svg>
        </span>
      )}
    </button>
  );
}
