/**
 * Component: Discord Message Building Block Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it } from 'vitest';
import { clip, escapeMarkdown, safeText } from '@/lib/services/discord/discord-format';
import { bookEmbed, searchResultOptions } from '@/lib/services/discord/discord-book-embed';

describe('Discord text helpers', () => {
  it.each([
    ['**bold**', '\\*\\*bold\\*\\*'],
    ['__u__ ~~s~~ ||spoiler||', '\\_\\_u\\_\\_ \\~\\~s\\~\\~ \\|\\|spoiler\\|\\|'],
    ['[link](https://x.test)', '\\[link\\]\\(https\\://x\\.test\\)'],
    ['# heading', '\\# heading'],
    ['- item', '\\- item'],
    ['> quote', '\\> quote'],
    ['`code`', '\\`code\\`'],
    ['<@&123> @everyone', '\\<\\@&123\\> \\@everyone'],
    ['a\\b', 'a\\\\b'],
    ['Plain Title 2', 'Plain Title 2'],
  ])('escapeMarkdown(%j)', (input, expected) => {
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('clip makes one line and cuts with an ellipsis', () => {
    expect(clip('  a\n\tb  ', 10)).toBe('a b');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
    expect(clip('abcde', 5)).toBe('abcde');
  });

  it('clip never splits a surrogate pair (an emoji is kept whole or left out)', () => {
    const book = String.fromCodePoint(0x1f4da); // two UTF-16 units
    const isWellFormed = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
    for (let max = 2; max <= 12; max++) {
      const cut = clip(`ab${book}${book}${book}cd${book}`, max);
      expect(cut.length).toBeLessThanOrEqual(max);
      expect(isWellFormed(cut)).toBe(true);
    }
    expect(clip(`a${book}bcdef`, 3)).toBe('a…');
    expect(clip(`a${book}bcdef`, 4)).toBe(`a${book}…`);
  });

  it('safeText stays within the limit after escaping', () => {
    const text = safeText('*'.repeat(300), 256);
    expect(text.length).toBeLessThanOrEqual(256);
    expect(text.replace(/\\./g, '').replace('…', '')).toBe('');
    expect(safeText(undefined, 10)).toBe('');
    expect(safeText('Title', 256)).toBe('Title');
  });
});

describe('Discord book embed', () => {
  const book = { asin: 'B0ABCDE123', title: 'Title', author: 'Author', narrator: undefined, series: undefined, seriesPart: undefined, coverArtUrl: 'http://insecure.test/c.jpg' };

  it('leaves out empty fields and a non-https cover', () => {
    const embed = bookEmbed(book, 'ebook');
    expect(embed).toEqual({ title: 'Title', fields: [{ name: 'Author', value: 'Author', inline: true }], footer: { text: 'Ebook request' } });
  });

  it('series with a part, https cover', () => {
    const embed = bookEmbed({ ...book, series: 'Saga', seriesPart: '3', coverArtUrl: 'https://m.media-amazon.com/c.jpg' }, 'audiobook');
    expect(embed.fields.at(-1)).toEqual({ name: 'Series', value: 'Saga, book 3', inline: true });
    expect(embed.thumbnail).toEqual({ url: 'https://m.media-amazon.com/c.jpg' });
    expect(embed.footer.text).toBe('Audiobook request');
  });

  it('menu options: plain text within Discord limits', () => {
    const [option] = searchResultOptions([{ ...book, title: 'T'.repeat(150), author: 'A'.repeat(150), narrator: 'N' }]);
    expect(option.label.length).toBeLessThanOrEqual(100);
    expect(option.description!.length).toBeLessThanOrEqual(100);
    expect(option.description!.startsWith('by AAA')).toBe(true);
    expect(option.value).toBe('B0ABCDE123');
  });
});
