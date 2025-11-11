# CLAUDE.md

## Project Standards & Workflow

This document defines the architectural standards and workflow that must be followed for all development work in this project.

---

## 1. Cascading Context Documentation

### Structure

All projects must maintain a **cascading context** documentation system with the following structure:

```
documentation/
├── feature-area-1/
│   ├── sub-feature/
│   │   └── specific-component.md
│   └── overview.md
├── feature-area-2/
│   └── implementation.md
└── README.md
```

### Documentation Requirements

Every `.md` file in the cascading context must include:

- **Current State**: What is currently implemented
- **Design Architecture**: How it's built and why
- **Implementation Details**: Endpoints, contracts, interfaces, data flows
- **Tech Stack**: Libraries, frameworks, and tools used
- **Dependencies**: What this component relies on
- **Usage Examples**: How other parts of the system interact with this
- **Known Issues**: Current limitations or technical debt

### Example

```
documentation/
├── backend/
│   ├── api.md           # REST endpoints, contracts, authentication
│   ├── database.md      # Schema, migrations, ORM details
│   └── services/
│       └── payment.md   # Payment service architecture
├── frontend/
│   └── components.md    # Component library documentation
└── README.md            # Project overview and navigation guide
```

---

## 2. Strict Documentation Rules

### **RULE 1: Documentation is Always Up-to-Date**

- **BEFORE** making any code changes, read the relevant cascading context documentation
- **AFTER** making any code changes, update the relevant documentation to reflect the new state
- If the change is significant, update the "Current State" and "Design Architecture" sections
- Never leave documentation in a stale or outdated state

### **RULE 2: New Features Require New Documentation**

- When adding a new feature, component, or module:
  1. Create the appropriate folder structure in `documentation/`
  2. Create a `.md` file documenting the design before writing code
  3. Update the parent-level documentation to reference the new feature
  4. Keep the documentation updated as the feature evolves

### **RULE 3: Documentation Must Be Discoverable**

- The `documentation/README.md` must serve as a navigation guide
- Each folder should have clear naming that reflects its purpose
- Cross-reference related documentation files

---

## 3. Code Modularity Standards

### File Size Limits

- **No file should exceed 300-400 lines of code**
- If a file is growing too large, refactor into smaller, focused modules
- Each file should have a single, clear responsibility

### Mandatory File Headers

**Every code file must begin with a comment block** linking to its cascading context documentation:

#### For JavaScript/TypeScript:
```javascript
/**
 * Component: User Authentication Service
 * Documentation: documentation/backend/services/auth.md
 */
```

#### For Python:
```python
"""
Component: Data Processing Pipeline
Documentation: documentation/backend/data-pipeline.md
"""
```

#### For C#:
```csharp
/// <summary>
/// Component: GraphQL Query Resolver
/// Documentation: documentation/backend/api/graphql.md
/// </summary>
```

#### For HTML/CSS:
```html
<!-- 
  Component: Dashboard Layout
  Documentation: documentation/frontend/layouts/dashboard.md
-->
```

### **RULE 4: Link Code to Documentation**

- The documentation path in the header must be accurate and point to an existing file
- If documentation doesn't exist yet, create it before implementing the code
- Use relative paths from the project root

---

## 4. Implementation Strategy

### **Apply This Strategy to EVERY Request**

Even for simple changes, follow this structured approach:

#### Step 1: Find Cascading Context
- Identify which documentation files are relevant to the request
- Read those files thoroughly to understand current state and architecture
- If no documentation exists, note that it needs to be created

#### Step 2: Reiterate Understanding
- Write a brief paragraph (4-5 sentences maximum) summarizing:
  - What the user is asking for
  - What parts of the system will be affected
  - The expected outcome

#### Step 3: Ask Clarifying Questions (ONLY IF NEEDED)
- If the requirement is clear and straightforward, skip this step
- Only ask questions if there are genuine ambiguities that would affect implementation
- Keep questions focused and specific

#### Step 4: Create Detailed Implementation Plan
Before writing any code, create a comprehensive todolist that includes:

- [ ] Documentation to read
- [ ] Documentation to create/update
- [ ] Files to create/modify
- [ ] Code changes to implement (in order)
- [ ] Tests to write/update
- [ ] Verification steps

Be highly specific. Instead of "Update API", write "Add POST /api/users endpoint to documentation/backend/api.md and implement in src/api/routes/users.ts"

#### Step 5: Implement
- Follow the plan step-by-step
- Update documentation as you go
- Add file headers to all new files
- Maintain modularity throughout

---

## 5. Examples of the Strategy in Action

### Example 1: Simple Bug Fix

**User Request**: "The login button isn't working on mobile"

**Claude's Response**:
```
I need to investigate a mobile-specific issue with the login button. Based on the 
cascading context, this likely involves the authentication UI component documented 
in documentation/frontend/components/auth.md and possibly responsive styling 
documented in documentation/frontend/styles.md.

Implementation Plan:
- [ ] Read documentation/frontend/components/auth.md
- [ ] Read documentation/frontend/styles.md  
- [ ] Locate the login button component in src/components/Auth/LoginButton.tsx
- [ ] Identify the CSS/styling issue causing mobile failure
- [ ] Fix the styling in src/styles/auth.css
- [ ] Update documentation/frontend/components/auth.md with the fix details
- [ ] Test on mobile viewport

[Begin implementation...]
```

### Example 2: New Feature

**User Request**: "Add password reset functionality"

**Claude's Response**:
```
I need to implement a complete password reset flow. This will touch the backend 
authentication system (documentation/backend/services/auth.md), the API layer 
(documentation/backend/api.md), email services, and the frontend authentication 
UI (documentation/frontend/components/auth.md).

Clarifying Questions:
1. Should password reset links expire? If so, after how long?
2. Do you want email verification or security questions, or both?
3. Should there be rate limiting on reset requests?

[After answers...]

Implementation Plan:
- [ ] Read documentation/backend/services/auth.md
- [ ] Read documentation/backend/api.md
- [ ] Create documentation/backend/services/password-reset.md
- [ ] Create database migration for reset tokens
- [ ] Update documentation/backend/database.md with new schema
- [ ] Implement token generation in src/services/auth/passwordReset.ts
- [ ] Add POST /api/auth/request-reset endpoint
- [ ] Add POST /api/auth/reset-password endpoint
- [ ] Update documentation/backend/api.md with new endpoints
- [ ] Create email template for reset link
- [ ] Implement frontend reset request form
- [ ] Implement frontend password reset form
- [ ] Update documentation/frontend/components/auth.md
- [ ] Add file headers to all new files
- [ ] Test end-to-end flow

[Begin implementation...]
```

---

## 6. Quality Checklist

Before considering any task complete, verify:

- [ ] All relevant cascading context documentation has been read
- [ ] All modified/created documentation is up-to-date
- [ ] All new code files have proper headers linking to documentation
- [ ] No single file exceeds 300-400 lines of code
- [ ] The implementation matches the detailed plan
- [ ] Cross-references between documentation files are accurate

---

## 7. Benefits of This System

Following these standards ensures:

- **Knowledge Continuity**: Any engineer can understand any part of the system
- **Reduced Context Switching**: Documentation is always adjacent to code
- **Better Onboarding**: New team members can navigate the codebase easily
- **Fewer Bugs**: Thorough planning catches issues before implementation
- **Maintainable Codebase**: Modularity and documentation prevent technical debt

---

**Remember**: These standards apply to EVERY change, no matter how small. Consistency is what makes this system powerful.