# Proposal: Configurable Preferred Language and Penalty Scoring

## Executive Summary
This proposal adds user-configurable controls for search result language filtering and scoring penalty calculation in ReadMeABook. System administrators can configure the preferred library audiobook language and scoring penalty via the Admin Settings web UI or environment variables (`PREFERRED_AUDIOBOOK_LANGUAGE`, `LANGUAGE_PENALTY_SCORE`).

## Problem Statement
- Currently, non-English language detection and penalty scoring (-100) are hardcoded to English in the ranking engine.
- Users with multi-lingual libraries or non-English preference cannot easily change the target language from the UI or disable language filtering altogether (`All`).
- The penalty score (-100) is fixed and cannot be adjusted by administrators who want stricter or looser filtering.

## Proposed Changes
1. **Database & System Settings (`src/lib/services/system-settings.service.ts`):**
   - Add `preferredLanguage` setting (`'en' | 'de' | 'es' | 'fr' | 'all'`, default: `'en'`).
   - Add `languagePenaltyScore` setting (`number`, default: `100`).
   - Support ENV overrides: `PREFERRED_AUDIOBOOK_LANGUAGE` and `LANGUAGE_PENALTY_SCORE`.
2. **Admin UI (`src/app/admin/settings/tabs/`):**
   - Add a dropdown select for Preferred Language (`English`, `German`, `Spanish`, `French`, `All (Disable Filtering)`).
   - Add a number input for Language Penalty Score (default: `100`).
3. **Ranking Engine (`src/lib/utils/ranking-algorithm.ts`):**
   - Accept `preferredLanguage` and `languagePenaltyScore` in `RankTorrentsOptions`.
   - If `preferredLanguage === 'all'`, bypass language penalty calculation.
   - If a non-matching language or language course release is detected, deduct `languagePenaltyScore` points (default: `-100`).

## Value & Impact
- Flexible multi-lingual support for international user bases.
- Zero-code configuration via UI or Docker environment variables.
