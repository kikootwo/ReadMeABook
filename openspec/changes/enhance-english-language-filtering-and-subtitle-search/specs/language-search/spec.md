# Specification: English Language Filtering and Subtitle Search

## ADDED Requirements

### Requirement: Non-English Release Penalty
The ranking algorithm MUST apply a severe penalty (-100 score) or filter out non-English releases (`[German]`, `Hörbuch`, `[French]`, `Livre Audio`, `[Spanish]`, `Audiolibro`) when target language is English.

#### Scenario: Non-English release title rejection
- **GIVEN** a search result with title "Abaddon's Gate [German] Hörbuch"
- **WHEN** ranked for an English audiobook request
- **THEN** the ranking algorithm MUST apply a -100 penalty or exclude the release from automatic selection.

### Requirement: Language Learning Course Exclusion
The ranking algorithm MUST exclude language learning courses (`Pimsleur`, `Learn Spanish`, `Berlitz`) unless the requested audiobook itself is a language course.

#### Scenario: Exclusion of Pimsleur language course
- **GIVEN** a search result titled "Pimsleur German Level 1"
- **WHEN** searching for a general audiobook request
- **THEN** the release MUST be penalized by -100 and excluded from automatic selection.

### Requirement: Subtitle-Cleaned Search Pass
`prowlarr.service.ts` MUST include a 3rd search query pass using the main title before colons or dashes.

#### Scenario: Subtitled title search pass
- **GIVEN** a title "The Expanse 03: Abaddon's Gate"
- **WHEN** `searchWithVariations` is called
- **THEN** it MUST execute a search pass for "Abaddon's Gate" alongside the full title search.
