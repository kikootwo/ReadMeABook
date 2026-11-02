/**
 * Component: HTML to Plain Text Tests
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import { stripHtml } from '@/lib/utils/strip-html';

describe('stripHtml', () => {
  describe('paragraphs and line breaks', () => {
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

    it('separates unclosed paragraphs', () => {
      expect(stripHtml('<p>One<p>Two<p class="x">Three')).toBe('One\nTwo\nThree');
    });

    it('trims each line and keeps at most one blank line between paragraphs', () => {
      expect(stripHtml('<p>  One  </p><p></p><p></p><br><br><p>  Two</p>')).toBe('One\n\nTwo');
    });
  });

  describe('block tags', () => {
    it('turns list items into bullet lines', () => {
      expect(stripHtml('<ul><li>Gripping</li><li>Brilliant</li></ul>')).toBe('• Gripping\n• Brilliant');
    });

    it('handles ordered lists and unclosed list items', () => {
      expect(stripHtml('<ol><li>First<li class="x">Second</ol>After')).toBe('• First\n• Second\nAfter');
    });

    it('separates <div> blocks', () => {
      expect(stripHtml('<div>Praise</div><div>More praise</div>')).toBe('Praise\nMore praise');
    });

    it('puts headings on their own line', () => {
      expect(stripHtml('<h3>Reviews</h3>Stunning.<h1>About</h1>Text')).toBe('Reviews\nStunning.\nAbout\nText');
    });

    it('separates blockquotes and <hr>', () => {
      expect(stripHtml('Intro<blockquote>A quote</blockquote>Then<hr/>End')).toBe('Intro\nA quote\nThen\nEnd');
    });

    it('does not mistake look-alike tags for block tags', () => {
      expect(stripHtml('a<pre>b</pre>c<u>d</u>e<param>f<option>g')).toBe('abcdefg');
    });

    it('drops <script> and <style> blocks with their contents', () => {
      expect(stripHtml('Keep<script type="x">alert("no")</script> this<STYLE>p { color: red }</STYLE> text')).toBe('Keep this text');
    });

    it('drops everything after an unclosed <script>', () => {
      expect(stripHtml('Keep<script>never closed')).toBe('Keep');
    });

    it('strips other tags, including ones with attributes', () => {
      expect(stripHtml('<span class="x"><b>Bold</b> and <i>italic</i> <a href="https://e.x">link</a></span>')).toBe('Bold and italic link');
    });
  });

  describe('entities', () => {
    it('decodes &amp; without decoding what it produces', () => {
      expect(stripHtml('Use &amp;lt;b&amp;gt; for bold')).toBe('Use &lt;b&gt; for bold');
    });

    it('does not double-decode a numeric ampersand', () => {
      expect(stripHtml('&#38;lt; and &#x26;amp;')).toBe('&lt; and &amp;');
    });

    it('keeps decoded angle brackets as text instead of stripping them as tags', () => {
      expect(stripHtml('<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>')).toBe('1 < 2 && 3 > 2');
    });

    it('decodes decimal and hex numeric entities', () => {
      expect(stripHtml('Caf&#233; &#x2014; it&#39;s &#X201C;new&#x201D;')).toBe('Café — it\'s “new”');
    });

    it('leaves invalid numeric entities and unknown names untouched', () => {
      expect(stripHtml('bad &#0; &#xD800; &#1114112; &bogus;')).toBe('bad &#0; &#xD800; &#1114112; &bogus;');
    });

    it('decodes common typographic entities', () => {
      expect(stripHtml('&ldquo;It&rsquo;s &lsquo;fine&rsquo;&rdquo; &mdash; 1&ndash;2&hellip; &copy; &trade;'))
        .toBe('“It’s ‘fine’” — 1–2… © ™');
    });

    it('decodes accented letters, keeping their case', () => {
      expect(stripHtml('Caf&eacute; &Eacute;mile Br&uuml;ckner Se&ntilde;or &Oslash;')).toBe('Café Émile Brückner Señor Ø');
    });

    it('matches entity names case-insensitively when there is no exact match', () => {
      expect(stripHtml('Fish &AMP; chips &MDASH; &NBSP;hot')).toBe('Fish & chips — hot');
    });

    it('decodes &quot;, &apos; and &nbsp;', () => {
      expect(stripHtml('&quot;Hi&quot;&nbsp;&apos;there&apos;')).toBe('"Hi" \'there\'');
    });

    it('collapses spaces, tabs and non-breaking spaces produced by entities', () => {
      expect(stripHtml('a&nbsp;&nbsp;&#9;&#160;b')).toBe('a b');
    });
  });

  it('returns plain text unchanged apart from trimming', () => {
    expect(stripHtml('  Already plain text.  ')).toBe('Already plain text.');
  });

  it('finishes quickly on unbalanced input', () => {
    const inputs = ['<'.repeat(80_000), '<p'.repeat(40_000), '<script'.repeat(20_000), '&#'.repeat(40_000)];
    for (const input of inputs) {
      const started = performance.now();
      stripHtml(input);
      expect(performance.now() - started).toBeLessThan(100);
    }
  });
});
