/**
 * Tests for Path Template Engine Utility
 */

import { describe, it, expect } from 'vitest';
import {
  substituteTemplate,
  validateTemplate,
  generateMockPreviews,
  getValidVariables,
  validateFilenameTemplate,
  generateMockFilenamePreviews,
  buildRenamedFilename,
  type TemplateVariables
} from '@/lib/utils/path-template.util';

describe('substituteTemplate', () => {
  it('should substitute all valid variables', () => {
    const template = '{author}/{title}/{narrator}/{asin}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn',
      narrator: 'Michael Kramer',
      asin: 'B002UZMLXM'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/Mistborn/Michael Kramer/B002UZMLXM');
  });

  it('should handle missing optional variables gracefully', () => {
    const template = '{author}/{title}/{narrator}';
    const variables: TemplateVariables = {
      author: 'Andy Weir',
      title: 'Project Hail Mary'
      // narrator is missing
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Andy Weir/Project Hail Mary');
  });

  it('should sanitize invalid characters in values', () => {
    const template = '{author}/{title}';
    const variables: TemplateVariables = {
      author: 'Author: <Test>',
      title: 'Title|With*Invalid?Chars"'
    };

    const result = substituteTemplate(template, variables);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain(':');
    expect(result).not.toContain('|');
    expect(result).not.toContain('*');
    expect(result).not.toContain('?');
    expect(result).not.toContain('"');
  });

  it('should remove multiple consecutive spaces', () => {
    const template = '{author}/{title}';
    const variables: TemplateVariables = {
      author: 'Author   With   Spaces',
      title: 'Title  With  Spaces'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author With Spaces/Title With Spaces');
  });

  it('should handle empty string values', () => {
    const template = '{author}/{title}/{narrator}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title',
      narrator: ''
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/Title');
  });

  it('should remove leading and trailing slashes', () => {
    const template = '/{author}/{title}/';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/Title');
  });

  it('should collapse multiple consecutive slashes', () => {
    const template = '{author}//{title}///{narrator}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title',
      narrator: 'Narrator'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/Title/Narrator');
  });

  it('should resolve escaped braces to literal brace characters', () => {
    const template = '{author}/\\{{narrator}\\}/{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title',
      narrator: 'Narrator'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/{Narrator}/Title');
  });

  it('should trim dots from path components', () => {
    const template = '{author}/{title}';
    const variables: TemplateVariables = {
      author: '...Author...',
      title: '..Title..'
    };

    const result = substituteTemplate(template, variables);
    expect(result.startsWith('.')).toBe(false);
    expect(result.endsWith('.')).toBe(false);
  });

  it('should limit path component length', () => {
    const template = '{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'A'.repeat(300) // Very long title
    };

    const result = substituteTemplate(template, variables);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('should handle static text in template', () => {
    const template = 'Audiobooks/{author}/Books/{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Audiobooks/Author/Books/Title');
  });

  it('should resolve escaped left brace only', () => {
    const template = '{author}/\\{prefix {title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/{prefix Title');
  });

  it('should resolve escaped right brace only', () => {
    const template = '{author}/{title} suffix\\}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/Title suffix}');
  });

  it('should resolve multiple escaped brace pairs', () => {
    const template = '\\{{author}\\}/\\{{title}\\}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('{Author}/{Title}');
  });

  it('should handle escaped braces with missing optional variable', () => {
    const template = '{author}/\\{{narrator}\\}/{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
      // narrator is missing
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/{}/Title');
  });

  it('should handle escaped braces adjacent to path separators', () => {
    const template = '{author}/\\{{narrator}\\}/{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title',
      narrator: 'Michael Kramer'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/{Michael Kramer}/Title');
  });

  it('should handle escaped braces around static text', () => {
    const template = '{author}/\\{narrated\\}/{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/{narrated}/Title');
  });

  // Conditional block tests
  it('should render conditional block when variable has a value', () => {
    const template = '{author}/{Book seriesPart - }{title}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn',
      seriesPart: '1'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/Book 1 - Mistborn');
  });

  it('should remove conditional block when variable is missing', () => {
    const template = '{author}/{Book seriesPart - }{title}';
    const variables: TemplateVariables = {
      author: 'Andy Weir',
      title: 'Project Hail Mary'
      // seriesPart is missing
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Andy Weir/Project Hail Mary');
  });

  it('should handle conditional block with path separator', () => {
    const template = '{author}/{series/Book seriesPart - }{title}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn',
      series: 'The Mistborn Saga',
      seriesPart: '1'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/The Mistborn Saga/Book 1 - Mistborn');
  });

  it('should render conditional block when all variables present', () => {
    const template = '{author}/{series Book seriesPart}/{title}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn',
      series: 'The Mistborn Saga',
      seriesPart: '1'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/The Mistborn Saga Book 1/Mistborn');
  });

  it('should remove conditional block when any variable is missing', () => {
    const template = '{author}/{series Book seriesPart}/{title}';
    const variables: TemplateVariables = {
      author: 'Andy Weir',
      title: 'Project Hail Mary',
      series: 'Some Series'
      // seriesPart is missing
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Andy Weir/Project Hail Mary');
  });

  it('should handle adjacent conditional blocks', () => {
    const template = '{author}/{series - }{Book seriesPart - }{title}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn',
      series: 'The Mistborn Saga',
      seriesPart: '1'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/The Mistborn Saga - Book 1 - Mistborn');
  });

  it('should handle conditional block next to simple variable', () => {
    const template = '{author}/{series - }{title}';
    const variables: TemplateVariables = {
      author: 'Andy Weir',
      title: 'Project Hail Mary'
      // series is missing
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Andy Weir/Project Hail Mary');
  });

  it('should handle conditional block with year variable', () => {
    const template = '{author}/{title} {(year)}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn',
      year: 2006
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/Mistborn (2006)');
  });

  it('should remove year conditional block when year is missing', () => {
    const template = '{author}/{title} {(year)}';
    const variables: TemplateVariables = {
      author: 'Andy Weir',
      title: 'Project Hail Mary'
      // year is missing
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Andy Weir/Project Hail Mary');
  });

  it('should still handle simple variables correctly (regression)', () => {
    const template = '{author}/{title}';
    const variables: TemplateVariables = {
      author: 'Brandon Sanderson',
      title: 'Mistborn'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Brandon Sanderson/Mistborn');
  });

  it('should remove conditional block when variable is empty string', () => {
    const template = '{author}/{Book seriesPart - }{title}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title',
      seriesPart: ''
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/Title');
  });
});

describe('validateTemplate', () => {
  it('should accept valid templates', () => {
    const templates = [
      '{author}/{title}',
      '{author}/{title}/{narrator}',
      'Audiobooks/{author}/{title}',
      '{author} - {title}',
      '{author}/{title}/{asin}'
    ];

    templates.forEach(template => {
      const result = validateTemplate(template);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  it('should reject empty templates', () => {
    const result = validateTemplate('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('should reject whitespace-only templates', () => {
    const result = validateTemplate('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('should reject unknown variables', () => {
    const result = validateTemplate('{author}/{invalid}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No valid variable found in conditional block');
    expect(result.error).toContain('{invalid}');
  });

  it('should reject absolute paths with forward slash', () => {
    const result = validateTemplate('/absolute/path/{author}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('absolute');
  });

  it('should reject absolute paths with drive letter', () => {
    const result = validateTemplate('C:\\Users\\{author}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('absolute');
  });

  it('should reject invalid characters outside variables', () => {
    const invalidChars = ['<', '>', ':', '"', '|', '?', '*'];

    invalidChars.forEach(char => {
      const result = validateTemplate(`{author}${char}{title}`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid characters');
    });
  });

  it('should reject backslashes that are not brace escapes', () => {
    const result = validateTemplate('{author}\\n{title}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forward slashes');
  });

  it('should accept templates without variables', () => {
    const result = validateTemplate('Audiobooks/Default');
    expect(result.valid).toBe(true);
  });

  it('should provide helpful error messages for multiple unknown variables', () => {
    const result = validateTemplate('{author}/{invalid1}/{invalid2}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No valid variable found in conditional block');
  });

  it('should list valid variables in error message', () => {
    const result = validateTemplate('{invalid}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No valid variable found in conditional block');
    expect(result.error).toContain('{author}');
    expect(result.error).toContain('{title}');
    expect(result.error).toContain('{narrator}');
    expect(result.error).toContain('{asin}');
  });

  it('should accept escaped braces around a variable', () => {
    const result = validateTemplate('{author}/\\{{narrator}\\}/{title}');
    expect(result.valid).toBe(true);
  });

  it('should accept escaped braces around static text', () => {
    const result = validateTemplate('{author}/\\{custom\\}/{title}');
    expect(result.valid).toBe(true);
  });

  it('should accept escaped left brace only', () => {
    const result = validateTemplate('{author}/\\{prefix {title}');
    expect(result.valid).toBe(true);
  });

  it('should accept escaped right brace only', () => {
    const result = validateTemplate('{author}/{title} suffix\\}');
    expect(result.valid).toBe(true);
  });

  it('should accept multiple escaped brace pairs', () => {
    const result = validateTemplate('\\{{author}\\}/\\{{title}\\}');
    expect(result.valid).toBe(true);
  });

  it('should accept backslash before brace but reject backslash before other characters', () => {
    const result = validateTemplate('{author}\\n/\\{{title}\\}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forward slashes');
  });

  it('should accept a template that is only escaped braces', () => {
    const result = validateTemplate('\\{\\}');
    expect(result.valid).toBe(true);
  });

  // Conditional block validation tests
  it('should accept conditional blocks with valid variables', () => {
    const result = validateTemplate('{author}/{Book seriesPart - }{title}');
    expect(result.valid).toBe(true);
  });

  it('should accept conditional blocks with multiple variables', () => {
    const result = validateTemplate('{author}/{series Book seriesPart}/{title}');
    expect(result.valid).toBe(true);
  });

  it('should reject conditional blocks with no valid variables', () => {
    const result = validateTemplate('{author}/{random text}/{title}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No valid variable found in conditional block');
  });

  it('should reject conditional blocks with invalid path chars inside', () => {
    const result = validateTemplate('{author}/{series: part}/{title}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid characters');
  });

  it('should accept mix of simple variables and conditional blocks', () => {
    const result = validateTemplate('{author}/{series - }{Book seriesPart - }{title} {(year)}');
    expect(result.valid).toBe(true);
  });
});

describe('generateMockPreviews', () => {
  it('should generate 3 preview examples', () => {
    const template = '{author}/{title}';
    const previews = generateMockPreviews(template);

    expect(previews).toHaveLength(3);
  });

  it('should apply template correctly to all examples', () => {
    const template = '{author}/{title}';
    const previews = generateMockPreviews(template);

    previews.forEach(preview => {
      expect(preview).toContain('/');
      expect(preview.length).toBeGreaterThan(0);
    });
  });

  it('should include example without narrator', () => {
    const template = '{author}/{title}/{narrator}';
    const previews = generateMockPreviews(template);

    // At least one preview should not have a third path component (no narrator)
    const withoutNarrator = previews.some(preview => {
      const parts = preview.split('/');
      return parts.length === 2; // Only author and title
    });

    expect(withoutNarrator).toBe(true);
  });

  it('should handle templates with only static text', () => {
    const template = 'Static/Path/Example';
    const previews = generateMockPreviews(template);

    previews.forEach(preview => {
      expect(preview).toBe('Static/Path/Example');
    });
  });

  it('should sanitize mock data values', () => {
    const template = '{author}/{title}';
    const previews = generateMockPreviews(template);

    previews.forEach(preview => {
      expect(preview).not.toContain('<');
      expect(preview).not.toContain('>');
      expect(preview).not.toContain(':');
    });
  });

  it('should include ASIN in examples when requested', () => {
    const template = '{author}/{title}/{asin}';
    const previews = generateMockPreviews(template);

    // All examples should have ASIN (mock data includes it)
    previews.forEach(preview => {
      const parts = preview.split('/');
      expect(parts.length).toBe(3);
      expect(parts[2]).toMatch(/^B[A-Z0-9]+$/); // ASIN format
    });
  });

  it('should handle complex templates with static text', () => {
    const template = 'Library/{author}/Books/{title} - {asin}';
    const previews = generateMockPreviews(template);

    previews.forEach(preview => {
      expect(preview).toContain('Library/');
      expect(preview).toContain('/Books/');
      expect(preview).toContain(' - B');
    });
  });

  it('should resolve escaped braces in previews', () => {
    const template = '{author}/\\{{narrator}\\}/{title}';
    const previews = generateMockPreviews(template);

    // First two mock entries have narrators
    expect(previews[0]).toContain('{Michael Kramer}');
    expect(previews[1]).toContain('{Stephen Fry}');
    // Third mock entry has no narrator - escaped braces remain empty
    expect(previews[2]).toContain('{}');
  });
});

describe('getValidVariables', () => {
  it('should return all valid variable names', () => {
    const variables = getValidVariables();

    expect(variables).toContain('author');
    expect(variables).toContain('title');
    expect(variables).toContain('narrator');
    expect(variables).toContain('asin');
    expect(variables).toContain('year');
    expect(variables).toContain('series');
    expect(variables).toContain('seriesPart');
    expect(variables).toHaveLength(7);
  });

  it('should return a new array each time (not mutate original)', () => {
    const vars1 = getValidVariables();
    const vars2 = getValidVariables();

    expect(vars1).toEqual(vars2);
    expect(vars1).not.toBe(vars2); // Different array instances
  });
});

describe('validateFilenameTemplate', () => {
  it('should accept valid filename templates', () => {
    const templates = [
      '{title}',
      '{author} - {title}',
      '{title} ({year})',
      '{author} - {title} {(year)}',
    ];

    templates.forEach(template => {
      const result = validateFilenameTemplate(template);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  it('should reject empty templates', () => {
    const result = validateFilenameTemplate('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('should reject templates containing forward slashes', () => {
    const result = validateFilenameTemplate('{author}/{title}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('/');
    expect(result.error).toContain('directory separator');
  });

  it('should reject templates containing backslashes (not brace escapes)', () => {
    const result = validateFilenameTemplate('{author}\\n{title}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('backslash');
  });

  it('should accept escaped braces in filename templates', () => {
    const result = validateFilenameTemplate('\\{{title}\\}');
    expect(result.valid).toBe(true);
  });

  it('should reject unknown variables', () => {
    const result = validateFilenameTemplate('{invalid}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No valid variable found');
  });

  it('should reject invalid characters', () => {
    const invalidChars = ['<', '>', ':', '"', '|', '?', '*'];

    invalidChars.forEach(char => {
      const result = validateFilenameTemplate(`{title}${char}extra`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid characters');
    });
  });

  it('should accept conditional blocks in filename templates', () => {
    const result = validateFilenameTemplate('{title} {(year)}');
    expect(result.valid).toBe(true);
  });

  it('should accept templates with only static text', () => {
    const result = validateFilenameTemplate('audiobook');
    expect(result.valid).toBe(true);
  });
});

describe('generateMockFilenamePreviews', () => {
  it('should return single and multi-file previews', () => {
    const result = generateMockFilenamePreviews('{title}');

    expect(result.single).toBeDefined();
    expect(result.multi).toBeDefined();
    expect(result.single.length).toBe(2);
    expect(result.multi.length).toBe(3);
  });

  it('should include file extensions in single previews', () => {
    const result = generateMockFilenamePreviews('{title}');

    result.single.forEach(preview => {
      expect(preview).toMatch(/\.m4b$/);
    });
  });

  it('should include index and extensions in multi-file previews', () => {
    const result = generateMockFilenamePreviews('{title}');

    expect(result.multi[0]).toMatch(/ - 1\.mp3$/);
    expect(result.multi[1]).toMatch(/ - 2\.mp3$/);
    expect(result.multi[2]).toMatch(/ - 3\.mp3$/);
  });

  it('should substitute variables correctly', () => {
    const result = generateMockFilenamePreviews('{author} - {title}');

    expect(result.single[0]).toContain('Brandon Sanderson');
    expect(result.single[0]).toContain('Mistborn');
    expect(result.single[1]).toContain('Douglas Adams');
  });
});

describe('buildRenamedFilename', () => {
  const baseVariables: TemplateVariables = {
    author: 'Brandon Sanderson',
    title: 'Mistborn: The Final Empire',
    narrator: 'Michael Kramer',
    asin: 'B002UZMLXM',
    year: 2006,
  };

  it('should build a renamed filename with extension', () => {
    const result = buildRenamedFilename('{title}', baseVariables, '.m4b');
    expect(result).toBe('Mistborn The Final Empire.m4b');
  });

  it('should append index for multi-file scenarios', () => {
    const result = buildRenamedFilename('{title}', baseVariables, '.mp3', 1);
    expect(result).toBe('Mistborn The Final Empire - 1.mp3');
  });

  it('should handle multiple variables', () => {
    const result = buildRenamedFilename('{author} - {title}', baseVariables, '.m4b');
    expect(result).toBe('Brandon Sanderson - Mistborn The Final Empire.m4b');
  });

  it('should handle extension without leading dot', () => {
    const result = buildRenamedFilename('{title}', baseVariables, 'mp3');
    expect(result).toBe('Mistborn The Final Empire.mp3');
  });

  it('should sanitize invalid characters from variable values', () => {
    const vars: TemplateVariables = {
      author: 'Author: <Test>',
      title: 'Title|Book*'
    };
    const result = buildRenamedFilename('{author} - {title}', vars, '.m4b');
    expect(result).not.toContain(':');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('|');
    expect(result).not.toContain('*');
  });

  it('should strip slashes from conditional block output', () => {
    const result = buildRenamedFilename('{author}/{title}', baseVariables, '.m4b');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });

  it('should handle conditional blocks', () => {
    const result = buildRenamedFilename('{title} {(year)}', baseVariables, '.m4b');
    expect(result).toBe('Mistborn The Final Empire (2006).m4b');
  });

  it('should remove conditional blocks when variable is missing', () => {
    const vars: TemplateVariables = {
      author: 'Andy Weir',
      title: 'Project Hail Mary',
    };
    const result = buildRenamedFilename('{title} {(year)}', vars, '.m4b');
    expect(result).toBe('Project Hail Mary.m4b');
  });

  it('should handle index appended after conditional blocks', () => {
    const result = buildRenamedFilename('{title} {(year)}', baseVariables, '.mp3', 5);
    expect(result).toBe('Mistborn The Final Empire (2006) - 5.mp3');
  });

  it('should limit very long filenames', () => {
    const vars: TemplateVariables = {
      author: 'Author',
      title: 'A'.repeat(300),
    };
    const result = buildRenamedFilename('{title}', vars, '.m4b');
    // 200 char limit on base name + extension
    expect(result.length).toBeLessThanOrEqual(204); // 200 + '.m4b'
  });
});
