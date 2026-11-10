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

const LIST = '/api/admin/requests?page=1';

function Harness({ rows = ROWS, initial, runItem, listKey = LIST }: { rows?: BulkRow[]; initial: string[]; runItem: RunItem; listKey?: string }) {
  const selection = useRequestSelection(listKey);
  const run = useBulkRun(runItem);
  const { setPage } = selection;
  useEffect(() => {
    if (initial.length) setPage(initial, true);
  }, [initial, setPage]);
  return (
    <>
      <span data-testid="selected">{[...selection.ids].sort().join(',')}</span>
      <button type="button" data-testid="untick-fail-1" onClick={() => selection.toggle('fail-1')} />
      <BulkActionBar rows={rows} selection={selection} run={run} listKey={listKey} />
    </>
  );
}

const ALL = ROWS.map((r) => r.requestId);
const bar = () => screen.getByRole('region', { name: 'Bulk actions' });
/** The visible status line (the screen reader line repeats a result) */
const statusLine = (text: string) => within(bar()).getByText(text, { selector: '[tabindex="-1"]' });
const live = () => document.querySelector('[aria-live]') as HTMLElement;

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

  it('delete: the confirm counts, the run sends only eligible requests in order, the bar alone reports the result', async () => {
    const outcomes: Record<string, BulkItemOutcome> = {
      'wait-1': { result: 'done' },
      'wait-2': { result: 'failed', reason: 'the server answered 500' },
      'dl-1': { result: 'done' },
      'fail-1': { result: 'skipped', reason: 'in your library or being imported' },
    };
    const runItem = vi.fn<RunItem>(async (_a, id) => outcomes[id]);
    render(<Harness initial={ALL} runItem={runItem} />);

    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete 4' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete 4 requests?')).toBeTruthy();
    expect(within(dialog).getByText('Their downloads go too, unless still seeding or shared. Nothing in your library is touched: 2 books already in it are skipped.')).toBeTruthy();
    expect(within(dialog).getByText(/remove it first or cancel instead/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 4' }));
    expect(screen.queryByRole('dialog')).toBeNull(); // closes on confirm; progress shows in the bar

    await waitFor(() => expect(statusLine('Deleted 2. 3 in your library skipped. 1 failed.')).toBeTruthy());
    expect(runItem.mock.calls.map(([action, id]) => `${action}:${id}`)).toEqual(['delete:wait-1', 'delete:wait-2', 'delete:dl-1', 'delete:fail-1']);
    // The selection keeps what was not done
    expect(screen.getByTestId('selected').textContent).toBe('fail-1,lib-1,lib-2,wait-2');
    expect(mutateMock).toHaveBeenCalledWith(LIST);
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/metrics');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests/pending-approval');
    // No toast repeats the bar's line
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe('Deleted 2. 3 in your library skipped. 1 failed.');
  });

  it('approve and cancel confirm with their own words and buttons', () => {
    render(<Harness initial={ALL} runItem={vi.fn()} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Approve 2' }));
    const approve = within(screen.getByRole('dialog'));
    expect(approve.getByText(/^RMAB starts on each one now/)).toBeTruthy();
    expect(approve.getByRole('button', { name: 'Approve 2' })).toBeTruthy();
    fireEvent.click(approve.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel 3' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Cancel 3 requests?')).toBeTruthy();
    expect(dialog.getByText('2 waiting for approval are withdrawn.')).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Cancel 3' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Keep them' })).toBeTruthy();
  });

  it('shows progress with Stop, which takes effect after the current request', async () => {
    let release!: (o: BulkItemOutcome) => void;
    const runItem = vi.fn<RunItem>(() => new Promise((resolve) => { release = resolve; }));
    render(<Harness initial={['wait-1', 'wait-2', 'dl-1']} runItem={runItem} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel 3' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel 3' }));
    await waitFor(() => expect(within(bar()).getByText('Cancelling 0 of 3...')).toBeTruthy());
    expect(within(bar()).queryByRole('button', { name: /^Delete/ })).toBeNull();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Stop' }));
    expect(within(bar()).getByText('Stopping after this request...')).toBeTruthy();
    await act(async () => release({ result: 'done', download: 'removed' }));
    await waitFor(() => expect(statusLine('Stopped: cancelled 1, 2 not started (still selected).')).toBeTruthy());
    expect(runItem).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selected').textContent).toBe('dl-1,wait-2');
  });

  it('screen readers hear the start and the end of a run, not each request; focus goes to the status line', async () => {
    const releases: ((o: BulkItemOutcome) => void)[] = [];
    const runItem = vi.fn<RunItem>(() => new Promise((resolve) => { releases.push(resolve); }));
    render(<Harness initial={['wait-1', 'wait-2']} runItem={runItem} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Deny 2' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deny 2' }));
    await waitFor(() => expect(within(bar()).getByText('Denying 0 of 2...')).toBeTruthy());
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(live().textContent).toBe('Denying 2 requests.');
    expect(document.activeElement?.textContent).toBe('Denying 0 of 2...');
    await act(async () => releases[0]({ result: 'done' }));
    await waitFor(() => expect(within(bar()).getByText('Denying 1 of 2...')).toBeTruthy());
    expect(live().textContent).toBe('Denying 2 requests.');
    expect(live().contains(screen.getByText('Denying 1 of 2...'))).toBe(false);
    await act(async () => releases[1]({ result: 'done' }));
    await waitFor(() => expect(live().textContent).toBe('Denied 2.'));
    expect(document.activeElement?.textContent).toBe('Denied 2.');
  });

  it('a confirm left open closes when the selection it was built from changes, and does not come back', () => {
    render(<Harness initial={ALL} runItem={vi.fn()} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete 4' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('untick-fail-1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('untick-fail-1')); // the same selection again
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a list change during a run keeps the result and never calls an empty selection "still selected"', async () => {
    let release!: (o: BulkItemOutcome) => void;
    const runItem = vi.fn<RunItem>(() => new Promise((resolve) => { release = resolve; }));
    const initial = ['wait-1', 'wait-2'];
    const { rerender } = render(<Harness initial={initial} runItem={runItem} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Approve 2' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 2' }));
    await waitFor(() => expect(within(bar()).getByText('Approving 0 of 2...')).toBeTruthy());
    fireEvent.click(within(bar()).getByRole('button', { name: 'Stop' }));
    rerender(<Harness initial={initial} runItem={runItem} listKey="/api/admin/requests?page=2" />);
    expect(within(bar()).getByRole('button', { name: 'Stop' })).toBeTruthy(); // the run is still shown
    await act(async () => release({ result: 'done' }));
    await waitFor(() => expect(statusLine('Stopped: approved 1, 1 not started.')).toBeTruthy());
    expect(screen.getByTestId('selected').textContent).toBe('');
  });

  it('a run that did everything leaves the result shown, with Dismiss', async () => {
    const runItem = vi.fn<RunItem>(async () => ({ result: 'done' }));
    render(<Harness initial={['fail-1']} runItem={runItem} />);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete 1' }));
    await waitFor(() => expect(statusLine('Deleted 1.')).toBeTruthy());
    fireEvent.click(within(bar()).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });
});
