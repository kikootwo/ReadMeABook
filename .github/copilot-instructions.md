# Copilot Instructions — ReadMeABook

## Critical Rules

- **NEVER commit to the repository.** No `git commit`, `git push`, or staging for commit.
- **Before declaring work complete**, run: `docker compose -f docker-compose.local.yml build readmeabook` — if the build succeeds, tell the user it's ready to test.

---

## Documentation System

### Navigation (MANDATORY)

1. **Read `documentation/TABLEOFCONTENTS.md` FIRST** before any other docs.
2. Identify the 1–3 files relevant to the task.
3. Read **only** those files. Never read all docs sequentially.

### Token Budget

- 20–30% on reading docs (via TABLEOFCONTENTS.md targeting).
- 70–80% on implementation, problem-solving, code generation.
- Skip "Future Enhancements", excessive examples, verbose prose.

---

## Documentation Format (Token-Efficient)

All docs must follow this compact format:

```markdown
# [Title]

**Status:** [✅/⏳/❌] [Brief description]

## Overview
[1–2 sentences]

## Key Details
- Compact bullet lists, not prose
- API endpoints w/ request/response
- Data models w/ field names/types
- Config keys, status enums
- Critical implementation notes

## API/Interfaces
[Tables or compact code blocks]

## Critical Issues (if any)

## Related: [links]
```

### Required content
- API endpoints, data models, config keys, enums, file paths, fixed issues, 1–2 code examples max.

### Forbidden content
- Verbose prose, "why?" sections, large ASCII diagrams, many examples, "future enhancements", "testing strategy", "performance considerations", empty sections, decorative formatting.

---

## Documentation Maintenance

- **Before code changes:** read relevant docs.
- **After code changes:** update docs immediately (token-efficient format).
- **New docs:** update `documentation/TABLEOFCONTENTS.md` with new mapping.

---

## Code Standards

### File Headers (Mandatory)

```typescript
/**
 * Component: [Name]
 * Documentation: documentation/[path].md
 */
```

Header path must point to an existing doc file. Create doc before implementing code.

### File Size

- Max 300–400 lines per file. Refactor if exceeding.

---

## Workflow

1. **Navigate:** Read `TABLEOFCONTENTS.md` → identify relevant doc files.
2. **Read:** Only the identified files. Focus on "Key Details" and "API/Interfaces".
3. **Plan:** Brief understanding (3–4 sentences), then create a todo list of steps.
4. **Implement:** Follow plan, update docs in token-efficient format.
5. **Verify:** Run `docker compose -f docker-compose.local.yml build readmeabook`.

---

## Tech Stack Reference

- **Framework:** Next.js (App Router), React, TypeScript
- **Database:** PostgreSQL + Prisma ORM (`prisma/schema.prisma`)
- **Queue:** Bull (Redis-backed job queue)
- **Testing:** Vitest (run via `node_modules/.bin/vitest run`)
- **Integrations:** Audible (web scraping + Audnexus API), Plex, Audiobookshelf, Prowlarr, qBittorrent, SABnzbd
- **Deployment:** Docker (unified image: `dockerfile.unified`)
- **Compose files:** `docker-compose.yml` (production, no build), `docker-compose.local.yml` (local dev, has build)

## Project Structure

```
src/
  app/          # Next.js App Router pages + API routes
  components/   # React components
  contexts/     # React contexts
  hooks/        # Custom hooks
  lib/
    integrations/  # External service clients (Audible, Plex, etc.)
    services/      # Business logic services
    types/         # TypeScript type definitions
    utils/         # Utility functions
tests/            # Vitest test files (mirrors src/ structure)
prisma/           # Schema + migrations
documentation/    # Token-efficient docs (start with TABLEOFCONTENTS.md)
```

---

## Quality Checklist

Before completing any task:

- [ ] Used TABLEOFCONTENTS.md (not read all files)
- [ ] Read only necessary docs
- [ ] Updated docs in token-efficient format
- [ ] Updated TABLEOFCONTENTS.md if new docs added
- [ ] File headers on new code files
- [ ] No file exceeds 400 lines
- [ ] Docs match implementation
- [ ] Docker build succeeds
- [ ] No commits made
