# Specification: Configurable Preferred Language and Penalty Scoring

## ADDED Requirements

### Requirement: Language Selection Configuration
The system MUST support selecting a preferred audiobook language (`en`, `de`, `es`, `fr`, or `all`) via Admin Settings UI and environment variable (`PREFERRED_AUDIOBOOK_LANGUAGE`).

#### Scenario: Selection of All disables language penalty
- **GIVEN** `preferredLanguage` is configured to "all"
- **WHEN** ranking search results for an audiobook request
- **THEN** non-English releases MUST NOT receive a language penalty score.

### Requirement: Configurable Language Penalty Score
The system MUST allow administrators to customize the score penalty (default: 100) via UI and environment variable (`LANGUAGE_PENALTY_SCORE`).

#### Scenario: Custom penalty score enforcement
- **GIVEN** `languagePenaltyScore` is set to 150 and `preferredLanguage` is "en"
- **WHEN** a German release is scored
- **THEN** the ranking algorithm MUST apply a -150 penalty score to the release.
