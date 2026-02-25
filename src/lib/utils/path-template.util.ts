/**
 * Path Template Engine Utility
 * Documentation: documentation/backend/services/file-organizer.md
 *
 * Provides template variable substitution, validation, and preview generation
 * for audiobook file organization paths.
 */

/**
 * Template variables for path substitution
 */
export interface TemplateVariables {
  author: string;
  title: string;
  narrator?: string;
  asin?: string;
  year?: number;
  series?: string;
  seriesPart?: string;
}

/**
 * Template validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Supported template variable names
 */
const VALID_VARIABLES = ['author', 'title', 'narrator', 'asin', 'year', 'series', 'seriesPart'];

/**
 * Invalid file path characters (outside of template variables)
 */
const INVALID_PATH_CHARS = /[<>:"|?*]/;

/**
 * Placeholder characters for escaped braces during substitution.
 * Uses Unicode Private Use Area characters that won't appear in metadata
 * and won't be affected by path cleanup operations.
 */
const LBRACE_PLACEHOLDER = '\uE000';
const RBRACE_PLACEHOLDER = '\uE001';

/**
 * Sanitize a path component by removing invalid characters
 * Reuses logic from file-organizer.ts
 *
 * @param name - Path component to sanitize
 * @returns Sanitized path component
 */
function sanitizePath(name: string): string {
  return (
    name
      // Remove invalid filename characters
      .replace(/[<>:"/\\|?*]/g, '')
      // Remove leading/trailing dots and spaces
      .trim()
      .replace(/^\.+/, '')
      .replace(/\.+$/, '')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      // Limit length (255 chars max for most filesystems)
      .slice(0, 200)
  );
}

/**
 * Find valid template variable names within arbitrary content text.
 * Sorts by length descending to prevent substring false matches
 * (e.g., 'seriesPart' matched before 'series').
 * Uses word-boundary detection to avoid matching variable names
 * that are substrings of other words.
 */
function findVariablesInContent(content: string): string[] {
  const sortedVars = [...VALID_VARIABLES].sort((a, b) => b.length - a.length);
  const found: string[] = [];

  for (const varName of sortedVars) {
    const regex = new RegExp(`(?<![a-zA-Z0-9])${varName}(?![a-zA-Z0-9])`);
    if (regex.test(content)) {
      found.push(varName);
    }
  }

  return found;
}

/**
 * Resolve conditional blocks in the template.
 * A conditional block is {literal text varName more text} where the entire
 * content is rendered only if ALL variables inside have non-empty values.
 * If any variable is empty/missing, the entire block is removed.
 *
 * Simple variable references like {author} are left untouched for the
 * existing substitution logic to handle.
 *
 * Must run after escaped-brace replacement and before simple variable substitution.
 */
function resolveConditionalBlocks(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(/\{([^}]+)\}/g, (match, content: string) => {
    // If content is exactly a valid variable name, skip (leave for simple substitution)
    if (VALID_VARIABLES.includes(content)) {
      return match;
    }

    // Find variables in the content
    const foundVars = findVariablesInContent(content);

    // If no variables found, leave as-is (validation will catch it)
    if (foundVars.length === 0) {
      return match;
    }

    // Check if all found variables have non-empty values
    const allPresent = foundVars.every(varName => {
      const value = variables[varName as keyof TemplateVariables];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });

    if (!allPresent) {
      return '';
    }

    // Substitute variables within the content, output rest as literal text
    // Sort by length descending to prevent substring false matches
    let result = content;
    const sortedVars = [...foundVars].sort((a, b) => b.length - a.length);
    for (const varName of sortedVars) {
      const value = variables[varName as keyof TemplateVariables];
      const sanitizedValue = sanitizePath(String(value).trim());
      const regex = new RegExp(`(?<![a-zA-Z0-9])${varName}(?![a-zA-Z0-9])`, 'g');
      result = result.replace(regex, sanitizedValue);
    }

    return result;
  });
}

/**
 * Substitute template variables with actual values
 *
 * Supported variables: {author}, {title}, {narrator}, {asin}
 * - Handles missing/null variables gracefully (omits them)
 * - Applies path sanitization to all substituted values
 * - Removes multiple consecutive spaces after substitution
 *
 * @param template - Path template string (e.g., "{author}/{title}")
 * @param variables - Object containing variable values
 * @returns Substituted and sanitized path string
 *
 * @example
 * ```typescript
 * const result = substituteTemplate(
 *   "{author}/{title}",
 *   { author: "Brandon Sanderson", title: "Mistborn" }
 * );
 * // Returns: "Brandon Sanderson/Mistborn"
 * ```
 */
export function substituteTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  // Replace escaped braces with placeholders before any processing,
  // so they survive the variable substitution and path cleanup steps
  result = result.replace(/\\\{/g, LBRACE_PLACEHOLDER).replace(/\\\}/g, RBRACE_PLACEHOLDER);

  // Resolve conditional blocks before simple variable substitution
  result = resolveConditionalBlocks(result, variables);

  // Substitute each variable
  for (const key of VALID_VARIABLES) {
    const value = variables[key as keyof TemplateVariables];
    const regex = new RegExp(`\\{${key}\\}`, 'g');

    if (value !== undefined && value !== null) {
      // Convert value to string and sanitize
      const stringValue = String(value);
      if (stringValue.trim()) {
        const sanitizedValue = sanitizePath(stringValue.trim());
        result = result.replace(regex, sanitizedValue);
      } else {
        // Remove the variable placeholder if value is empty
        result = result.replace(regex, '');
      }
    } else {
      // Remove the variable placeholder if value is missing
      result = result.replace(regex, '');
    }
  }

  // Clean up the result
  result = result
    // Remove multiple consecutive slashes (forward or backward)
    .replace(/[\/\\]+/g, '/')
    // Remove multiple consecutive spaces
    .replace(/\s+/g, ' ')
    // Remove leading/trailing slashes and spaces from each path component
    .split('/')
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join('/');

  // Resolve escaped brace placeholders as the final step,
  // after all variable substitution and path cleanup is complete
  result = result.replace(new RegExp(LBRACE_PLACEHOLDER, 'g'), '{');
  result = result.replace(new RegExp(RBRACE_PLACEHOLDER, 'g'), '}');

  return result;
}

/**
 * Validate a path template string
 *
 * Checks for:
 * - Valid variable names only (rejects unknown variables)
 * - No invalid file path characters outside of variables
 * - Non-empty template
 * - Relative paths only (no absolute paths)
 *
 * @param template - Path template string to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * const result = validateTemplate("{author}/{title}");
 * // Returns: { valid: true }
 *
 * const invalid = validateTemplate("{invalid}/{title}");
 * // Returns: { valid: false, error: "Unknown variable: {invalid}" }
 * ```
 */
export function validateTemplate(template: string): ValidationResult {
  // Check for empty template
  if (!template || template.trim().length === 0) {
    return {
      valid: false,
      error: 'Template cannot be empty'
    };
  }

  // Check for absolute paths (backslash followed by { or } is a brace escape, not a path)
  if (template.startsWith('/') || /^\\(?![{}])/.test(template) || /^[a-zA-Z]:/.test(template)) {
    return {
      valid: false,
      error: 'Template must be a relative path (no absolute paths like "/" or "C:\\")'
    };
  }

  // Strip escaped braces (\{ and \}) before parsing so they don't interfere
  // with variable extraction or character validation
  const templateWithoutEscapedBraces = template.replace(/\\[{}]/g, '');

  // Extract all variables from the stripped template
  const variableMatches = templateWithoutEscapedBraces.match(/\{[^}]+\}/g);

  if (variableMatches) {
    for (const match of variableMatches) {
      const content = match.slice(1, -1); // Remove { and }

      // Simple variable — exact match to a valid variable name
      if (VALID_VARIABLES.includes(content)) {
        continue;
      }

      // Conditional block — must contain at least one valid variable
      const foundVars = findVariablesInContent(content);
      if (foundVars.length === 0) {
        return {
          valid: false,
          error: `No valid variable found in conditional block: {${content}}. Valid variables are: ${VALID_VARIABLES.map(v => `{${v}}`).join(', ')}`
        };
      }

      // Check literal text inside conditional block for invalid path chars
      let literalText = content;
      const sortedVars = [...foundVars].sort((a, b) => b.length - a.length);
      for (const varName of sortedVars) {
        literalText = literalText.replace(
          new RegExp(`(?<![a-zA-Z0-9])${varName}(?![a-zA-Z0-9])`, 'g'),
          ''
        );
      }
      const invalidCharsInBlock = literalText.match(INVALID_PATH_CHARS);
      if (invalidCharsInBlock) {
        return {
          valid: false,
          error: `Invalid characters found: ${[...new Set(invalidCharsInBlock)].join(', ')}. These characters are not allowed in path templates.`
        };
      }
    }
  }

  // Remove valid variables and conditional blocks to check remaining text for invalid chars
  let templateWithoutVars = templateWithoutEscapedBraces;
  if (variableMatches) {
    for (const match of variableMatches) {
      templateWithoutVars = templateWithoutVars.replace(match, '');
    }
  }

  // Check for invalid characters outside of variables
  const invalidChars = templateWithoutVars.match(INVALID_PATH_CHARS);
  if (invalidChars) {
    return {
      valid: false,
      error: `Invalid characters found: ${[...new Set(invalidChars)].join(', ')}. These characters are not allowed in path templates.`
    };
  }

  // Check for backslashes that are not brace escapes (Windows-style paths)
  // We check the original template: any backslash NOT followed by { or } is invalid
  if (/\\(?![{}])/.test(template)) {
    return {
      valid: false,
      error: 'Use forward slashes (/) for path separators, not backslashes (\\)'
    };
  }

  return { valid: true };
}

/**
 * Generate mock preview paths using sample audiobook data
 *
 * Creates 2-3 example paths to demonstrate how the template will look
 * with real audiobook metadata.
 *
 * @param template - Path template string
 * @returns Array of example paths (2-3 examples)
 *
 * @example
 * ```typescript
 * const previews = generateMockPreviews("{author}/{title}");
 * // Returns:
 * // [
 * //   "Brandon Sanderson/Mistborn The Final Empire",
 * //   "Douglas Adams/The Hitchhiker's Guide to the Galaxy",
 * //   "Andy Weir/Project Hail Mary"
 * // ]
 * ```
 */
export function generateMockPreviews(template: string): string[] {
  const mockData: TemplateVariables[] = [
    {
      author: 'Brandon Sanderson',
      title: 'Mistborn: The Final Empire',
      narrator: 'Michael Kramer',
      asin: 'B002UZMLXM',
      year: 2006,
      series: 'The Mistborn Saga',
      seriesPart: '1'
    },
    {
      author: 'Douglas Adams',
      title: "The Hitchhiker's Guide to the Galaxy",
      narrator: 'Stephen Fry',
      asin: 'B0009JKV9W',
      year: 2005,
      series: "Hitchhiker's Guide",
      seriesPart: '1'
    },
    {
      author: 'Andy Weir',
      title: 'Project Hail Mary',
      // No narrator for this example
      asin: 'B08G9PRS1K',
      year: 2021
      // No series data - to test empty handling
    }
  ];

  return mockData.map(variables => substituteTemplate(template, variables));
}

/**
 * Get list of valid template variable names
 *
 * @returns Array of valid variable names
 */
export function getValidVariables(): string[] {
  return [...VALID_VARIABLES];
}

/**
 * Validate a filename template string
 *
 * Similar to validateTemplate but for filenames (not paths):
 * - Disallows forward slashes (no directory separators in filenames)
 * - Does not require relative path structure
 * - Must contain at least one variable
 *
 * @param template - Filename template string to validate
 * @returns Validation result with error message if invalid
 */
export function validateFilenameTemplate(template: string): ValidationResult {
  if (!template || template.trim().length === 0) {
    return {
      valid: false,
      error: 'Filename template cannot be empty',
    };
  }

  // Disallow forward slashes — filenames cannot contain directory separators
  if (template.includes('/')) {
    return {
      valid: false,
      error: 'Filename template cannot contain "/" (directory separators). Use the organization template for directory structure.',
    };
  }

  // Disallow backslashes that aren't brace escapes
  if (/\\(?![{}])/.test(template)) {
    return {
      valid: false,
      error: 'Filename template cannot contain backslashes. Use the organization template for directory structure.',
    };
  }

  // Strip escaped braces before parsing
  const templateWithoutEscapedBraces = template.replace(/\\[{}]/g, '');

  // Extract all variables from the stripped template
  const variableMatches = templateWithoutEscapedBraces.match(/\{[^}]+\}/g);

  if (variableMatches) {
    for (const match of variableMatches) {
      const content = match.slice(1, -1);

      // Simple variable
      if (VALID_VARIABLES.includes(content)) {
        continue;
      }

      // Conditional block — must contain at least one valid variable
      const foundVars = findVariablesInContent(content);
      if (foundVars.length === 0) {
        return {
          valid: false,
          error: `No valid variable found in: {${content}}. Valid variables are: ${VALID_VARIABLES.map(v => `{${v}}`).join(', ')}`,
        };
      }

      // Check literal text inside conditional block for invalid filename chars
      let literalText = content;
      const sortedVars = [...foundVars].sort((a, b) => b.length - a.length);
      for (const varName of sortedVars) {
        literalText = literalText.replace(
          new RegExp(`(?<![a-zA-Z0-9])${varName}(?![a-zA-Z0-9])`, 'g'),
          ''
        );
      }
      const invalidCharsInBlock = literalText.match(INVALID_PATH_CHARS);
      if (invalidCharsInBlock) {
        return {
          valid: false,
          error: `Invalid characters found: ${[...new Set(invalidCharsInBlock)].join(', ')}. These characters are not allowed in filenames.`,
        };
      }
    }
  }

  // Remove valid variables and conditional blocks to check remaining text
  let templateWithoutVars = templateWithoutEscapedBraces;
  if (variableMatches) {
    for (const match of variableMatches) {
      templateWithoutVars = templateWithoutVars.replace(match, '');
    }
  }

  // Check for invalid characters outside of variables
  const invalidChars = templateWithoutVars.match(INVALID_PATH_CHARS);
  if (invalidChars) {
    return {
      valid: false,
      error: `Invalid characters found: ${[...new Set(invalidChars)].join(', ')}. These characters are not allowed in filenames.`,
    };
  }

  return { valid: true };
}

/**
 * Generate mock filename previews using sample audiobook data
 *
 * Creates example filenames with extensions to demonstrate how the template will look.
 * Shows both single-file and multi-file (with index) examples.
 *
 * @param template - Filename template string
 * @returns Object with single and multi-file preview arrays
 */
export function generateMockFilenamePreviews(template: string): {
  single: string[];
  multi: string[];
} {
  const mockData: TemplateVariables[] = [
    {
      author: 'Brandon Sanderson',
      title: 'Mistborn: The Final Empire',
      narrator: 'Michael Kramer',
      asin: 'B002UZMLXM',
      year: 2006,
      series: 'The Mistborn Saga',
      seriesPart: '1',
    },
    {
      author: 'Douglas Adams',
      title: "The Hitchhiker's Guide to the Galaxy",
      narrator: 'Stephen Fry',
      asin: 'B0009JKV9W',
      year: 2005,
      series: "Hitchhiker's Guide",
      seriesPart: '1',
    },
  ];

  const single = mockData.map((variables) => {
    const name = substituteTemplate(template, variables);
    return `${name}.m4b`;
  });

  // Show multi-file example with first mock data only
  const multiName = substituteTemplate(template, mockData[0]);
  const multi = [
    `${multiName} - 1.mp3`,
    `${multiName} - 2.mp3`,
    `${multiName} - 3.mp3`,
  ];

  return { single, multi };
}

/**
 * Build a renamed filename from a template, metadata variables, and original extension.
 * Optionally appends a 1-based index for multi-file scenarios.
 *
 * @param template - Filename template string (e.g., "{title}")
 * @param variables - Template variables with metadata values
 * @param originalExtension - File extension including dot (e.g., ".m4b")
 * @param index - Optional 1-based index for multi-file scenarios
 * @returns Sanitized filename with extension
 */
export function buildRenamedFilename(
  template: string,
  variables: TemplateVariables,
  originalExtension: string,
  index?: number,
): string {
  let baseName = substituteTemplate(template, variables);

  // substituteTemplate cleans up slashes for paths — but since this is a filename,
  // remove any residual slashes that conditional blocks might have introduced
  baseName = baseName.replace(/[/\\]/g, '');

  // Sanitize again for filename safety
  baseName = baseName
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 200);

  if (index !== undefined) {
    baseName = `${baseName} - ${index}`;
  }

  // Ensure extension starts with a dot
  const ext = originalExtension.startsWith('.') ? originalExtension : `.${originalExtension}`;

  return `${baseName}${ext}`;
}
