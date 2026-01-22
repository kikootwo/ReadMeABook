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

  // Check for absolute paths
  if (template.startsWith('/') || template.startsWith('\\') || /^[a-zA-Z]:/.test(template)) {
    return {
      valid: false,
      error: 'Template must be a relative path (no absolute paths like "/" or "C:\\")'
    };
  }

  // Extract all variables from template
  const variableMatches = template.match(/\{[^}]+\}/g);

  if (variableMatches) {
    for (const match of variableMatches) {
      const varName = match.slice(1, -1); // Remove { and }

      if (!VALID_VARIABLES.includes(varName)) {
        return {
          valid: false,
          error: `Unknown variable: {${varName}}. Valid variables are: ${VALID_VARIABLES.map(v => `{${v}}`).join(', ')}`
        };
      }
    }
  }

  // Remove valid variables temporarily to check for invalid characters
  let templateWithoutVars = template;
  for (const varName of VALID_VARIABLES) {
    templateWithoutVars = templateWithoutVars.replace(new RegExp(`\\{${varName}\\}`, 'g'), '');
  }

  // Check for invalid characters outside of variables
  const invalidChars = templateWithoutVars.match(INVALID_PATH_CHARS);
  if (invalidChars) {
    return {
      valid: false,
      error: `Invalid characters found: ${[...new Set(invalidChars)].join(', ')}. These characters are not allowed in path templates.`
    };
  }

  // Check for backslashes (Windows-style paths)
  if (templateWithoutVars.includes('\\')) {
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
