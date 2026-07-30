# Specification: Library Sync Verification

## ADDED Requirements

### Requirement: Audiobookshelf Post-Scan Verification
The system MUST poll Audiobookshelf API to verify a newly imported audiobook is present in the media library before transitioning request status to `available`.

#### Scenario: Successful post-scan item verification
- **GIVEN** an audiobook file copied to `/media/audiobooks/`
- **WHEN** library scan is triggered
- **AND** Audiobookshelf returns item matching the title within 15 seconds
- **THEN** the request status MUST be set to `available`.

#### Scenario: Timeout handling when item not yet indexed
- **GIVEN** an audiobook file copied to `/media/audiobooks/`
- **WHEN** library scan is triggered
- **AND** Audiobookshelf does not return the item after 3 polling attempts (15 seconds)
- **THEN** the request status MUST be set to `downloaded` with a warning log rather than throwing an error.
