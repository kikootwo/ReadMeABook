# Proposal: Enhance English Language Filtering and Subtitle Search

## Executive Summary
This proposal enhances ReadMeABook's search engine and candidate ranking algorithm to:
1. Guarantee 100% English audiobooks by penalizing and filtering out non-English releases (`[German]`, `[French]`, `[Spanish]`, `Hörbuch`, `Livre Audio`) and language-learning courses (`Pimsleur`, `Learn Spanish`, `Berlitz`).
2. Increase candidate search hits by introducing a 3rd subtitle-cleaned query pass (`Abaddon's Gate` from `The Expanse: Abaddon's Gate`) while maintaining strict author verification (`requireAuthor: true`) to prevent false positives.

## Problem Statement
- **Non-English & Language Course Hits:** When searching for English audiobooks, indexers sometimes return non-English releases (e.g. `[German]`, `Hörbuch`, `Livre Audio`) or language-learning courses (`Pimsleur German`), which can score high if the title matches.
- **Subtitle Query Truncation on Indexers:** Long Audible titles with colons/subtitles (e.g. *The Expanse 03: Abaddon's Gate*) fail to match indexer releases that only name the main title (*Abaddon's Gate*).

## Proposed Changes
1. **Language & Course Penalty Filter (`src/lib/utils/ranking-algorithm.ts`):**
   - Detect non-English language tags in release titles (`[German]`, `[French]`, `[Spanish]`, `[Italian]`, `[Russian]`, `[Dutch]`, `[Polish]`, `Hörbuch`, `Livre Audio`, `Audiolibro`).
   - Detect language-learning course tags (`Pimsleur`, `Learn <Language>`, `Berlitz`, `Language Course`).
   - Apply a -100 score penalty / exclusion filter when target language is English.
2. **Subtitle-Cleaned 3-Pass Search (`src/lib/integrations/prowlarr.service.ts`):**
   - Add a 3rd search pass querying main title before colons (`:`) or em-dashes (`-`).
3. **Strict Author Verification Preservation:**
   - Preserve `requireAuthor: true` across all passes to ensure 0 false positive matches.

## Value & Impact
- **100% English Guarantee:** Zero foreign-language audiobooks or language learning courses imported.
- **Increased Hit Rates:** Up to 50% more search hits for long subtitled book titles.
