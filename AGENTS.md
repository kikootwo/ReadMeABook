# AGENTS.md - Project Standards & Workflow

**Critical:** This document defines AI-optimized documentation standards and development workflow.

---

## 1. Token-Efficient Documentation System

### Why Token Efficiency Matters

**Problem:** Documentation consumes significant token budget, leaving limited context for implementation.

**Solution:** Documentation optimized for AI consumption, not human reading. Average 68-72% token reduction while preserving all technical details.

### Documentation Structure

```
documentation/
├── TABLEOFCONTENTS.md          # Navigation index (read THIS FIRST)
├── README.md                    # Project overview
├── backend/
│   ├── database.md             # Schema, Prisma, migrations
│   └── services/
│       ├── auth.md             # Plex OAuth, JWT, RBAC
│       ├── config.md           # Settings, encryption
│       ├── jobs.md             # Bull queue, processors
│       └── scheduler.md        # Cron jobs, recurring tasks
├── integrations/
│   ├── plex.md                 # Library scanning, OAuth, matching
│   └── audible.md              # Web scraping, metadata
├── phase3/                     # Automation pipeline
│   ├── README.md               # Pipeline overview
│   ├── qbittorrent.md          # Download client
│   ├── prowlarr.md             # Indexer search
│   ├── ranking-algorithm.md    # Torrent selection
│   └── file-organization.md    # File management, seeding
├── frontend/
│   ├── components.md           # React components
│   ├── routing-auth.md         # Route protection
│   └── pages/
│       └── login.md            # Login page design
├── deployment/
│   └── docker.md               # Docker Compose, volumes
└── [feature-specific docs]
```

---

## 2. Using TABLEOFCONTENTS.md (MANDATORY)

### **RULE: Always Start Here**

**Before reading ANY documentation:**
1. **Read `documentation/TABLEOFCONTENTS.md` FIRST**
2. Identify relevant sections for your task
3. Read ONLY the specific files you need
4. **Never read all files sequentially** (wastes tokens)

### Example Workflow

**Bad (Token wasteful):**
```
Task: Fix Plex authentication
❌ Read README.md → backend/* → integrations/* → ...
```

**Good (Token efficient):**
```
Task: Fix Plex authentication
✅ Read TABLEOFCONTENTS.md → Identify: backend/services/auth.md, integrations/plex.md
✅ Read only those 2 files
✅ Begin implementation
```

### TABLEOFCONTENTS.md Format

Maps questions/features to specific documentation files:
- "How does authentication work?" → backend/services/auth.md
- "How do downloads work?" → phase3/qbittorrent.md, backend/services/jobs.md
- Organized by: Authentication, Configuration, Database, Integrations, Automation, etc.

---

## 3. Token-Efficient Documentation Format

### Mandatory Format Standards

**All documentation MUST follow this token-optimized format:**

#### Structure
```markdown
# [Title]

**Status:** [✅ Implemented / ⏳ In Progress / ❌ Not Started] [Brief description]

## Overview
[1-2 sentence summary]

## Key Details
- Compact bullet lists (not prose)
- API endpoints with request/response
- Data models with field names/types
- Configuration keys
- Critical implementation notes

## API/Interfaces
[Tables or compact code blocks]

## Critical Issues (if any)
[Only important items]

## Related: [links to other docs]
```

#### Forbidden Content (Removed for Token Efficiency)
- ❌ Verbose prose explanations
- ❌ "Why?" sections (keep brief rationale only)
- ❌ Large ASCII diagrams (minimal only)
- ❌ Excessive examples (max 1-2)
- ❌ "Future Enhancements" sections
- ❌ "Testing Strategy" (unless critical)
- ❌ "Performance Considerations" (unless critical)
- ❌ Empty sections
- ❌ Decorative formatting

#### Required Content (Preserve Completely)
- ✅ API endpoint definitions
- ✅ Data model field names and types
- ✅ Configuration keys and values
- ✅ Status values and enums
- ✅ File paths and code locations
- ✅ Critical implementation details
- ✅ "Fixed Issues" (troubleshooting context)
- ✅ Essential code examples (1-2 max)

### Format Examples

**Before (Token wasteful - 180 lines):**
```markdown
# User Authentication Service

## Current State

**Status:** Implemented ✅

This service handles all authentication and authorization logic for the
ReadMeABook application, including Plex OAuth integration, JWT session
management, and role-based access control.

## Design Architecture

### Why Plex OAuth?

Plex OAuth was chosen for several important reasons:
- No need to manage passwords
- Users already have Plex accounts
- Seamless integration with Plex ecosystem
...
[continues for 150+ more lines]
```

**After (Token efficient - 50 lines):**
```markdown
# User Authentication Service

**Status:** ✅ Implemented | Plex OAuth + JWT sessions + RBAC

## Overview
Handles Plex OAuth, JWT session management, role-based access control (user/admin).

## Key Details
- **Auth:** Plex OAuth flow → JWT tokens (access: 1h, refresh: 7d)
- **Roles:** user (requests only), admin (full access)
- **First user:** Auto-promoted to admin
- **Endpoints:**
  - POST /api/auth/plex/login → {authUrl, pinId}
  - GET /api/auth/plex/callback?pinId → {accessToken, refreshToken, user}
  - POST /api/auth/refresh → {accessToken}
  - GET /api/auth/me → {user}
- **Middleware:** requireAuth(), requireAdmin()
- **Storage:** HTTP-only cookies + localStorage

## JWT Payload
```json
{
  "sub": "user-uuid",
  "plexId": "plex-id",
  "role": "admin",
  "exp": 1234571490
}
```
---

## 4. Implementation Strategy

### Step 1: Navigate with TABLEOFCONTENTS.md
- Read TABLEOFCONTENTS.md to find relevant docs
- Identify 1-3 specific files needed (not all docs)

### Step 2: Read Minimal Context
- Read ONLY the identified files
- Focus on "Key Details" and "API/Interfaces" sections
- Skip examples unless implementing similar functionality

### Step 3: Reiterate Understanding
- Brief paragraph (3-4 sentences max)
- What user wants, what's affected, expected outcome

### Step 4: Create Implementation Plan (TodoWrite)
```
- [ ] Read: [specific doc files]
- [ ] Update: [specific doc files]
- [ ] Implement: [specific changes]
- [ ] Verify: [test steps]
```

### Step 5: Implement
- Follow plan
- Update docs using token-efficient format
- Add file headers linking to docs

---

## 5. Documentation Maintenance

### **RULE: Update TABLEOFCONTENTS.md**

**When adding new documentation:**
1. Create doc file using token-efficient format
2. **Update TABLEOFCONTENTS.md** with new mapping
3. Update parent README.md if needed

**Example:**
```markdown
# Added new feature: Email notifications

Files created:
- documentation/backend/services/notifications.md

Updates required:
- ✅ Create notifications.md (token-efficient format)
- ✅ Add to TABLEOFCONTENTS.md: "Email notifications" → backend/services/notifications.md
- ✅ Update documentation/README.md → Backend section
```

### **RULE: Keep Docs Up-to-Date**
- **Before code changes:** Read relevant docs
- **After code changes:** Update docs immediately
- Use token-efficient format for all updates

---

## 6. Code Standards

### File Size Limits
- Max 300-400 lines per file
- Refactor if exceeding limit

### Mandatory File Headers
```typescript
/**
 * Component: User Authentication Service
 * Documentation: documentation/backend/services/auth.md
 */
```

### Link Accuracy
- Header path MUST point to existing doc file
- Create doc BEFORE implementing code
- Use relative paths from project root

---

## 7. Token Budget Management

### Critical Principle

**Preserve tokens for implementation, not context gathering.**

**Token Budget Allocation:**
- 20-30%: Reading relevant documentation (via TABLEOFCONTENTS.md)
- 70-80%: Implementation, problem-solving, code generation

**Anti-Patterns (Token wasteful):**
- ❌ Reading all documentation files
- ❌ Reading verbose examples when not needed
- ❌ Re-reading same docs multiple times
- ❌ Reading "Future Enhancements" sections

**Best Practices (Token efficient):**
- ✅ Use TABLEOFCONTENTS.md to target specific files
- ✅ Read only "Key Details" and "API/Interfaces" sections
- ✅ Skip examples unless implementing similar code
- ✅ Cache understanding in memory, don't re-read

---

## 8. Examples

### Example 1: Bug Fix

**Task:** "Plex authentication fails with 403 error"

**Process:**
1. Read TABLEOFCONTENTS.md → Find: backend/services/auth.md, integrations/plex.md
2. Read only those 2 files (focus on API endpoints, error handling)
3. Identify issue: Token refresh logic
4. Fix code
5. Update backend/services/auth.md (token-efficient format)

### Example 2: New Feature

**Task:** "Add email notifications for completed requests"

**Process:**
1. Read TABLEOFCONTENTS.md → Find: backend/services/scheduler.md, backend/services/jobs.md
2. Read those files for background job patterns
3. Create documentation/backend/services/notifications.md (token-efficient format)
4. Update TABLEOFCONTENTS.md: "Email notifications" → backend/services/notifications.md
5. Implement notification service
6. Add file header linking to notifications.md

---

## 9. Quality Checklist

Before completing any task:

- [ ] Used TABLEOFCONTENTS.md to find docs (not read all files)
- [ ] Read only necessary documentation
- [ ] Updated documentation in token-efficient format
- [ ] Updated TABLEOFCONTENTS.md if added new docs
- [ ] Added file headers to new code files
- [ ] No file exceeds 400 lines
- [ ] Documentation matches implementation

---

## 10. Summary

**Key Points:**
1. **Always start with TABLEOFCONTENTS.md** (navigation index)
2. **Read only what you need** (not all docs)
3. **Use token-efficient format** (bullets, tables, minimal prose)
4. **Preserve tokens for implementation** (not context gathering)
5. **Update docs immediately** (before/after code changes)
6. **Update TABLEOFCONTENTS.md** (when adding new docs)

**Result:**
- 68-72% token reduction in documentation
- Faster context gathering
- More tokens available for implementation
- Better AI performance on complex tasks

---

**Remember:** Documentation is for AI consumption. Token efficiency is critical. Always use TABLEOFCONTENTS.md.
