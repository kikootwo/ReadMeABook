/**
 * Component: LogDetailPanel
 * Documentation: documentation/admin-dashboard.md
 *
 * Three collapsible sub-sections (Event Log / Result / Error) with count badges.
 * Per-event level filter. Copy-to-clipboard on each event, full event log,
 * result JSON, error block, and Bull Job ID. Toast confirmations.
 * Default open on desktop (`defaultOpen` prop), collapsed on mobile.
 *
 * NO "View related request" link — no admin request detail page exists (Zach #4).
 */

'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { JobEvent, Log } from '../types';

type Level = 'all' | 'info' | 'warn' | 'error';

// ===========================================================================
// CopyButton — extracted because used 5+ times
// ===========================================================================

interface CopyButtonProps {
  text: string;
  label: string;
  className?: string;
  /** When true, render as a compact icon-only button. */
  iconOnly?: boolean;
}

function CopyButton({ text, label, className, iconOnly = false }: CopyButtonProps) {
  const toast = useToast();

  const handleClick = async () => {
    const ok = await copyToClipboard(text);
    if (ok) toast.success(`Copied ${label}`);
    else toast.error('Copy unavailable on insecure connection');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Copy ${label}`}
      className={
        className ??
        'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors'
      }
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      {!iconOnly && <span>Copy</span>}
    </button>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to textarea fallback
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// ===========================================================================
// EventLine — single row in the event log
// ===========================================================================

function levelColorClass(level: string): string {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn') return 'text-amber-400';
  return 'text-emerald-400';
}

function formatEventLine(e: JobEvent): string {
  const ts = (() => {
    try {
      return new Date(e.createdAt).toISOString().split('T')[1].split('.')[0];
    } catch {
      return e.createdAt;
    }
  })();
  const meta = e.metadata && Object.keys(e.metadata).length > 0
    ? '\n' + JSON.stringify(e.metadata, null, 2)
    : '';
  return `${ts} [${e.level.toUpperCase()}] [${e.context}] ${e.message}${meta}`;
}

function EventLine({ event }: { event: JobEvent }) {
  const ts = (() => {
    try {
      return new Date(event.createdAt).toISOString().split('T')[1].split('.')[0];
    } catch {
      return event.createdAt;
    }
  })();
  return (
    <div className="group relative text-gray-300 leading-relaxed pr-10">
      <span className={levelColorClass(event.level)}>[{event.context}]</span>{' '}
      <span className="break-words">{event.message}</span>
      <span className="text-gray-500 ml-2">{ts}</span>
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <pre className="ml-4 mt-1 text-gray-400 text-xs overflow-x-auto">
          {JSON.stringify(event.metadata, null, 2)}
        </pre>
      )}
      <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <CopyButton text={formatEventLine(event)} label="event" iconOnly />
      </div>
    </div>
  );
}

// ===========================================================================
// Collapsible — a sub-section with title, count badge, chevron toggle
// ===========================================================================

interface CollapsibleProps {
  title: string;
  count?: number;
  defaultOpen: boolean;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}

function Collapsible({ title, count, defaultOpen, children, headerRight }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 min-h-[44px] py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide hover:text-gray-900 dark:hover:text-gray-100"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span>{title}</span>
          {typeof count === 'number' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 normal-case tracking-normal">
              {count}
            </span>
          )}
        </button>
        {open && headerRight}
      </div>
      {open && children}
    </div>
  );
}

// ===========================================================================
// LogDetailPanel
// ===========================================================================

interface LogDetailPanelProps {
  log: Log;
  /** Default-open state for the three sub-sections. Desktop: true; Mobile: false. */
  defaultOpen: boolean;
}

export function LogDetailPanel({ log, defaultOpen }: LogDetailPanelProps) {
  const [level, setLevel] = useState<Level>('all');

  const filteredEvents = useMemo(() => {
    if (level === 'all') return log.events;
    return log.events.filter((e) => e.level === level);
  }, [log.events, level]);

  const fullEventLog = useMemo(
    () => log.events.map(formatEventLine).join('\n'),
    [log.events]
  );

  const resultText = useMemo(
    () => (log.result ? JSON.stringify(log.result, null, 2) : ''),
    [log.result]
  );

  const hasResult = !!(log.result && Object.keys(log.result).length > 0);

  return (
    <div className="space-y-4">
      {log.bullJobId && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Bull Job ID:
          </span>
          <span className="text-xs text-gray-700 dark:text-gray-300 font-mono break-all">
            {log.bullJobId}
          </span>
          <CopyButton text={log.bullJobId} label="Bull Job ID" />
        </div>
      )}

      {log.events.length > 0 && (
        <Collapsible
          title="Event Log"
          count={log.events.length}
          defaultOpen={defaultOpen}
          headerRight={
            <div className="flex items-center gap-2">
              <LevelFilterPills value={level} onChange={setLevel} />
              <CopyButton text={fullEventLog} label="full event log" />
            </div>
          }
        >
          {filteredEvents.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">
              No events at level &quot;{level}&quot;.
            </div>
          ) : (
            <div className="space-y-px max-h-72 sm:max-h-96 overflow-y-auto bg-gray-950 dark:bg-black/60 rounded-xl p-3 font-mono text-xs">
              {filteredEvents.map((event) => (
                <EventLine key={event.id} event={event} />
              ))}
            </div>
          )}
        </Collapsible>
      )}

      {hasResult && (
        <Collapsible
          title="Job Result"
          defaultOpen={defaultOpen}
          headerRight={<CopyButton text={resultText} label="result" />}
        >
          <pre className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-900 dark:text-blue-300 font-mono overflow-x-auto max-h-48">
            {resultText}
          </pre>
        </Collapsible>
      )}

      {log.errorMessage && (
        <Collapsible
          title="Error"
          defaultOpen={defaultOpen}
          headerRight={<CopyButton text={log.errorMessage} label="error" />}
        >
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
            {log.errorMessage}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

// ===========================================================================
// LevelFilterPills — small group toggle
// ===========================================================================

function LevelFilterPills({
  value,
  onChange,
}: {
  value: Level;
  onChange: (next: Level) => void;
}) {
  const options: { key: Level; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'info', label: 'Info' },
    { key: 'warn', label: 'Warn' },
    { key: 'error', label: 'Error' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={`px-2 py-1 text-xs font-medium transition-colors ${
            value === opt.key
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
