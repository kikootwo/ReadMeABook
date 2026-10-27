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
| G4b one-word title | automatic | n/a |
| G4c volume conflict | automatic | n/a |

- Unchanged: 50/50 dual threshold, 20 MB filter, `scoreSize` (#318 baseline), format, seeders, bonuses, Stage 2 complete-title rules
- Interactive search: no result is hidden, but G1, G2, Stage 3 whole-word credit and number folding change scores and order (`Ready Player 1` for "Ready Player One" 0 → 41.1; `Naked in Death by JD Robb` 50 → 60)

## Rules
- **Volume words (one list, G1/G4a/G4b):** `t tome vol volume v book bk livre`, glued to the number (`t01`, `bk1`) or followed by it (`book 2`, `#2` reads as `book 2`). G4c positions leave out `v`: a glued `v2` is often a re-release tag
- **G1, colon after the title (Stage 2):** `Title: Subtitle` in the release is a complete title only when the request has an optional part (brackets or after its colon) and the release subtitle (cut at ` by ` ` [` ` (` ` {` ` - ` `,`) agrees: no number the request subtitle lacks (`Book Two`, `Mistborn 2` for "(…, Book 1)" fail), and at least half its words other than volume words and numbers are in the request subtitle. `Deep Down: A Reacher Story` for "Deep Down (A Jack Reacher short story)" → 60
- **G2, initials (Stage 3):** author credit for whole words or `matchesByInitials` (`JD Robb` ↔ `J D Robb`)
- **G3, author words (gate check 1 and 3, Stage 3):** the author, or its first and last name, as whole words. Allowed: trailing `'s`/`s` (`Robert Ludlum's`, `Tom.Clancys`), digits touching (`King2017`), words glued together (`leechild`). Unspaced-script names (`刘慈欣`) keep the substring rule. Fuzzy (≥ 0.85) and initials checks unchanged. `Weird Candy Hail` no longer matches Andy Weir, `Children of the Fleet` no longer matches Lee Child
- **G4a, numbers (Stage 1):** coverage folds `01` = `1`, English number words one to twenty to digits, and reads release volume tokens as their number. Every digit word of the required title must then be in the release; extra release numbers (years, bitrates) never hurt. A bare number right before a `. `, ` - ` or `:` subtitle split is the series position, not a required number (`Die Tribute von Panem 1. Tödliche Spiele`, `He Who Fights with Monsters 1: …`); `#12:` stays required
- **G4b, one-word title (after G4c, before Stage 2):** required title is one word, no digit (`1Q84` exempt), spaced script (CJK/Thai exempt). Left boundary only, per occurrence; at least one occurrence must pass, else reject. Stage 2 runs as before for a release that passes
  - Skip the request's own stop words right before the word (`the` for "The Martian"; `The Getaway Car` for "Getaway" is not skipped)
  - Then the word must be first, follow an author name (full, glued, surname, surname first, collapsed initials, with `'s`/`s`), follow a number or volume token (`Stormlight Archive 3 Oathbringer`, `Discworld.04.Mort`, `Book 1 It Grows on You`), or follow a separator: `: ] ) } — –` always; `-` `.` `_` when spaced or combined (` - `, `. `, `_-_`); a bare `-` `.` `_` only when the name also uses another delimiter (dash: space, `.` or `_`; dot: space or `_`; underscore: space or `.`). So `Stephen-King-You-Like-It-Darker` and `Isaac.Asimov.Second.Foundation` fail, `Andy_Weir-The_Martian` passes
  - Nothing after the word is read: `It Grows on You` for "It" and `Dune Messiah` for "Dune" score as on main
  - Also rejects a Stage 2 complete title the word only ends: `Children of Dune`, `Second Foundation`, `The Fall of Hyperion`
- **G4c, volume conflict (after the author gate):** the request names exactly one position (a volume word, brackets included, or a G4a split number) and the release names other positions only → reject. Read in the release:
  - right after the request's title or series name: explicit markers (`T03`, `Tome 3`, `#3`)
  - right after the series name that precedes the request's position, or after any request subtitle word (not stop words, volume words or numbers): bare numbers too (`Divergent Trilogy 2` for "(Divergent Trilogy, Book 1)", `Twilight Saga 2`, `Wool Silo 3`), except a number followed by a unit (`64 kbps`, `2 CD`, `12 hrs`, `29 Hours`, `2 Discs`; also `parts`, `tracks`, `books`); years (4 digits) are never read
  - a range is the set it holds: `Book 1-7`, `Vol 1-3`, `T1-T3`, `01-12` pass for any position inside
  - Number words are not read. `Discworld 08 - City Watch Book 1 - Guards! Guards!` for "(Discworld, Book 8)" passes. #330 (series position from Audible) stays open; G4c is its title-only subset

## Known risks (automatic mode)
- Let through, scored as on main (left boundary passes): a longer title that starts with the word (`It Grows on You`, `Book 1 It Grows on You`, `It Ends With Us`, `Dune Messiah`, `The Martian Chronicles`, `Mistborn Secret History`), `Chapterhouse: Dune`, a sequel after a series word the request lacks (`Uglies Series 2`, `Skyward Flight 2`), `Dune: Book Two`, numbered sequels of a one-word title (`Dune 2`), and bare numbers after the title alone (`Le Probleme a Trois Corps 2`, `Dungeon Crawler Carl 03`, `Dungeon Crawler Carl Book Three`; #330)
- Right books that fail (5 of 193 in the test corpus): competing numbering (`Narnia Book 1` for Book 6, `The Witcher Book 1` for Book 3), a sub-series number right after the title (`Guards! Guards! - Book 1 of the City Watch`), `Kenneth` for `Ken`, a Roman numeral (`He Who Fights with Monsters I` for "… 1")
- A word other than the author or a separator right before a one-word title fails: `Frank Herbert Collection Dune`, `Audiobook Dune by Frank Herbert`, `Thriller Das Paket`
- Bare-number reading meets competing numbering: `Chronicles of Narnia 1 - The Lion, the Witch and the Wardrobe` for "(The Chronicles of Narnia, Book 2)" fails
- A request that writes `12:` without `#` lets through a sibling that omits the number, scored as on main (`Op-Center: Out of the Ashes`, `He Who Fights with Monsters II`)
- Numbers: spelled-out above twenty, Roman numerals, or a release that omits a required number (`Op-Center: War of Eagles` for "#12") fail; half of a split book (`The Way of Kings … Vol 2` for "(Book 1)") fails
- G3: genitive forms (`Стивена Кинга`) fail the gate
- Apostrophes fold before matching (#466, [ranking-algorithm.md](ranking-algorithm.md)): `L'intruse` matches `L.Intruse`, `Ender's Game` matches `Enders.Game`; a release possessive matches only a request that has the apostrophe there ("The Titans" never matches `The Titan's Curse`). Not handled: subtitles after `. ` / ` - ` stay required (#466)

## Tests
- `tests/utils/ranking-match-gates.test.ts`: wrong-book table, let-through table (main's scores), must-pass table, ebook, races (the right book must win), interactive
- `tests/utils/ranking-right-books-223.test.ts` + `fixtures/ranking-right-books-223.json`: 193 right-book names that clear 50 on main; all but 5 listed exceptions must still clear 50
- `tests/utils/ranking-oracle-223.test.ts` + `fixtures/ranking-oracle-223.json`: 176 pre-#223 scores, unchanged except 7 initials rows (rise)
- `tests/utils/match-gates.test.ts`: helper units

## Related: [ranking-algorithm.md](ranking-algorithm.md)
