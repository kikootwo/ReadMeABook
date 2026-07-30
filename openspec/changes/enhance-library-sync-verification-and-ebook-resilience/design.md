# Design: Enhance Library Sync Verification and Ebook Resilience

## Architecture Overview

```mermaid
sequenceDiagram
    participant Worker as Organize Files Worker
    participant ABS as Audiobookshelf API
    participant DB as ReadMeABook Database

    Worker->>Worker: Copy files to /media/audiobooks/
    Worker->>ABS: Trigger Library Scan (/api/libraries/scan)
    loop Up to 3 retries (5s interval)
        Worker->>ABS: Query /api/items?search=Title
        ABS-->>Worker: Item Found / Not Found
    end
    alt Item Confirmed Found
        Worker->>DB: Set request status = available
    else Timeout Exceeded
        Worker->>DB: Set request status = downloaded (awaiting library sync)
    end
```

## Detailed Component Design

### 1. ABS Verification Helper (`audiobookshelf-library.service.ts`)
- Add method `verifyItemExists(title: string, author?: string): Promise<boolean>`
- Searches ABS library items endpoint and checks title match similarity ($\ge 0.85$).

### 2. Ebook Scraper Timeout Handling (`find-missing-ebooks.processor.ts`)
- Wrap Flaresolverr requests in exponential backoff logic (1s, 2s, 4s).
