/**
 * Component: HTML to Plain Text Tests
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import { stripHtml } from '@/lib/utils/strip-html';

describe('stripHtml', () => {
  it('turns paragraphs into blank-line-separated text', () => {
    expect(stripHtml('<p>First paragraph.</p> <p>Second paragraph.</p>')).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('turns <br />, <br/> and <br> into single line breaks', () => {
    expect(stripHtml('Line one<br />Line two<br/>Line three<br>Line four')).toBe('Line one\nLine two\nLine three\nLine four');
  });

  it('matches tags case-insensitively', () => {
    expect(stripHtml('<P>Shouting</P><P>Tags<BR>here</P>')).toBe('Shouting\n\nTags\nhere');
  });

  it('treats a newline inside a paragraph as a space', () => {
    expect(stripHtml('<p>A sentence that\n   wraps in the source.</p>')).toBe('A sentence that wraps in the source.');
  });

  it('decodes &amp; last, so an escaped entity stays escaped', () => {
    expect(stripHtml('Use &amp;lt;b&amp;gt; for bold')).toBe('Use &lt;b&gt; for bold');
  });

  it('keeps decoded angle brackets as text instead of stripping them as tags', () => {
    expect(stripHtml('<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>')).toBe('1 < 2 && 3 > 2');
  });

  it('decodes decimal and hex numeric entities', () => {
    expect(stripHtml('Caf&#233; &#x2014; it&#39;s &#X201C;new&#x201D;')).toBe('Café — it\'s “new”');
  });

  it('leaves invalid numeric entities untouched', () => {
    expect(stripHtml('bad &#0; &#xD800; &#1114112;')).toBe('bad &#0; &#xD800; &#1114112;');
  });

  it('decodes &quot;, &apos; and &nbsp;', () => {
    expect(stripHtml('&quot;Hi&quot;&nbsp;&apos;there&apos;')).toBe('"Hi" \'there\'');
  });

  it('trims each line and keeps at most one blank line between paragraphs', () => {
    expect(stripHtml('<p>  One  </p><p></p><p></p><br><br><p>  Two</p>')).toBe('One\n\nTwo');
  });

  it('strips other tags, including ones with attributes', () => {
    expect(stripHtml('<div class="x"><b>Bold</b> and <i>italic</i> <a href="https://e.x">link</a></div>')).toBe('Bold and italic link');
  });

  it('returns plain text unchanged apart from trimming', () => {
    expect(stripHtml('  Already plain text.  ')).toBe('Already plain text.');
  });
});
