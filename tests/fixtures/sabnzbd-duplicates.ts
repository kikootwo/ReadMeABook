/**
 * Component: SABnzbd duplicate-detection response fixtures
 * Documentation: documentation/phase3/sabnzbd.md
 *
 * What SABnzbd answers to `mode=addfile` for each "Detect duplicate downloads" mode
 * (Config > Switches, `misc.no_dupes`), read from SABnzbd 4.0 to 5.x source:
 * `api._api_addfile` reports `{ status: result is OK, nzo_ids }` with no `error` key;
 * `nzbparser.process_single_nzb` maps the outcome; `NzbObject.duplicate_check` /
 * `handle_duplicate_action` decide it. A job is a duplicate when a non-failed history
 * row (archived rows included) or a queued job has the same name (case-insensitive)
 * or the same NZB md5. The nzo_ids SABnzbd returns always name the new job, never the
 * existing one.
 */

/** The job name SABnzbd gives `My.Audiobook.Release.nzb` (the upload name without `.nzb`). */
export const JOB_NAME = 'My.Audiobook.Release';
export const NZB_URL = `https://indexer.example/get/${JOB_NAME}.nzb`;
export const CATEGORY = 'readmeabook';
export const NEW_ID = 'SABnzbd_nzo_new';
export const EXISTING_ID = 'SABnzbd_nzo_existing';

/** addfile answers, by mode, when the release is already in SABnzbd's history. */
export const ADDFILE_RESPONSES = {
  /** 0 Off: no check; a normal add of a second copy. */
  off: { status: true, nzo_ids: [NEW_ID] },
  /** 1 Discard: NzbRejected, nothing added, no history row. */
  discard: { status: false, nzo_ids: [] as string[] },
  /** 2 Pause: added to the queue Paused (label "DUPLICATE"). */
  pause: { status: true, nzo_ids: [NEW_ID] },
  /** 3 Fail: NzbRejectToHistory, a history row Failed with fail_message "Duplicate NZB". */
  fail: { status: true, nzo_ids: [NEW_ID] },
  /** 4 Tag: added and downloading normally (label "DUPLICATE"). */
  tag: { status: true, nzo_ids: [NEW_ID] },
} as const;

export interface RawQueueSlot {
  nzo_id: string;
  filename: string;
  cat: string;
  status: string;
  mb: string;
  mbleft: string;
  percentage: string;
  timeleft: string;
  priority: string;
  labels: string[];
}

export interface RawHistorySlot {
  nzo_id: string;
  name: string;
  category: string;
  status: string;
  bytes: string;
  fail_message: string;
  storage: string;
  completed: string;
  download_time: string;
}

export function queueSlot(overrides: Partial<RawQueueSlot> = {}): RawQueueSlot {
  return {
    nzo_id: EXISTING_ID,
    filename: JOB_NAME,
    cat: CATEGORY,
    status: 'Downloading',
    mb: '500',
    mbleft: '250',
    percentage: '50',
    timeleft: '0:05:00',
    priority: 'Normal',
    labels: [],
    ...overrides,
  };
}

export function historySlot(overrides: Partial<RawHistorySlot> = {}): RawHistorySlot {
  return {
    nzo_id: EXISTING_ID,
    name: JOB_NAME,
    category: CATEGORY,
    status: 'Completed',
    bytes: '524288000',
    fail_message: '',
    storage: `/sab/complete/${JOB_NAME}`,
    completed: '1700000000',
    download_time: '120',
    ...overrides,
  };
}

/** The new job each mode leaves behind (besides the existing one). */
export const NEW_JOB_BY_MODE = {
  off: { queue: queueSlot({ nzo_id: NEW_ID, status: 'Queued', percentage: '0', mbleft: '500' }) },
  pause: { queue: queueSlot({ nzo_id: NEW_ID, status: 'Paused', percentage: '0', mbleft: '500', labels: ['DUPLICATE'] }) },
  fail: { history: historySlot({ nzo_id: NEW_ID, status: 'Failed', fail_message: 'Duplicate NZB', storage: '', bytes: '0' }) },
  tag: { queue: queueSlot({ nzo_id: NEW_ID, status: 'Queued', percentage: '0', mbleft: '500', labels: ['DUPLICATE'] }) },
} as const;
