# Automatic-Search Match Gates

**Status:** ✅ Implemented | Rejects wrong books that share the title words (#223)

## Overview
Extra checks inside `scoreMatch` (`src/lib/utils/ranking-algorithm.ts`, helpers in `src/lib/utils/match-gates.ts`). A gate returns matchScore 0. Rejects run only in automatic mode (`requireAuthor: true`: audiobook and ebook automatic search); interactive search still lists every result.

## Scope
| Gate | Rejects in | Scoring change in |
|---|---|---|
| G1 colon subtitle | n/a | both modes |
| G2 initials credit | n/a | both modes |
| G3 author whole words | automatic | both modes (Stage 3) |
| G4a numbers | automatic | both modes (coverage folding) |
| G4b one-word title | automatic | automatic only (the 45) |
| G4c volume conflict | automatic | n/a |

- Unchanged: 50/50 dual threshold, 20 MB filter, `scoreSize` (#318 baseline), format, seeders, bonuses
- Divergence: G4b's complete-title 45 is automatic only, so `Stephen King - It (Unabridged)` scores 60 in automatic search and about 18.5 in interactive search

## Rules
- **G1, colon after the title (Stage 2):** `Title: Subtitle` in the release is a complete title only when the request has an optional part (brackets or after its colon) and at least half the significant words of the release subtitle (cut at ` by ` ` [` ` (` ` {` ` - ` `,`) are in it. `Deep Down: A Reacher Story` for "Deep Down (A Jack Reacher short story)" → 60; `Mistborn: The Well of Ascension` for "Mistborn" earns nothing new
- **G2, initials (Stage 3):** author credit for whole words or `matchesByInitials` (`JD Robb` ↔ `J D Robb`)
- **G3, author words (gate check 1 and 3, Stage 3):** the author, or its first and last name, as whole words. Allowed: trailing `'s`/`s` (`Robert Ludlum's`, `Tom.Clancys`), digits touching (`King2017`), words glued together (`leechild`). Unspaced-script names (`刘慈欣`) keep the substring rule. Fuzzy (≥ 0.85) and initials checks unchanged. `Weird Candy Hail` no longer matches Andy Weir, `Children of the Fleet` no longer matches Lee Child
- **G4a, numbers (Stage 1):** coverage folds `01` = `1`, English number words one to twenty to digits, and reads release volume tokens `t01 tome2 vol3 v4 book5 livre6` as their number. Every digit word of the required title must then be in the release; extra release numbers (years, bitrates) never hurt
- **G4b, one-word title (after Stage 2, only when no complete match):** required title is one word, no digit (`1Q84` exempt), spaced script (CJK/Thai exempt). Checked per occurrence; stop words skipped on both sides
  - Left: start, end of an author name (with `'s`/`s`, glued, collapsed initials), a separator `- : — ] )`, or a number/volume token
  - Right, clean: end, `by`, author name, year, bitrate (`64kbps`, `128k`), ordinal (`40th`), a request subtitle word, a word in `AFTER_TITLE_WORDS` (formats, ebook formats, `unabridged abridged audiobook audio retail eng en english`, edition words, `ungekurzt ungekuerzt gekurzt horbuch hoerbuch german deutsch de fr french vf vff integral integrale audiolibro completo es spanish ita italian`) or a phrase (`read by, narrated by, full cast, livre audio, lu par, letto da, leido por, narrado por`)
  - Right, loose: a separator `- : — , ( [ {` or a number/volume word. Loose passes with fuzzy credit; clean earns the complete 45
- **G4c, volume conflict (after the author gate):** the request names exactly one position (`#N`, `book N`, `tome N`, `vol N`, `tN`, brackets included) and the release names a different one right after the request's title or series name → reject. A bare number is never a position; number words are not read. `Dungeon Crawler Carl, T03` for "(book 1)" → 0; `Discworld 08 - City Watch Book 1 - Guards! Guards!` for "Guards! Guards! (Discworld, Book 8)" passes. #330 (series position from Audible) stays open; G4c is its title-only subset

## Known risks (automatic mode)
- One-word titles followed by a word not in the list, with no separator: `Dune Deluxe Edition` passes, but `Stephen King The Stand Complete and Uncut`, `Educated A Memoir by Tara Westover`, `Herbert Frank Dune MP3` (surname first) fail
- Numbers: spelled-out above twenty, Roman numerals, or a release that omits the number (`Op-Center: War of Eagles`) fail
- G4c: competing numbering (Narnia order, prequels numbered 0), half of a split book (`The Way of Kings … Vol 2` for "(Book 1)") fails
- G3 nicknames: `Ken` no longer matches `Kenneth`; genitive forms (`Стивена Кинга`) fail the gate
- Still passes: numbered sequels of a one-word title (`Dune 2`, `Dune Book 2`); an anthology name listing its contents (`Lee Child - MatchUp (Getaway, …)`); an omnibus (`Op-Center Books 1-12`)
- Not handled: apostrophes in titles (`L'intruse` vs `L.Intruse`) and request subtitles after `. ` or ` - `

## Tests
- `tests/utils/ranking-match-gates.test.ts`: wrong-book table, must-pass table (one row per language, ebook, interactive)
- `tests/utils/ranking-oracle-223.test.ts` + `fixtures/ranking-oracle-223.json`: 176 pre-#223 scores, unchanged except 7 initials rows (rise)
- `tests/utils/match-gates.test.ts`: helper units

## Related: [ranking-algorithm.md](ranking-algorithm.md)
