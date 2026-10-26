/**
 * Component: Strict Torrent Probe Answers
 * Documentation: documentation/phase3/download-clients.md
 *
 * Reads a torrent client's lookup answer for the seeding cleanup's strict probe.
 * Returns the torrent, or null ONLY for a well-formed answer that lacks it.
 * Anything unclear (auth page, empty body, RPC error, wrong shape) throws, so the
 * cleanup writes nothing: an error must never count as "gone".
 */

function shape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return value === '' ? 'an empty body' : 'text';
  return typeof value;
}

const sameHash = (value: unknown, hash: string) =>
  typeof value === 'string' && value.toLowerCase() === hash.toLowerCase();

/** qBittorrent GET /torrents/info?hashes=: HTTP 200 and a JSON list (some compatible clients ignore the filter) */
export function qbittorrentProbeMatch(status: number, data: unknown, hash: string): Record<string, unknown> | null {
  if (status !== 200 || !Array.isArray(data)) {
    throw new Error(`qBittorrent answered the lookup of ${hash} with HTTP ${status} and ${shape(data)}, not a torrent list`);
  }
  const match = data.find((t) => t && typeof t === 'object' && sameHash((t as Record<string, unknown>).hash, hash));
  return (match as Record<string, unknown>) ?? null;
}

/** Transmission torrent-get: result 'success' and arguments.torrents a list */
export function transmissionProbeMatch(data: unknown, hash: string): Record<string, unknown> | null {
  const answer = data as { result?: unknown; arguments?: { torrents?: unknown } } | null;
  if (!answer || answer.result !== 'success' || !Array.isArray(answer.arguments?.torrents)) {
    const result = answer && typeof answer === 'object' ? String(answer.result) : shape(data);
    throw new Error(`Transmission answered the lookup of ${hash} with ${result}, not a torrent list`);
  }
  const match = (answer.arguments!.torrents as unknown[]).find(
    (t) => t && typeof t === 'object' && sameHash((t as Record<string, unknown>).hashString, hash)
  );
  return (match as Record<string, unknown>) ?? null;
}

/** Deluge core.get_torrent_status: no error and a plain object; {} = unknown id (core.create_torrent_status) */
export function delugeProbeStatus(data: unknown, hash: string): Record<string, unknown> | null {
  const answer = data as { result?: unknown; error?: { message?: string } | null } | null;
  const result = answer?.result;
  if (!answer || answer.error != null || !result || typeof result !== 'object' || Array.isArray(result)) {
    const why = answer?.error ? `error "${answer.error.message ?? 'unknown'}"` : shape(result);
    throw new Error(`Deluge answered the lookup of ${hash} with ${why}, not a torrent status`);
  }
  return Object.keys(result).length > 0 ? (result as Record<string, unknown>) : null;
}
