/**
 * Component: Bulk Import Disc Folder Fold
 * Documentation: documentation/features/multi-disc-folders.md
 *
 * After the Bulk Import walk, folds the disc folders of one book folder
 * (`Book/CD1`, `Book/CD2`, each its own discovery) into a single discovery at
 * the book folder, so the book imports once with every file.
 */

import * as path from 'path';
import type { AudioFileMetadata, DiscoveredAudiobook } from './bulk-import-scanner';
import { isConfiguredRoot } from './disc-layout-fs';
import { naturalCompare, parseDiscFolderName, stripDiscSuffix, type DiscFolderName } from './disc-layout';

export interface DiscFoldContext {
  /** The folder the scan started at ('/' separators, as discoveries carry them). */
  rootPath: string;
  /** Configured roots (download_dir, media_dir, /bookdrop): never folded into. */
  protectedRoots: readonly string[];
  buildSearchTerm: (
    metadata: AudioFileMetadata,
    firstFileName: string,
    folderName?: string
  ) => { searchTerm: string; source: DiscoveredAudiobook['metadataSource'] };
  extractAsin: (name: string) => string | null;
}

const UNGROUPED_PREFIX = '__ungrouped_';

const isTagged = (d: DiscoveredAudiobook) => !d.groupingKey.startsWith(UNGROUPED_PREFIX);

/** The grouping key (title|author|narrator) with a disc suffix stripped from the album title. */
function foldKey(metadata: AudioFileMetadata): string {
  const normalize = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [normalize(stripDiscSuffix(metadata.title || '')), normalize(metadata.author), normalize(metadata.narrator)].join('|');
}

function parentOf(folderPath: string): string {
  const cut = folderPath.lastIndexOf('/');
  return cut <= 0 ? '/' : folderPath.slice(0, cut);
}

function isAtOrBelow(dir: string, root: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`;
  return dir === root || dir.startsWith(base);
}

interface DiscEntry {
  discovery: DiscoveredAudiobook;
  disc: DiscFolderName;
}

/**
 * Whether the disc folders under one book folder fold, and the shared key:
 * - one discovery per disc folder (a folder holding two books never folds);
 * - all untagged: only cd/disc/disk folders fold (untagged `Part N` stay separate);
 * - all tagged: their keys agree once a disc suffix is stripped from the album;
 * - a mix of tagged and untagged never folds.
 */
function foldDecision(discs: DiscEntry[], perFolder: Map<string, number>): { fold: boolean; key?: string } {
  if (discs.some((d) => perFolder.get(d.discovery.folderPath) !== 1)) return { fold: false };
  const tagged = discs.filter((d) => isTagged(d.discovery));
  if (tagged.length === 0) return { fold: discs.every((d) => d.disc.kind === 'disc') };
  if (tagged.length !== discs.length) return { fold: false };
  const keys = new Set(discs.map((d) => foldKey(d.discovery.metadata)));
  return keys.size === 1 ? { fold: true, key: [...keys][0] } : { fold: false };
}

function buildFolded(
  bookFolder: string,
  discs: DiscEntry[],
  own: DiscoveredAudiobook[],
  key: string | undefined,
  ctx: DiscFoldContext,
  root: string
): DiscoveredAudiobook {
  const ordered = [...discs].sort(
    (a, b) => a.disc.number - b.disc.number || naturalCompare(a.discovery.folderName, b.discovery.folderName)
  );
  const audioFiles = [
    ...own.flatMap((d) => d.audioFiles).sort(naturalCompare),
    ...ordered.flatMap((d) => [...d.discovery.audioFiles].sort(naturalCompare).map((f) => `${d.discovery.folderName}/${f}`)),
  ];
  const first = ordered[0].discovery;
  const metadata: AudioFileMetadata = key
    ? { ...first.metadata, title: stripDiscSuffix(first.metadata.title || '') }
    : { ...first.metadata };
  const folderName = path.posix.basename(bookFolder);
  const { searchTerm, source } = ctx.buildSearchTerm(metadata, path.posix.basename(audioFiles[0]), folderName);
  const members = [...own, ...ordered.map((d) => d.discovery)];
  return {
    folderPath: bookFolder,
    folderName,
    relativePath: bookFolder === root ? folderName : bookFolder.slice(root.replace(/\/$/, '').length + 1),
    audioFileCount: members.reduce((n, d) => n + d.audioFileCount, 0),
    totalSizeBytes: members.reduce((n, d) => n + d.totalSizeBytes, 0),
    metadata,
    searchTerm,
    metadataSource: source,
    extractedAsin: ctx.extractAsin(folderName) ?? ordered.find((d) => d.discovery.extractedAsin)?.discovery.extractedAsin,
    audioFiles,
    groupingKey: key ?? `${UNGROUPED_PREFIX}folder`,
  };
}

/**
 * Fold disc folders into their book folder. A book folder qualifies when two
 * or more of its direct children are disc folders with audio of their own, it
 * is at or below the scan root, and it is not a configured root. Its own audio
 * joins when untagged or when its key agrees with the discs'. Anything that
 * does not qualify is returned unchanged.
 */
export async function foldDiscFolders(
  discoveries: DiscoveredAudiobook[],
  ctx: DiscFoldContext
): Promise<DiscoveredAudiobook[]> {
  const root = ctx.rootPath;
  const perFolder = new Map<string, number>();
  for (const d of discoveries) perFolder.set(d.folderPath, (perFolder.get(d.folderPath) ?? 0) + 1);

  const byBook = new Map<string, DiscEntry[]>();
  for (const discovery of discoveries) {
    const disc = parseDiscFolderName(discovery.folderName);
    if (!disc || discovery.folderPath === root) continue;
    const book = parentOf(discovery.folderPath);
    byBook.set(book, [...(byBook.get(book) ?? []), { discovery, disc }]);
  }

  // Each folded member maps to its book's single folded discovery
  const foldedBy = new Map<DiscoveredAudiobook, DiscoveredAudiobook>();
  for (const [book, discs] of byBook) {
    if (new Set(discs.map((d) => d.discovery.folderPath)).size < 2 || !isAtOrBelow(book, root)) continue;
    const decision = foldDecision(discs, perFolder);
    if (!decision.fold) continue;
    if (await isConfiguredRoot(book, ctx.protectedRoots)) continue;
    const own = discoveries.filter(
      (d) => d.folderPath === book && (!isTagged(d) || (decision.key !== undefined && foldKey(d.metadata) === decision.key))
    );
    const folded = buildFolded(book, discs, own, decision.key, ctx, root);
    for (const member of [...own, ...discs.map((d) => d.discovery)]) foldedBy.set(member, folded);
  }

  if (foldedBy.size === 0) return discoveries;
  // The folded discovery takes the place of its first member; the other members drop out
  const placed = new Set<DiscoveredAudiobook>();
  const out: DiscoveredAudiobook[] = [];
  for (const d of discoveries) {
    const folded = foldedBy.get(d);
    if (!folded) out.push(d);
    else if (!placed.has(folded)) {
      placed.add(folded);
      out.push(folded);
    }
  }
  return out;
}
