## ADDED Requirements

### Requirement: Title Cleaning and Parenthetical Tag Normalization
The system SHALL strip parenthetical and bracketed edition tags (such as `(Dramatized Adaptation)`, `(Unabridged)`, `[Full-Cast Edition]`) from indexer search terms before querying Prowlarr/NZBHydra2.

#### Scenario: Searching for Dramatized Adaptation Audiobooks
- **WHEN** a request with title `"All Systems Red (Dramatized Adaptation)"` is searched
- **THEN** the search normalizer cleans the term to `"All Systems Red"` before sending the query to indexers.

### Requirement: Primary Author Isolation
The system SHALL extract the primary author (the string preceding commas, "and", or "&") when querying indexers for multi-author books.

#### Scenario: Searching Multi-Author Requests
- **WHEN** a request with author `"Larry Correia, Jonathan Maberry, Faith Hunter"` is searched
- **THEN** the search engine queries indexers with primary author `"Larry Correia"`.

### Requirement: Multi-Pass Fallback Search Strategy
The system SHALL execute a multi-pass search fallback strategy when initial strict search queries yield 0 results.

#### Scenario: Fallback Search Execution
- **WHEN** Pass 1 (Strict Title + Primary Author) yields 0 indexer results
- **THEN** the search engine automatically executes Pass 2 (Cleaned Title with relaxed author matching) and evaluates match candidates using title distance scoring.

### Requirement: Rate-Limiting and Exponential Backoff for Prowlarr HTTP Calls
The system SHALL enforce a maximum active concurrency ceiling of 10 for Prowlarr API calls and apply exponential backoff retries on HTTP 504 or timeout errors.

#### Scenario: Handling Prowlarr Socket Timeouts
- **WHEN** Prowlarr responds with HTTP 504 or timeout of 60000ms
- **THEN** the worker raises a transient error and Bull retries the search with exponential backoff without marking the request as "searched, 0 results found".
