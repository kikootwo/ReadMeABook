import { describe, it, expect } from 'vitest';
import { cleanTitle, extractPrimaryAuthor } from '@/lib/utils/search-cleaner';

describe('search-cleaner utility', () => {
  describe('cleanTitle', () => {
    it('should strip parenthetical edition tags from audiobook titles', () => {
      expect(cleanTitle('Mistborn (Dramatized Adaptation)')).toBe('Mistborn');
      expect(cleanTitle('Warbreaker (Unabridged)')).toBe('Warbreaker');
      expect(cleanTitle('The Way of Kings [Full-Cast Edition]')).toBe('The Way of Kings');
      expect(cleanTitle('Elantris (10th Anniversary Edition)')).toBe('Elantris');
      expect(cleanTitle('All Systems Red (Graphic Audio)')).toBe('All Systems Red');
    });

    it('should handle clean titles without modification', () => {
      expect(cleanTitle('Leviathan Wakes')).toBe('Leviathan Wakes');
      expect(cleanTitle('Caliban\'s War')).toBe('Caliban\'s War');
    });

    it('should handle empty or undefined titles gracefully', () => {
      expect(cleanTitle('')).toBe('');
    });
  });

  describe('extractPrimaryAuthor', () => {
    it('should isolate primary author from multi-author lists', () => {
      expect(extractPrimaryAuthor('Larry Correia, Jonathan Maberry, Faith Hunter')).toBe('Larry Correia');
      expect(extractPrimaryAuthor('Robert Jordan and Brandon Sanderson')).toBe('Robert Jordan');
      expect(extractPrimaryAuthor('Seth Dickinson & Hank Green')).toBe('Seth Dickinson');
    });

    it('should preserve single author strings', () => {
      expect(extractPrimaryAuthor('Brandon Sanderson')).toBe('Brandon Sanderson');
      expect(extractPrimaryAuthor('James S. A. Corey')).toBe('James S. A. Corey');
    });

    it('should handle empty or undefined authors gracefully', () => {
      expect(extractPrimaryAuthor('')).toBe('');
    });
  });
});
