/**
 * Component: Bulk Action Bar Tests
 * Documentation: documentation/admin-features/bulk-request-actions.md
 */

// @vitest-environment jsdom

import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkItemOutcome, BulkRow } from '@/app/admin/components/bulk-actions';

const mutateMock = vi.hoisted(() => vi.fn(async () => undefined));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('swr', () => ({ mutate: mutateMock }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toastMock }));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: vi.fn() }));

import { BulkActionBar } from '@/app/admin/components/BulkActionBar';
import { useRequestSelection } from '@/app/admin/components/useRequestSelection';
import { useBulkRun, type RunItem } from '@/app/admin/components/useBulkRun';

const ROWS: BulkRow[] = [
  { requestId: 'wait-1', title: 'Made Up Wait 1', status: 'awaiting_approval' },
  { requestId: 'wait-2', title: 'Made Up Wait 2', status: 'awaiting_approval' },
  { requestId: 'dl-1', title: 'Made Up Downloading', status: 'downloading' },
  { requestId: 'fail-1', title: 'Made Up Failed', status: 'failed' },
  { requestId: 'lib-1', title: 'Made Up Delivered', status: 'available', inLibrary: true },
  { requestId: 'lib-2', title: 'Made Up Shared Row', status: 'cancelled', inLibrary: true },
];

function Harness({ rows = ROWS, initial, runItem }: { rows?: BulkRow[]; initial: string[]; runItem: RunItem }) {
  const selection = useRequestSelection('/api/admin/requests?page=1');
  const run = useBulkRun(runItem);
  const { setPage } = selection;
  useEffect(() => {
    if (initial.length) setPage(initial, true);
  }, [initial, setPage]);
  return (
    <>
      <span data-testid="selected">{[...selection.ids].sort().join(',')}</span>
      <BulkActionBar rows={rows} selection={selection} run={run} listKey="/api/admin/requests?page=1" />
    </>
  );
}

const ALL = ROWS.map((r) => r.requestId);
const bar = () => screen.getByRole('region', { name: 'Bulk actions' });

describe('BulkActionBar', () => {
  beforeEach(() => {
    mutateMock.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
  });

  it('is hidden while nothing is selected', () => {
    render(<Harness initial={[]} runItem={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('a mixed selection: each button shows the count it applies to', () => {
    render(<Harness initial={ALL} runItem={vi.fn()} />);
    const region = within(bar());
    expect(region.getByText('6 selected')).toBeTruthy();
    for (const label of ['Approve 2', 'Deny 2', 'Cancel 3', 'Delete 4']) {
      expect((region.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('a button is disabled at 0', () => {
    render(<Harness initial={['lib-1', 'lib-2']} runItem={vi.fn()} />);
    const region = within(bar());
    expect((region.getByRole('button', { name: 'Delete 0' }) as HTMLButtonElement).disabled).toBe(true);
    expect((region.getByRole('button', { name: 'Approve 0' }) as HTMLButtonElement).disabled).toBe(true);
    expect((region.getByRole('button', { name: 'Cancel 0' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('delete: the confirm counts, the run sends only eligible requests in order, the result reports skipped and failed', async () => {
    const outcomes: Record<string, BulkItemOutcome> = {
      'wait-1': { result: 'done' },
      'wait-2': { result: 'failed', reason: 'the server answered 500' },
      'dl-1': { result: 'done' },
      'fail-1': { result: 'skipped', reason: 'no longer exists' },
    };
    const runItem = vi.fn<RunItem>(async (_a, id) => outcomes[id]);
    render(<Harness initial={ALL} runItem={runItem} />);

    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete 4' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete 4 requests?')).toBeTruthy();
    expect(within(dialog).getByText('2 selected are books in your library or being imported and are left as they are.')).toBeTruthy();
    expect(within(dialog).getByText(/watched author/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 4 requests' }));
    expect(screen.queryByRole('dialog')).toBeNull(); // closes on confirm; progress shows in the bar

    await waitFor(() => expect(within(bar()).getByText(/^Deleted 2 requests\./)).toBeTruthy());
    expect(runItem.mock.calls.map(([action, id]) => `${action}:${id}`)).toEqual(['delete:wait-1', 'delete:wait-2', 'delete:dl-1', 'delete:fail-1']);
    expect(within(bar()).getByText(
      'Deleted 2 requests. 3 skipped (2 in your library or being imported, 1 no longer exists). 1 failed.'
    )).toBeTruthy();
    // The selection keeps what was not done
    expect(screen.getByTestId('selected').textContent).toBe('fail-1,lib-1,lib-2,wait-2');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests?page=1');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/metrics');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests/pending-approval');
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    // Focus moves to the result line (the run's buttons were disabled)
    expect(document.activeElement?.textContent).toMatch(/^Deleted 2 requests\./);
  });

  it('approve: the confirm says it starts the searches; deny and cancel confirm their counts', () => {
    render(<Harness initial={ALL} runItem={vi.fn()} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Approve 2' }));
    expect(within(screen.getByRole('dialog')).getByText(/starts searching for each one now/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel 3' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Cancel 3 requests?')).toBeTruthy();
    expect(dialog.getByText('2 waiting for approval are withdrawn; the user can request them again later.')).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Keep requests' })).toBeTruthy();
  });

  it('shows progress with Stop, which takes effect after the current request', async () => {
    let release!: (o: BulkItemOutcome) => void;
    const runItem = vi.fn<RunItem>(() => new Promise((resolve) => { release = resolve; }));
    render(<Harness initial={['wait-1', 'wait-2', 'dl-1']} runItem={runItem} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel 3' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel 3 requests' }));
    await waitFor(() => expect(within(bar()).getByText('Cancelling 0 of 3...')).toBeTruthy());
    expect(within(bar()).queryByRole('button', { name: /^Delete/ })).toBeNull();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Stop' }));
    expect(within(bar()).getByText('Stopping after this request...')).toBeTruthy();
    await act(async () => release({ result: 'done', download: 'removed' }));
    await waitFor(() => expect(within(bar()).getByText(/^Stopped after 1 of 3\. Cancelled 1 request\./)).toBeTruthy());
    expect(runItem).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selected').textContent).toBe('dl-1,wait-2');
  });

  it('a run that did everything leaves the result shown, with Dismiss', async () => {
    const runItem = vi.fn<RunItem>(async () => ({ result: 'done' }));
    render(<Harness initial={['fail-1']} runItem={runItem} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete 1 request' }));
    await waitFor(() => expect(within(bar()).getByText('Deleted 1 request.')).toBeTruthy());
    fireEvent.click(within(bar()).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });
});
