/**
 * Component: Intelligent Ranking Algorithm
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { compareTwoStrings } from 'string-similarity';
import { matchesByInitials } from './author-initials';
import {
  apostropheEndingWords, foldForMatching, FULLWIDTH_RE, fromFullwidth, hasNonLatinLetter, hasUnspacedScript, isWordInTitle,
  keepUnrequestedApostrophes, normalizeForMatching,
} from './match-normalize';
import {
  authorAppears, colonSubtitleAgrees, foldNumberWord, foldReleaseWords, isAuthorPresent, missingRequiredNumber,
  shortTitleStandsAlone, shortTitleWord, splitPositionNumbers, volumeConflict,
} from './match-gates';

export interface TorrentResult {
  indexer: string;
  indexerId?: number;
  title: string;
  size: number;
  seeders?: number;     // Optional for NZB/Usenet results (no seeders concept)
  leechers?: number;    // Optional for NZB/Usenet results (no leechers concept)
  publishDate: Date;
  downloadUrl: string;
  infoUrl?: string;     // Link to indexer's info page (for user reference)
  infoHash?: string;
  guid: string;
  format?: 'M4B' | 'M4A' | 'MP3' | 'FLAC' | 'OTHER';
  bitrate?: string;
  hasChapters?: boolean;
  flags?: string[];     // Indexer flags like "Freeleech", "Internal", etc.
  protocol?: string;    // 'torrent' or 'usenet' - from Prowlarr API
}

export interface AudiobookRequest {
  title: string;
  author: string;
  narrator?: string;
  durationMinutes?: number;
  series?: string | null;      // Catalog series name; automatic search only (G4c, #330)
  seriesPart?: string | null;  // Catalog series position ("3", "2.5"); automatic search only (G4c, #330)
}

export interface IndexerFlagConfig {
  name: string;         // Flag name (e.g., "Freeleech")
  modifier: number;     // -100 to 100 (percentage)
}

export interface RankTorrentsOptions {
  indexerPriorities?: Map<number, number>;  // indexerId -> priority (1-25)
  flagConfigs?: IndexerFlagConfig[];         // Flag bonus configurations
  requireAuthor?: boolean;                   // Enforce author presence check (default: true)
  stopWords?: string[];                      // Language-specific stop words for matching
  characterReplacements?: Record<string, string>;  // Language-specific char replacements (e.g. ß→ss)
  minMBPerMinute?: number;                   // Size floor when runtime is known (opt-in; automatic search only)
}

/** Size floor for automatic search, about 21 kbps: drops a single file of a multi-file post (#311) */
export const AUTO_SEARCH_MIN_MB_PER_MINUTE = 0.15;

export interface EbookTorrentRequest {
  title: string;
  author: string;
  preferredFormat: string;  // User's preferred format (epub, pdf, etc.)
}

export interface RankEbookTorrentsOptions {
  indexerPriorities?: Map<number, number>;  // indexerId -> priority (1-25)
  flagConfigs?: IndexerFlagConfig[];         // Flag bonus configurations
  requireAuthor?: boolean;                   // Enforce author presence check (default: true)
  stopWords?: string[];                      // Language-specific stop words for matching
  characterReplacements?: Record<string, string>;  // Language-specific char replacements (e.g. ß→ss)
}

export interface BonusModifier {
  type: 'indexer_priority' | 'indexer_flag' | 'custom';
  value: number;        // Multiplier (e.g., 0.4 for 40%)
  points: number;       // Calculated bonus points from this modifier
  reason: string;       // Human-readable explanation
}

export interface ScoreBreakdown {
  formatScore: number;
  sizeScore: number;
  seederScore: number;
  matchScore: number;
  totalScore: number;
  notes: string[];
}

export interface RankedTorrent extends TorrentResult {
  score: number;              // Base score (0-100)
  bonusModifiers: BonusModifier[];
  bonusPoints: number;        // Sum of all bonus points
  finalScore: number;         // score + bonusPoints
  rank: number;
  breakdown: ScoreBreakdown;
}

export interface EbookScoreBreakdown {
  formatScore: number;        // 0-10 points (match preferred = 10, else 0)
  sizeScore: number;          // 0-15 points (inverted - smaller is better)
  seederScore: number;        // 0-15 points (same as audiobooks)
  matchScore: number;         // 0-60 points (same as audiobooks)
  totalScore: number;
  notes: string[];
}

export interface RankedEbookTorrent extends TorrentResult {
  score: number;              // Base score (0-100)
  bonusModifiers: BonusModifier[];
  bonusPoints: number;        // Sum of all bonus points
  finalScore: number;         // score + bonusPoints
  rank: number;
  breakdown: EbookScoreBreakdown;
  ebookFormat?: string;       // Detected ebook format (epub, pdf, mobi, etc.)
}

export class RankingAlgorithm {
  /**
   * Rank all torrents and return sorted by finalScore (best first)
   * @param torrents - Array of torrent results to rank
   * @param audiobook - Audiobook request details for matching (includes durationMinutes for size scoring)
   * @param options - Optional configuration for ranking behavior
   */
  rankTorrents(
    torrents: TorrentResult[],
    audiobook: AudiobookRequest,
    options: RankTorrentsOptions = {}
  ): RankedTorrent[] {
    const {
      indexerPriorities,
      flagConfigs,
      requireAuthor = true,  // Safe default: require author in automatic mode
      stopWords,
      characterReplacements,
      minMBPerMinute,
    } = options;
    // Filter out files < 20 MB (likely ebooks/samples), and, when a floor is set and the
    // runtime is known, results too small for the runtime (one file of a multi-file post)
    const runtime = audiobook.durationMinutes;
    const floorMB = minMBPerMinute !== undefined && runtime !== undefined && runtime > 0
      ? minMBPerMinute * runtime
      : 0;
    const filteredTorrents = torrents.filter((torrent) => {
      const sizeMB = torrent.size / (1024 * 1024);
      return sizeMB >= 20 && sizeMB >= floorMB;
    });

    const ranked = filteredTorrents.map((torrent) => {
      // Calculate base scores (0-100)
      const formatScore = this.scoreFormat(torrent);
      const sizeScore = this.scoreSize(torrent, audiobook.durationMinutes);
      const seederScore = this.scoreSeeders(torrent.seeders);
      const matchScore = this.scoreMatch(torrent, audiobook, requireAuthor, stopWords, characterReplacements);

      const baseScore = formatScore + sizeScore + seederScore + matchScore;

      // Calculate bonus modifiers
      const bonusModifiers: BonusModifier[] = [];

      // Indexer priority bonus (default: 10/25 = 40%)
      if (torrent.indexerId !== undefined) {
        const priority = indexerPriorities?.get(torrent.indexerId) ?? 10;
        const modifier = priority / 25;  // Convert 1-25 to 0.04-1.0 (4%-100%)
        const points = baseScore * modifier;

        bonusModifiers.push({
          type: 'indexer_priority',
          value: modifier,
          points: points,
          reason: `Indexer priority ${priority}/25 (${Math.round(modifier * 100)}%)`,
        });
      }

      // Flag bonuses/penalties
      if (torrent.flags && torrent.flags.length > 0 && flagConfigs && flagConfigs.length > 0) {
        torrent.flags.forEach(torrentFlag => {
          // Case-insensitive, whitespace-trimmed matching
          const matchingConfig = flagConfigs.find(cfg =>
            cfg.name.trim().toLowerCase() === torrentFlag.trim().toLowerCase()
          );

          if (matchingConfig) {
            const modifier = matchingConfig.modifier / 100; // Convert -100 to 100 → -1.0 to 1.0
            const points = baseScore * modifier;

            bonusModifiers.push({
              type: 'indexer_flag',
              value: modifier,
              points: points,
              reason: `Flag "${torrentFlag}" (${matchingConfig.modifier > 0 ? '+' : ''}${matchingConfig.modifier}%)`,
            });
          }
        });
      }

      // Sum all bonus points
      const bonusPoints = bonusModifiers.reduce((sum, mod) => sum + mod.points, 0);

      // Calculate final score
      const finalScore = baseScore + bonusPoints;

      return {
        ...torrent,
        score: baseScore,
        bonusModifiers,
        bonusPoints,
        finalScore,
        rank: 0, // Will be assigned after sorting
        breakdown: {
          formatScore,
          sizeScore,
          seederScore,
          matchScore,
          totalScore: baseScore,
          notes: this.generateNotes(torrent, {
            formatScore,
            sizeScore,
            seederScore,
            matchScore,
            totalScore: baseScore,
            notes: [],
          }, audiobook.durationMinutes),
        },
      };
    });

    // Sort by finalScore descending (best first), then by publishDate descending (newest first) for tiebreakers
    ranked.sort((a, b) => {
      // Primary: sort by final score
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      // Tiebreaker: sort by publishDate (newest first)
      return b.publishDate.getTime() - a.publishDate.getTime();
    });

    // Assign ranks
    ranked.forEach((r, index) => {
      r.rank = index + 1;
    });

    return ranked;
  }

  /**
   * Get detailed scoring breakdown for a torrent
   */
  getScoreBreakdown(
    torrent: TorrentResult,
    audiobook: AudiobookRequest,
    requireAuthor: boolean = true
  ): ScoreBreakdown {
    const formatScore = this.scoreFormat(torrent);
    const sizeScore = this.scoreSize(torrent, audiobook.durationMinutes);
    const seederScore = this.scoreSeeders(torrent.seeders);
    const matchScore = this.scoreMatch(torrent, audiobook, requireAuthor);
    const totalScore = formatScore + sizeScore + seederScore + matchScore;

    return {
      formatScore,
      sizeScore,
      seederScore,
      matchScore,
      totalScore,
      notes: this.generateNotes(torrent, {
        formatScore,
        sizeScore,
        seederScore,
        matchScore,
        totalScore,
        notes: [],
      }, audiobook.durationMinutes),
    };
  }

  /**
   * Score format quality (10 points max)
   * Reduced from 25 to make room for data-driven size scoring
   * M4B with chapters: 10 pts
   * M4B without chapters: 9 pts
   * FLAC: 7 pts (lossless audio, excellent quality)
   * M4A: 6 pts
   * MP3: 4 pts
   * Other: 1 pt
   */
  private scoreFormat(torrent: TorrentResult): number {
    const format = this.detectFormat(torrent);

    switch (format) {
      case 'M4B':
        return torrent.hasChapters !== false ? 10 : 9;
      case 'FLAC':
        return 7;
      case 'M4A':
        return 6;
      case 'MP3':
        return 4;
      default:
        return 1;
    }
  }

  /**
   * Score file size quality (15 points max)
   * Uses book runtime and file size to validate correct file type
   * Filters out ebooks and ranks audiobook quality
   *
   * @param torrent - Torrent result with size in bytes
   * @param runtimeMinutes - Book runtime in minutes from Audnexus
   * @returns 0-15 points based on MB/min ratio
   *
   * Algorithm:
   * - >= 1.0 MB/min → 15/15 points (high quality baseline)
   * - Linear scaling below 1.0 MB/min
   * - 0 points if no runtime data (graceful degradation)
   *
   * Note: Files < 20 MB are pre-filtered in rankTorrents()
   */
  private scoreSize(torrent: TorrentResult, runtimeMinutes: number | undefined): number {
    // Graceful degradation: no runtime data = no size scoring
    if (!runtimeMinutes || runtimeMinutes === 0) {
      return 0;
    }

    const sizeMB = torrent.size / (1024 * 1024);
    const mbPerMin = sizeMB / runtimeMinutes;

    // High quality baseline: 1.0 MB/min or higher gets full points
    // This is ~64 kbps MP3 equivalent
    if (mbPerMin >= 1.0) {
      return 15;
    }

    // Linear scaling below baseline
    // 0.5 MB/min = 7.5 points
    // 0.3 MB/min = 4.5 points
    return mbPerMin * 15;
  }

  /**
   * Score seeder count (15 points max)
   * Logarithmic scaling:
   * 1 seeder: 0 points
   * 10 seeders: 6 points
   * 100 seeders: 12 points
   * 1000+ seeders: 15 points
   *
   * Note: NZB/Usenet results don't have seeders concept - centralized servers provide guaranteed availability
   */
  private scoreSeeders(seeders: number | undefined): number {
    // Handle undefined/null (NZB results) - give full score since Usenet has centralized availability
    if (seeders === undefined || seeders === null || isNaN(seeders)) {
      return 15; // Full score - Usenet doesn't need seeders, content is on centralized servers
    }

    if (seeders === 0) return 0;
    return Math.min(15, Math.log10(seeders + 1) * 6);
  }


  /**
   * Score title/author match quality (60 points max)
   * Title similarity: 0-45 points (heavily weighted!)
   * Author presence: 0-15 points
   */
  private scoreMatch(
    torrent: TorrentResult,
    audiobook: AudiobookRequest,
    requireAuthor: boolean = true,
    customStopWords?: string[],
    characterReplacements?: Record<string, string>
  ): number {
    // A release word with an apostrophe ending matches only a request word written with one (#316)
    const release = keepUnrequestedApostrophes(torrent.title, apostropheEndingWords(audiobook.title, characterReplacements), characterReplacements);
    // Normalize for matching (handles CamelCase, punctuation separators, diacritics)
    const torrentTitle = normalizeForMatching(release, characterReplacements);
    const requestTitle = normalizeForMatching(audiobook.title, characterReplacements);
    // Fail closed: a title with no letters or digits left cannot be matched
    if (!requestTitle) return 0;

    // Parse authors from RAW string first (preserving commas for splitting)
    // Then normalize individual authors for matching. Names under 3 characters are dropped,
    // except names in a non-Latin script, where 2 characters is a full name (金庸, 한강)
    const parsedAuthors = audiobook.author
      .replace(/\s+/g, ' ')
      .trim()
      .split(/,|&| and | - /i)
      .map(a => a.trim())
      .filter(a => (a.length > 2 || hasNonLatinLetter(a)) && !['translator', 'narrator'].includes(a.toLowerCase()));

    // Normalize parsed authors; one that normalizes to nothing is dropped (it would match every title)
    const normalizedAuthors = parsedAuthors.map(a => normalizeForMatching(a, characterReplacements)).filter(a => a.length > 0);
    // Combined normalized author string for fuzzy matching
    const requestAuthorNormalized = normalizedAuthors.join(' ');

    // ========== STAGE 1: WORD COVERAGE FILTER (MANDATORY) ==========
    // Extract significant words (filter out common stop words)
    // Use provided language-specific stop words, or fall back to English defaults
    const stopWords = customStopWords || ['the', 'a', 'an', 'of', 'on', 'in', 'at', 'by', 'for'];

    const extractWords = (text: string, stopList: string[]): string[] =>
      normalizeForMatching(text, characterReplacements).split(' ').filter(word => word.length > 0 && !stopList.includes(word));

    // Separate required words (outside parentheses/brackets/colon subtitles) from optional words
    // This handles common patterns like:
    //   "Title (Subtitle)" where subtitle may be omitted
    //   "Title: Series Name" where Audible appends series names after a colon
    // Note: Run on ORIGINAL title to preserve brackets/colons, then normalize the result
    const separateRequiredOptional = (title: string): { required: string; optional: string } => {
      // Work with original title format for bracket/colon detection (fullwidth （）［］： fold to ASCII)
      const originalTitle = audiobook.title.toLowerCase().replace(FULLWIDTH_RE, fromFullwidth);

      // Extract content in parentheses/brackets (including CJK 【】) as optional
      const optionalPattern = /[(\[{【]([^)\]}】]+)[)\]}】]/g;
      const optionalMatches: string[] = [];
      let match;

      while ((match = optionalPattern.exec(originalTitle)) !== null) {
        optionalMatches.push(match[1]);
      }

      // Remove parenthetical/bracketed content to get the non-bracketed portion
      let requiredRaw = originalTitle.replace(/[(\[{【][^)\]}】]+[)\]}】]/g, ' ').trim();

      // Treat content after a colon as optional (Audible commonly appends series names)
      // e.g., "The Finest Edge of Twilight: Dungeons & Dragons" → required: title, optional: series
      const colonIndex = requiredRaw.indexOf(':');
      if (colonIndex > 0 && colonIndex < requiredRaw.length - 1) {
        const afterColon = requiredRaw.substring(colonIndex + 1).trim();
        if (afterColon.length > 0) {
          optionalMatches.push(afterColon);
        }
        requiredRaw = requiredRaw.substring(0, colonIndex).trim();
      }

      // Normalize the required portion (handles CamelCase, punctuation)
      const required = normalizeForMatching(requiredRaw, characterReplacements);
      const optional = optionalMatches.join(' ');

      return { required, optional };
    };

    const { required: requiredTitle, optional: optionalTitle } = separateRequiredOptional(requestTitle);
    const optionalWords = new Set(extractWords(optionalTitle, stopWords));

    // Extract words from required portion only for coverage check
    // (a required portion with no letters or digits left falls back to the whole title)
    // Numbers fold for coverage: 01 = 1, "seven" = 7, and a volume token (t01, book2) names its number
    const requiredWords = extractWords(requiredTitle || requestTitle, stopWords);
    const coverageWords = requiredWords.map(foldNumberWord);
    const torrentWords = foldReleaseWords(extractWords(torrentTitle, stopWords));

    // Calculate word coverage: how many REQUIRED words appear in TORRENT
    if (coverageWords.length > 0) {
      const matchedWords = coverageWords.filter(word => isWordInTitle(word, torrentWords, torrentTitle));
      // HARD REQUIREMENT: Must have 80%+ coverage of REQUIRED words (a title of only stop words skips this)
      if (matchedWords.length / coverageWords.length < 0.80) return 0;
      // G4a (automatic mode): a number in the required title is never optional, unless it is the series
      // position written before a subtitle split ("Die Tribute von Panem 1. Tödliche Spiele")
      const splitPositions = splitPositionNumbers(audiobook.title);
      if (requireAuthor && missingRequiredNumber(coverageWords.filter(w => !splitPositions.has(w)), torrentWords)) return 0;
    }

    // ========== STAGE 1.5: AUTHOR PRESENCE CHECK (AUTOMATIC MODE) ==========
    // Interactive search (requireAuthor: false) shows all results. Rules: match-gates.md (G3)
    if (requireAuthor && !isAuthorPresent(torrentTitle, normalizedAuthors)) return 0;
    // G4c: the request (title or catalog series part) names one position and the release names another
    const catalog = { series: audiobook.series, seriesPart: audiobook.seriesPart };
    if (requireAuthor && volumeConflict(audiobook.title, release, stopWords, characterReplacements, catalog)) return 0;
    // G4b: a one-word title must start a name element of the release (left boundary only)
    const shortWord = shortTitleWord(requiredWords);
    if (requireAuthor && shortWord) {
      const requiredTokens = (requiredTitle || requestTitle).split(' ');
      const leadingWords = requiredTokens.slice(0, Math.max(0, requiredTokens.indexOf(shortWord)));
      const context = { word: shortWord, authors: normalizedAuthors, leadingWords, characterReplacements };
      if (!shortTitleStandsAlone(release, context)) return 0;
    }

    // ========== STAGE 2: TITLE MATCHING (0-35 points) ==========
    let titleScore = 0;

    // Folded torrent title that keeps the markers ([ ] ( ) :) normalization removes, for suffix/prefix checks
    const torrentTitleOriginal = foldForMatching(release, characterReplacements);

    // Try matching with full title first, then fall back to required title (without parentheses)
    const titlesToTry = [requestTitle];
    if (requiredTitle && requiredTitle !== requestTitle) {
      titlesToTry.push(requiredTitle); // Add required-only version if different
    }

    let bestMatch = false;
    for (const titleToMatch of titlesToTry) {
      if (torrentTitle.includes(titleToMatch)) {
        // Found the title, but is it the complete title or part of a longer one?
        const titleIndex = torrentTitle.indexOf(titleToMatch);
        const beforeTitle = torrentTitle.substring(0, titleIndex);
        const afterTitle = torrentTitle.substring(titleIndex + titleToMatch.length);

        // For metadata marker detection, try to find where the title starts in the ORIGINAL string
        // Search for key words from the title to locate position in original
        const titleWords = titleToMatch.split(/\s+/).filter(w => w.length > 2 || hasUnspacedScript(w));
        let afterTitleOriginal = '';
        if (titleWords.length > 0) {
          // Find the last significant title word in the original string
          const lastTitleWord = titleWords[titleWords.length - 1];
          const lastWordIdxOriginal = torrentTitleOriginal.lastIndexOf(lastTitleWord);
          if (lastWordIdxOriginal !== -1) {
            afterTitleOriginal = torrentTitleOriginal.substring(lastWordIdxOriginal + lastTitleWord.length);
          }
        }

        // Extract significant words BEFORE the matched title
        const beforeWords = extractWords(beforeTitle, stopWords);

        // Title is complete if:
        // 1. Acceptable prefix (no words, OR structured metadata like "Author - Series - ")
        // 2. Followed by clear metadata markers (not "'s Secret" or " Is Watching")
        // Check ORIGINAL title for metadata markers ([ ] ( ) etc. not normalized away)
        const metadataMarkers = [' by ', ' - ', ' [', ' (', ' {', ' :', ','];

        // Check if afterTitle starts with any author name (handles space-separated format like "Title Author Year")
        const afterStartsWithAuthor = normalizedAuthors.some(author =>
          author.length > 2 && afterTitle.trim().startsWith(author)
        );

        // Check metadata markers in both normalized and original suffixes
        // G1: a colon right after the title counts only when the release subtitle agrees with the request's
        const hasMetadataSuffix = afterTitle === '' ||
                                  metadataMarkers.some(marker => afterTitle.startsWith(marker)) ||
                                  metadataMarkers.some(marker => afterTitleOriginal.startsWith(marker)) ||
                                  afterStartsWithAuthor ||
                                  colonSubtitleAgrees(afterTitleOriginal, optionalWords, text => extractWords(text, stopWords));

        // Check prefix validity:
        // - No words before = clean match
        // - Title preceded by separator (` - `, `: `) = structured metadata (Author - Series - Title)
        // - Author name in prefix = author attribution before title
        const hasNoWordsPrefix = beforeWords.length === 0;

        // Check if title is immediately preceded by a metadata separator
        // This handles "Author - Series - 01 - Title" patterns
        // Check both normalized and original strings for separators
        const precedingText = beforeTitle.trimEnd();

        // Also check original string for separators that got normalized away (like colons)
        let beforeTitleOriginal = '';
        if (titleWords.length > 0) {
          const firstTitleWord = titleWords[0];
          const firstWordIdxOriginal = torrentTitleOriginal.indexOf(firstTitleWord);
          if (firstWordIdxOriginal !== -1) {
            beforeTitleOriginal = torrentTitleOriginal.substring(0, firstWordIdxOriginal).trimEnd();
          }
        }

        const titlePrecededBySeparator =
          precedingText.endsWith('-') ||
          precedingText.endsWith(':') ||
          precedingText.endsWith('—') ||
          beforeTitleOriginal.endsWith('-') ||
          beforeTitleOriginal.endsWith(':') ||
          beforeTitleOriginal.endsWith('—');

        // Check if any author name appears in the prefix
        // This handles "Author Name - Title" patterns
        const authorInPrefix = normalizedAuthors.some(author =>
          author.length > 2 && beforeTitle.includes(author)
        );

        const hasAcceptablePrefix =
          hasNoWordsPrefix ||
          titlePrecededBySeparator ||
          authorInPrefix;

        const isCompleteTitle = hasAcceptablePrefix && hasMetadataSuffix;

        if (isCompleteTitle) {
          // Complete title match → full points
          titleScore = 45;
          bestMatch = true;
          break; // Found a good match, stop trying
        }
      }
    }

    if (!bestMatch) {
      // No complete match found, use fuzzy similarity as fallback
      // Try against full title first, then required title
      const fuzzyScores = titlesToTry.map(title => compareTwoStrings(title, torrentTitle));
      titleScore = Math.max(...fuzzyScores) * 45;
    }

    // ========== STAGE 3: AUTHOR MATCHING (0-15 points) ==========
    // How many authors appear as whole words or matching initials (G2, G3)
    const authorMatches = normalizedAuthors.filter(author =>
      authorAppears(torrentTitle, author) || matchesByInitials(torrentTitle, author)
    );

    let authorScore = 0;
    if (authorMatches.length > 0) {
      // Whole-word or initials match → proportional credit
      authorScore = (authorMatches.length / normalizedAuthors.length) * 15;
    } else {
      // No exact match → use fuzzy similarity for partial credit
      authorScore = compareTwoStrings(requestAuthorNormalized, torrentTitle) * 15;
    }

    return Math.min(60, titleScore + authorScore);
  }

  /**
   * Detect format from torrent title
   */
  private detectFormat(torrent: TorrentResult): 'M4B' | 'M4A' | 'MP3' | 'FLAC' | 'OTHER' {
    // Use explicit format if provided
    if (torrent.format) {
      return torrent.format;
    }

    const title = torrent.title.toUpperCase();

    // Check for format keywords in title
    if (title.includes('M4B')) return 'M4B';
    if (title.includes('M4A')) return 'M4A';
    if (title.includes('MP3')) return 'MP3';
    if (title.includes('FLAC')) return 'FLAC';

    // Default to OTHER if no format detected
    return 'OTHER';
  }

  /**
   * Generate human-readable notes about scoring
   */
  private generateNotes(
    torrent: TorrentResult,
    breakdown: ScoreBreakdown,
    runtimeMinutes?: number
  ): string[] {
    const notes: string[] = [];

    // Format notes
    const format = this.detectFormat(torrent);
    if (format === 'M4B') {
      notes.push('Excellent format (M4B)');
      if (torrent.hasChapters !== false) {
        notes.push('Has chapter markers');
      }
    } else if (format === 'FLAC') {
      notes.push('Lossless format (FLAC)');
    } else if (format === 'M4A') {
      notes.push('Good format (M4A)');
    } else if (format === 'MP3') {
      notes.push('Acceptable format (MP3)');
    } else {
      notes.push('Unknown or uncommon format');
    }

    // Size notes
    if (runtimeMinutes && runtimeMinutes > 0) {
      const sizeMB = torrent.size / (1024 * 1024);
      const mbPerMin = sizeMB / runtimeMinutes;

      if (mbPerMin >= 1.5) {
        notes.push('✓ Premium quality (high bitrate)');
      } else if (mbPerMin >= 1.0) {
        notes.push('✓ High quality');
      } else if (mbPerMin >= 0.5) {
        notes.push('Standard quality');
      } else if (mbPerMin >= 0.3) {
        notes.push('⚠️ Low quality (low bitrate)');
      } else {
        notes.push('⚠️ Very low quality - may be ebook');
      }
    }

    // Seeder notes (skip for NZB/Usenet results which don't have seeders)
    if (torrent.seeders !== undefined && torrent.seeders !== null && !isNaN(torrent.seeders)) {
      if (torrent.seeders === 0) {
        notes.push('⚠️ No seeders available');
      } else if (torrent.seeders < 5) {
        notes.push(`Low seeders (${torrent.seeders})`);
      } else if (torrent.seeders >= 50) {
        notes.push(`Excellent availability (${torrent.seeders} seeders)`);
      }
    }

    // Match notes (now worth 60 points!)
    if (breakdown.matchScore < 24) {
      notes.push('⚠️ Poor title/author match');
    } else if (breakdown.matchScore < 42) {
      notes.push('⚠️ Weak title/author match');
    } else if (breakdown.matchScore >= 54) {
      notes.push('✓ Excellent title/author match');
    }

    // Overall quality assessment
    if (breakdown.totalScore >= 75) {
      notes.push('✓ Excellent choice');
    } else if (breakdown.totalScore >= 55) {
      notes.push('✓ Good choice');
    } else if (breakdown.totalScore < 35) {
      notes.push('⚠️ Consider reviewing this choice');
    }

    return notes;
  }

  // =========================================================================
  // EBOOK TORRENT RANKING (for indexer results)
  // Reuses scoreMatch() and scoreSeeders() from audiobook ranking
  // Uses ebook-specific format and size scoring
  // =========================================================================

  /**
   * Rank ebook torrents from indexers
   * Reuses title/author matching and seeder scoring from audiobook ranking
   * Uses ebook-specific format scoring (10 pts for match, 0 otherwise)
   * Uses inverted size scoring (smaller = better, > 20MB filtered)
   *
   * @param torrents - Array of torrent results from Prowlarr
   * @param ebook - Ebook request details (title, author, preferredFormat)
   * @param options - Optional configuration for ranking behavior
   */
  rankEbookTorrents(
    torrents: TorrentResult[],
    ebook: EbookTorrentRequest,
    options: RankEbookTorrentsOptions = {}
  ): RankedEbookTorrent[] {
    const {
      indexerPriorities,
      flagConfigs,
      requireAuthor = true,  // Safe default: require author in automatic mode
      stopWords,
      characterReplacements,
    } = options;

    // Filter out files > 20 MB (too large for ebooks)
    const filteredTorrents = torrents.filter((torrent) => {
      const sizeMB = torrent.size / (1024 * 1024);
      return sizeMB <= 20;
    });

    const ranked = filteredTorrents.map((torrent) => {
      // Detect ebook format from title
      const detectedFormat = this.detectEbookFormat(torrent);

      // Calculate base scores (0-100)
      // Reuse scoreMatch and scoreSeeders from audiobook ranking
      const formatScore = this.scoreEbookFormat(torrent, ebook.preferredFormat);
      const sizeScore = this.scoreEbookSize(torrent);
      const seederScore = this.scoreSeeders(torrent.seeders);
      const matchScore = this.scoreMatch(torrent, {
        title: ebook.title,
        author: ebook.author,
      }, requireAuthor, stopWords, characterReplacements);

      const baseScore = formatScore + sizeScore + seederScore + matchScore;

      // Calculate bonus modifiers (same as audiobooks)
      const bonusModifiers: BonusModifier[] = [];

      // Indexer priority bonus (default: 10/25 = 40%)
      if (torrent.indexerId !== undefined) {
        const priority = indexerPriorities?.get(torrent.indexerId) ?? 10;
        const modifier = priority / 25;  // Convert 1-25 to 0.04-1.0 (4%-100%)
        const points = baseScore * modifier;

        bonusModifiers.push({
          type: 'indexer_priority',
          value: modifier,
          points: points,
          reason: `Indexer priority ${priority}/25 (${Math.round(modifier * 100)}%)`,
        });
      }

      // Flag bonuses/penalties (same as audiobooks)
      if (torrent.flags && torrent.flags.length > 0 && flagConfigs && flagConfigs.length > 0) {
        torrent.flags.forEach(torrentFlag => {
          const matchingConfig = flagConfigs.find(cfg =>
            cfg.name.trim().toLowerCase() === torrentFlag.trim().toLowerCase()
          );

          if (matchingConfig) {
            const modifier = matchingConfig.modifier / 100;
            const points = baseScore * modifier;

            bonusModifiers.push({
              type: 'indexer_flag',
              value: modifier,
              points: points,
              reason: `Flag "${torrentFlag}" (${matchingConfig.modifier > 0 ? '+' : ''}${matchingConfig.modifier}%)`,
            });
          }
        });
      }

      // Sum all bonus points
      const bonusPoints = bonusModifiers.reduce((sum, mod) => sum + mod.points, 0);

      // Calculate final score
      const finalScore = baseScore + bonusPoints;

      return {
        ...torrent,
        score: baseScore,
        bonusModifiers,
        bonusPoints,
        finalScore,
        rank: 0, // Will be assigned after sorting
        breakdown: {
          formatScore,
          sizeScore,
          seederScore,
          matchScore,
          totalScore: baseScore,
          notes: this.generateEbookNotes(torrent, {
            formatScore,
            sizeScore,
            seederScore,
            matchScore,
            totalScore: baseScore,
            notes: [],
          }, ebook.preferredFormat),
        },
        ebookFormat: detectedFormat !== 'unknown' ? detectedFormat : undefined,
      };
    });

    // Sort by finalScore descending (best first), then by publishDate descending (newest first)
    ranked.sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      return b.publishDate.getTime() - a.publishDate.getTime();
    });

    // Assign ranks
    ranked.forEach((r, index) => {
      r.rank = index + 1;
    });

    return ranked;
  }

  /**
   * Score ebook format (10 points max)
   * Full points for matching preferred format, 0 otherwise
   */
  private scoreEbookFormat(torrent: TorrentResult, preferredFormat: string): number {
    const detectedFormat = this.detectEbookFormat(torrent);
    const preferred = preferredFormat.toLowerCase();

    // Exact match = full points, otherwise 0
    if (detectedFormat === preferred) {
      return 10;
    }

    return 0;
  }

  /**
   * Score ebook file size (15 points max, inverted - smaller is better)
   * < 5 MB = 15 pts (full)
   * 5-15 MB = 10 pts
   * 15-20 MB = 5 pts
   * > 20 MB = filtered out (not scored)
   */
  private scoreEbookSize(torrent: TorrentResult): number {
    const sizeMB = torrent.size / (1024 * 1024);

    if (sizeMB < 5) {
      return 15; // Optimal size for ebooks
    } else if (sizeMB <= 15) {
      return 10; // Acceptable, may have images
    } else if (sizeMB <= 20) {
      return 5;  // Large but within limit
    }

    // > 20 MB should have been filtered, but return 0 as safety
    return 0;
  }

  /**
   * Detect ebook format from torrent title
   * Handles formats in various positions: .epub, (epub), [epub], " epub"
   */
  private detectEbookFormat(torrent: TorrentResult): string {
    const title = torrent.title.toLowerCase();

    // Check for common ebook format extensions/keywords
    // Patterns: .format, (format), [format], " format", "_format"
    const formats = ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'cbr'];

    for (const format of formats) {
      if (
        title.includes(`.${format}`) ||    // file.epub
        title.includes(`(${format})`) ||   // (epub)
        title.includes(`[${format}]`) ||   // [epub]
        title.includes(` ${format}`) ||    // " epub" (space before)
        title.includes(`_${format}`) ||    // _epub (underscore)
        title.endsWith(format)             // ends with format
      ) {
        return format;
      }
    }

    // Default to unknown
    return 'unknown';
  }

  /**
   * Generate human-readable notes for ebook scoring
   */
  private generateEbookNotes(
    torrent: TorrentResult,
    breakdown: EbookScoreBreakdown,
    preferredFormat: string
  ): string[] {
    const notes: string[] = [];

    // Format notes
    const detectedFormat = this.detectEbookFormat(torrent);
    if (breakdown.formatScore === 10) {
      notes.push(`✓ Preferred format (${detectedFormat.toUpperCase()})`);
    } else if (detectedFormat !== 'unknown') {
      notes.push(`Different format (${detectedFormat.toUpperCase()}, wanted ${preferredFormat.toUpperCase()})`);
    } else {
      notes.push('⚠️ Unknown format');
    }

    // Size notes
    const sizeMB = torrent.size / (1024 * 1024);
    if (sizeMB < 5) {
      notes.push('✓ Optimal file size');
    } else if (sizeMB <= 15) {
      notes.push('Good file size (may have images)');
    } else if (sizeMB <= 20) {
      notes.push('⚠️ Large file size');
    }

    // Seeder notes (same logic as audiobooks)
    if (torrent.seeders !== undefined && torrent.seeders !== null && !isNaN(torrent.seeders)) {
      if (torrent.seeders === 0) {
        notes.push('⚠️ No seeders available');
      } else if (torrent.seeders < 5) {
        notes.push(`Low seeders (${torrent.seeders})`);
      } else if (torrent.seeders >= 50) {
        notes.push(`Excellent availability (${torrent.seeders} seeders)`);
      }
    }

    // Match notes (same thresholds as audiobooks)
    if (breakdown.matchScore < 24) {
      notes.push('⚠️ Poor title/author match');
    } else if (breakdown.matchScore < 42) {
      notes.push('⚠️ Weak title/author match');
    } else if (breakdown.matchScore >= 54) {
      notes.push('✓ Excellent title/author match');
    }

    // Overall quality assessment
    if (breakdown.totalScore >= 75) {
      notes.push('✓ Excellent choice');
    } else if (breakdown.totalScore >= 55) {
      notes.push('✓ Good choice');
    } else if (breakdown.totalScore < 35) {
      notes.push('⚠️ Consider reviewing this choice');
    }

    return notes;
  }
}

// =========================================================================
// EBOOK RANKING (simplified algorithm for ebook search results)
// =========================================================================

export interface EbookResult {
  md5: string;
  title: string;
  author: string;
  format: string;           // epub, pdf, mobi, etc.
  fileSize?: number;        // in bytes
  downloadUrls: string[];
  source: 'annas_archive' | 'prowlarr';  // Source of the result
  indexerId?: number;       // Prowlarr indexer ID (if applicable)
}

export interface EbookRequest {
  title: string;
  author: string;
  preferredFormat: string;  // User's preferred format (epub, pdf, etc.)
}

export interface RankedEbook extends EbookResult {
  score: number;            // Total score (0-100)
  rank: number;
  breakdown: {
    formatScore: number;    // 0-40 points
    sizeScore: number;      // 0-30 points (inverted - smaller is better)
    sourceScore: number;    // 0-30 points (Anna's Archive priority)
    notes: string[];
  };
}

/**
 * Rank ebook search results
 * Scoring priorities (inverted from audiobooks):
 * - Format match: 40 points (matching preferred format)
 * - Size: 30 points (smaller files = better, inverted from audiobooks)
 * - Source: 30 points (Anna's Archive priority for reliability)
 */
export function rankEbooks(
  results: EbookResult[],
  request: EbookRequest
): RankedEbook[] {
  const preferredFormat = request.preferredFormat.toLowerCase();

  const ranked = results.map((result): RankedEbook => {
    const notes: string[] = [];

    // ========== FORMAT SCORING (0-40 points) ==========
    // Exact format match gets full points
    // Similar formats get partial credit
    let formatScore = 0;
    const resultFormat = result.format.toLowerCase();

    if (resultFormat === preferredFormat) {
      formatScore = 40;
      notes.push(`✓ Preferred format (${result.format.toUpperCase()})`);
    } else {
      // Partial credit for compatible formats
      const ebookFormatGroups = [
        ['epub', 'kepub'],           // EPUB family
        ['mobi', 'azw', 'azw3'],     // Kindle family
        ['pdf'],                      // PDF standalone
        ['fb2', 'fb2.zip'],          // FB2 family
        ['cbz', 'cbr'],              // Comic formats
      ];

      const preferredGroup = ebookFormatGroups.find(g => g.includes(preferredFormat));
      const resultGroup = ebookFormatGroups.find(g => g.includes(resultFormat));

      if (preferredGroup && resultGroup && preferredGroup === resultGroup) {
        formatScore = 30; // Same family
        notes.push(`Similar format (${result.format.toUpperCase()})`);
      } else if (resultFormat === 'epub') {
        formatScore = 25; // EPUB is universally convertible
        notes.push(`Convertible format (${result.format.toUpperCase()})`);
      } else if (resultFormat === 'pdf') {
        formatScore = 15; // PDF is common but less flexible
        notes.push(`PDF format (less flexible)`);
      } else {
        formatScore = 10; // Other formats
        notes.push(`Different format (${result.format.toUpperCase()})`);
      }
    }

    // ========== SIZE SCORING (0-30 points, inverted) ==========
    // For ebooks, smaller files are generally better (cleaner, no bloat)
    // Typical ebook sizes: 0.5-5 MB (good), 5-20 MB (has images), 20+ MB (may have issues)
    let sizeScore = 0;

    if (result.fileSize !== undefined && result.fileSize > 0) {
      const sizeMB = result.fileSize / (1024 * 1024);

      if (sizeMB <= 2) {
        sizeScore = 30; // Ideal size
        notes.push('✓ Optimal file size');
      } else if (sizeMB <= 5) {
        sizeScore = 25; // Good size
        notes.push('Good file size');
      } else if (sizeMB <= 15) {
        sizeScore = 20; // Has images, acceptable
        notes.push('Larger file (may have images)');
      } else if (sizeMB <= 50) {
        sizeScore = 10; // Large, possibly bloated
        notes.push('⚠️ Large file size');
      } else {
        sizeScore = 5; // Very large, suspicious
        notes.push('⚠️ Very large file (may include extras)');
      }
    } else {
      // No size info - give middle score
      sizeScore = 15;
      notes.push('File size unknown');
    }

    // ========== SOURCE SCORING (0-30 points) ==========
    // Anna's Archive is the primary reliable source
    // Future: Prowlarr indexers will get configurable priority
    let sourceScore = 0;

    if (result.source === 'annas_archive') {
      sourceScore = 30; // Full points for Anna's Archive
      notes.push('✓ Anna\'s Archive (reliable)');
    } else if (result.source === 'prowlarr') {
      // Future: Use indexer priority from config
      sourceScore = 15; // Base score for Prowlarr results
      notes.push('Prowlarr indexer');
    }

    const totalScore = formatScore + sizeScore + sourceScore;

    return {
      ...result,
      score: totalScore,
      rank: 0, // Will be assigned after sorting
      breakdown: {
        formatScore,
        sizeScore,
        sourceScore,
        notes,
      },
    };
  });

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  // Assign ranks
  ranked.forEach((r, index) => {
    r.rank = index + 1;
  });

  return ranked;
}

// Singleton instance
let ranker: RankingAlgorithm | null = null;

export function getRankingAlgorithm(): RankingAlgorithm {
  if (!ranker) {
    ranker = new RankingAlgorithm();
  }
  return ranker;
}

/**
 * Helper function to rank torrents using the singleton instance
 *
 * @param torrents - Array of torrent results to rank
 * @param audiobook - Audiobook request details
 * @param options - Optional ranking configuration
 * @returns Ranked torrents with quality scores
 */
export function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest,
  options?: RankTorrentsOptions
): (RankedTorrent & { qualityScore: number })[];

/**
 * Helper function to rank torrents using the singleton instance (legacy signature)
 * @deprecated Use options object instead
 */
export function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest,
  indexerPriorities?: Map<number, number>,
  flagConfigs?: IndexerFlagConfig[]
): (RankedTorrent & { qualityScore: number })[];

export function rankTorrents(
  torrents: TorrentResult[],
  audiobook: AudiobookRequest,
  optionsOrPriorities?: RankTorrentsOptions | Map<number, number>,
  flagConfigs?: IndexerFlagConfig[]
): (RankedTorrent & { qualityScore: number })[] {
  const algorithm = getRankingAlgorithm();

  // Handle both new options object and legacy parameters
  let options: RankTorrentsOptions;
  if (optionsOrPriorities instanceof Map) {
    // Legacy call: rankTorrents(torrents, audiobook, priorities, flags)
    options = {
      indexerPriorities: optionsOrPriorities,
      flagConfigs,
      requireAuthor: true  // Safe default
    };
  } else {
    // New call: rankTorrents(torrents, audiobook, options)
    options = optionsOrPriorities || {};
  }

  const ranked = algorithm.rankTorrents(torrents, audiobook, options);

  // Add qualityScore field for UI compatibility (rounded score)
  return ranked.map((r) => ({
    ...r,
    qualityScore: Math.round(r.score),
  }));
}

/**
 * Helper function to rank ebook torrents using the singleton instance
 *
 * @param torrents - Array of torrent results from Prowlarr
 * @param ebook - Ebook request details (title, author, preferredFormat)
 * @param options - Optional ranking configuration
 * @returns Ranked ebook torrents with quality scores
 */
export function rankEbookTorrents(
  torrents: TorrentResult[],
  ebook: EbookTorrentRequest,
  options?: RankEbookTorrentsOptions
): (RankedEbookTorrent & { qualityScore: number })[] {
  const algorithm = getRankingAlgorithm();
  const ranked = algorithm.rankEbookTorrents(torrents, ebook, options || {});

  // Add qualityScore field for UI compatibility (rounded score)
  return ranked.map((r) => ({
    ...r,
    qualityScore: Math.round(r.score),
  }));
}
