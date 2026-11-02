/**
 * Component: Cancel Deadline
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * The cancel answers within a few seconds. Its download step checks the deadline right before
 * every client delete and every row write: once it has passed, nothing more is changed and the
 * cancelled-download pass of the seeding cleanup takes over.
 */

/** Budget for a cancel's download step (client lookups have no abort signal) */
export const CANCEL_STEP_BUDGET_MS = 10_000;

export class CancelDeadline {
  private constructor(private readonly at: number | null) {}

  /** A deadline `ms` from now */
  static in(ms: number): CancelDeadline {
    return new CancelDeadline(Date.now() + ms);
  }

  /** No deadline (the scheduled pass) */
  static none(): CancelDeadline {
    return new CancelDeadline(null);
  }

  passed(): boolean {
    return this.at !== null && Date.now() >= this.at;
  }

  /** Milliseconds left; Infinity without a deadline */
  remaining(): number {
    return this.at === null ? Infinity : Math.max(0, this.at - Date.now());
  }
}

export class CancelDeadlineError extends Error {
  readonly name = 'CancelDeadlineError';
}

/**
 * The work's answer, or a CancelDeadlineError once the deadline passes first. The work itself
 * cannot be aborted: a late answer is ignored (its error swallowed).
 */
export function withinDeadline<T>(work: Promise<T>, deadline: CancelDeadline): Promise<T> {
  const remaining = deadline.remaining();
  if (remaining === Infinity) return work;
  work.catch(() => undefined);
  if (remaining <= 0) return Promise.reject(new CancelDeadlineError('cancel deadline passed'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CancelDeadlineError('the download client did not answer in time')), remaining);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
