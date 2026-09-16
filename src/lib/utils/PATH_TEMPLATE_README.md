# Path Template Engine Utility

Location: `src/lib/utils/path-template.util.ts`

## Overview

Provides template variable substitution, validation, and preview generation for audiobook file organization paths.

## Features

1. **Template Variable Substitution** - Replace variables with actual values
2. **Template Validation** - Validate template syntax and characters
3. **Mock Preview Generation** - Generate example paths with sample data
4. **Path Sanitization** - Automatic removal of invalid file path characters

## Supported Variables

- `{author}` - Full audiobook author string
- `{primaryAuthor}` - First author in the author list
- `{title}` - Audiobook title
- `{narrator}` - Audiobook narrator (optional)
- `{asin}` - Amazon ASIN identifier (optional)
- `{year}` - Release year (optional)
- `{series}` - Series name (optional)
- `{seriesPart}` - Series part or position (optional)

### Primary Author

`{primaryAuthor}` is derived from `{author}` by taking the first entry in a comma-separated author list.
`{author}` remains unchanged and continues to contain the full author string.

````markdown
```typescript
const result = substituteTemplate(
  '{primaryAuthor}/{title}',
  {
    author: 'Victoria Aveyard, Birgit Schmitz - Übersetzer',
    title: 'Wütender Sturm'
  }
);

// Returns: "Victoria Aveyard/Wütender Sturm"

## API Reference

### `substituteTemplate(template: string, variables: TemplateVariables): string`

Substitute template variables with actual values.

**Features:**
- Handles missing/null variables gracefully (omits them)
- Applies path sanitization to all substituted values
- Removes multiple consecutive spaces
- Normalizes path separators (converts backslashes to forward slashes)

**Example:**
```typescript
const result = substituteTemplate(
  '{author}/{title}',
  { author: 'Brandon Sanderson', title: 'Mistborn' }
);
// Returns: "Brandon Sanderson/Mistborn"
```

### `validateTemplate(template: string): ValidationResult`

Validate a path template string.

**Checks for:**
- Valid variable names only (rejects unknown variables)
- No invalid file path characters outside of variables (`:`, `|`, `<`, `>`, `*`, `?`, `"`)
- Non-empty template
- Relative paths only (no absolute paths)

**Returns:**
```typescript
interface ValidationResult {
  valid: boolean;
  error?: string; // Helpful error message if invalid
}
```

**Example:**
```typescript
const result = validateTemplate('{author}/{title}');
// Returns: { valid: true }

const invalid = validateTemplate('{invalid}/{title}');
// Returns: { valid: false, error: "Unknown variable: {invalid}. Valid variables are: {author}, {title}, {narrator}, {asin}" }
```

### `generateMockPreviews(template: string): string[]`

Generate 2-3 example paths using mock audiobook data.

**Mock Examples:**
1. Brandon Sanderson / Mistborn: The Final Empire / Michael Kramer / B002UZMLXM
2. Douglas Adams / The Hitchhiker's Guide to the Galaxy / Stephen Fry / B0009JKV9W
3. Andy Weir / Project Hail Mary / (no narrator) / B08G9PRS1K

**Example:**
```typescript
const previews = generateMockPreviews('{author}/{title}');
// Returns:
// [
//   "Brandon Sanderson/Mistborn The Final Empire",
//   "Douglas Adams/The Hitchhiker's Guide to the Galaxy",
//   "Andy Weir/Project Hail Mary"
// ]
```

### `getValidVariables(): string[]`

Get list of valid template variable names.

**Example:**
```typescript
const variables = getValidVariables();
// Returns: ['author', 'primaryAuthor', 'title', 'narrator', 'asin', 'year', 'series', 'seriesPart']
```

## Usage Examples

### Basic Template
```typescript
import { substituteTemplate } from '@/lib/utils/path-template.util';

const result = substituteTemplate(
  '{author}/{title}',
  {
    author: 'Brandon Sanderson',
    title: 'Mistborn: The Final Empire'
  }
);
// Result: "Brandon Sanderson/Mistborn The Final Empire"
```

### Template with Optional Variables
```typescript
// With narrator
const withNarrator = substituteTemplate(
  '{author}/{title}/{narrator}',
  {
    author: 'Douglas Adams',
    title: "The Hitchhiker's Guide to the Galaxy",
    narrator: 'Stephen Fry'
  }
);
// Result: "Douglas Adams/The Hitchhiker's Guide to the Galaxy/Stephen Fry"

// Without narrator (gracefully omitted)
const withoutNarrator = substituteTemplate(
  '{author}/{title}/{narrator}',
  {
    author: 'Andy Weir',
    title: 'Project Hail Mary'
    // No narrator
  }
);
// Result: "Andy Weir/Project Hail Mary"
```

### Template Validation
```typescript
import { validateTemplate } from '@/lib/utils/path-template.util';

// Valid templates
validateTemplate('{author}/{title}');
// { valid: true }

validateTemplate('Audiobooks/{author}/{title}');
// { valid: true }

// Invalid templates
validateTemplate('{author}/{invalid}');
// { valid: false, error: "Unknown variable: {invalid}..." }

validateTemplate('/absolute/path/{author}');
// { valid: false, error: "Template must be a relative path..." }

validateTemplate('{author}|{title}');
// { valid: false, error: "Invalid characters found: |..." }
```

### Generate Previews
```typescript
import { generateMockPreviews } from '@/lib/utils/path-template.util';

const previews = generateMockPreviews('{author}/{title}/{narrator}');
// Returns 3 examples, including one without a narrator

previews.forEach(preview => console.log(preview));
// Brandon Sanderson/Mistborn The Final Empire/Michael Kramer
// Douglas Adams/The Hitchhiker's Guide to the Galaxy/Stephen Fry
// Andy Weir/Project Hail Mary
```

### Automatic Sanitization
```typescript
const result = substituteTemplate(
  '{author}/{title}',
  {
    author: 'Author: <Test>',
    title: 'Title|With*Invalid?Chars"'
  }
);
// Result: "Author Test/TitleWithInvalidChars"
// Invalid characters automatically removed
```

## Path Sanitization Rules

The utility automatically sanitizes all substituted values:

1. **Removes invalid characters:** `<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*`
2. **Trims dots and spaces** from beginning and end
3. **Collapses multiple spaces** into single space
4. **Limits length** to 200 characters per component
5. **Normalizes path separators** (converts `\` to `/`)

## Integration Points

### File Organizer Service
The path template utility is used by `file-organizer.ts` to generate organized directory structures for downloaded audiobook files.

### Test Paths API
The utility is also used by the `/api/test-paths` endpoint to allow users to preview how their custom path templates will look before applying them.

## Testing

Comprehensive test suite located at: `tests/lib/utils/path-template.util.test.ts`

Run tests:
```bash
npm test -- path-template
```

## Type Definitions

```typescript
interface TemplateVariables {
  author: string;
  title: string;
  narrator?: string;
  asin?: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}
```
