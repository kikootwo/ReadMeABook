/**
 * Tests for Path Template Engine Utility
 */

import { describe, it, expect } from 'vitest';
import {
  substituteTemplate,
  validateTemplate,
  generateMockPreviews,
  getValidVariables,
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

  it('should handle mixed forward and backward slashes', () => {
    const template = '{author}\\{title}/{narrator}';
    const variables: TemplateVariables = {
      author: 'Author',
      title: 'Title',
      narrator: 'Narrator'
    };

    const result = substituteTemplate(template, variables);
    expect(result).toBe('Author/Title/Narrator');
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
    expect(result.error).toContain('Unknown variable');
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

  it('should reject backslashes in template', () => {
    const result = validateTemplate('{author}\\{title}');
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
    expect(result.error).toContain('Unknown variable');
  });

  it('should list valid variables in error message', () => {
    const result = validateTemplate('{invalid}');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('{author}');
    expect(result.error).toContain('{title}');
    expect(result.error).toContain('{narrator}');
    expect(result.error).toContain('{asin}');
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
