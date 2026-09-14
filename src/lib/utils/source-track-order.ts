/**
 * Component: Source Folder Track Ordering
 * Documentation: documentation/features/source-track-order.md
 */
import path from 'path';

export interface SourceTrack {
  path: string;
  trackNumber?: number;
  discNumber?: number;
}

export interface SourcePosition {
  disc: number;
  track: number;
}

function needsReview(reason: string): never {
  throw new Error(`Audio ordering needs review: ${reason}. Preserve or correct disc/track numbers before retrying import.`);
}

function positive(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! > 0;
}

function uniqueSequence(values: (number | undefined)[]): values is number[] {
  if (!values.every(positive)) return false;
  const sorted = [...values].sort((a, b) => a! - b!);
  return sorted.every((n, i) => i === 0 || n! === sorted[i - 1]! + 1);
}

// Only an explicit leading number is evidence; numbers elsewhere may be book titles.
function trackFromName(filename: string): number | undefined {
  const stem = path.basename(filename, path.extname(filename));
  const match = stem.match(/^(?:(?:track|chapter|ch)\s*)?(\d+)(?=$|[\s._-])/i);
  return match && Number(match[1]) > 0 ? Number(match[1]) : undefined;
}

function folderRange(folder: string): [number, number] | undefined {
  const match = path.basename(folder).match(/^(?:(?:cd|dis[ck]|part)\s*)?(\d+)(?:\s*-\s*(\d+))?(?=$|[\s._-])/i);
  if (!match) return undefined;
  const first = Number(match[1]);
  const last = match[2] ? Number(match[2]) : first;
  return Number.isSafeInteger(first) && Number.isSafeInteger(last) && first > 0 && last >= first ? [first, last] : undefined;
}

export function hasMultipleSourceFolders(files: string[]): boolean {
  return new Set(files.map(file => path.dirname(file))).size > 1;
}

/** Resolve sibling source sections before flattening; never infer named introductions/extras. */
export function resolveSourceTrackOrder<T extends SourceTrack>(files: T[]): Array<T & { sourcePosition: SourcePosition }> | null {
  if (!hasMultipleSourceFolders(files.map(file => file.path))) return null;
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const folder = path.dirname(file.path);
    groups.set(folder, [...(groups.get(folder) || []), file]);
  }
  if (groups.size > 99) needsReview('more than 99 source sections');
  if (new Set([...groups.keys()].map(folder => path.dirname(folder))).size !== 1) {
    needsReview('audio is mixed between root and nested folders');
  }

  // Release folders may end in a section label after a shared book title.
  // Require the same prefix in every sibling; never extract arbitrary title numbers.
  const suffixes = [...groups.keys()].map(folder => path.basename(folder)
    .match(/^(.*\S)[\s._-]+((?:cd|dis[ck]|part)\s*\d+(?:\s*-\s*\d+)?)\s*$/i));
  const sharedTitle = suffixes.every(Boolean) && new Set(suffixes.map(match => match?.[1])).size === 1;
  const sections = [...groups].map(([folder, tracks], index) => {
    const discs = tracks.map(track => track.discNumber).filter(positive);
    if (new Set(discs).size > 1) needsReview('one source folder contains conflicting disc tags');
    return { tracks, range: folderRange(sharedTitle ? suffixes[index]![2] : folder), disc: discs[0] };
  });
  const numberedFolders = sections.every(section => section.range);
  const taggedDiscs = sections.every(section => positive(section.disc));
  if (!numberedFolders && !taggedDiscs) needsReview('source sections have no complete numeric order');
  sections.sort((a, b) => numberedFolders ? a.range![0] - b.range![0] : a.disc! - b.disc!);
  if (numberedFolders && sections.some((s, i) => i > 0 && s.range![0] <= sections[i - 1].range![1])) {
    needsReview('source section numbers overlap');
  }
  if (numberedFolders && sections.some((s, i) => s.range![0] !== (i === 0 ? 1 : sections[i - 1].range![1] + 1))) {
    needsReview('source section numbers contain gaps or do not start at one');
  }
  // Canonical disc numbers must agree with any existing tags. Do not rewrite contradictions.
  if (sections.some((s, i) => s.disc !== undefined && s.disc !== i + 1)) {
    needsReview('disc tags conflict with source section order or contain gaps');
  }

  return sections.flatMap((section, discIndex) => {
    const metadata = section.tracks.map(track => track.trackNumber);
    const filenames = section.tracks.map(track => trackFromName(track.path));
    let numbers: number[];
    if (uniqueSequence(metadata)) {
      numbers = metadata;
      if (uniqueSequence(filenames)) {
        const byTags = section.tracks.map((_, i) => i).sort((a, b) => metadata[a] - metadata[b]);
        const byNames = section.tracks.map((_, i) => i).sort((a, b) => filenames[a] - filenames[b]);
        if (byTags.some((value, i) => value !== byNames[i])) needsReview('track tags and filenames disagree');
      }
    } else if (uniqueSequence(filenames)) {
      if (metadata.some((value, i) => value !== undefined && value !== filenames[i])) {
        needsReview('repeated or incomplete track tags conflict with filenames');
      }
      numbers = filenames;
    } else if (section.tracks.length === 1 && metadata[0] === undefined && filenames[0] === undefined) {
      numbers = [1];
    } else {
      needsReview('tracks within a source section have duplicate, missing or non-sequential numbers');
    }
    if (numbers.some(number => number > 9999)) needsReview('track numbers exceed 9999');
    return section.tracks.map((file, i) => ({ ...file, sourcePosition: { disc: discIndex + 1, track: numbers[i] } }))
      .sort((a, b) => a.sourcePosition.track - b.sourcePosition.track);
  });
}

export function sourceOrderedFilename(filename: string, position: SourcePosition): string {
  return `Disc ${String(position.disc).padStart(2, '0')} - ${String(position.track).padStart(4, '0')} - ${filename}`;
}
