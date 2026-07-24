// test/inteiroTeorFetcher.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const { stripHtml, sanitizeFilename } = require('../src/inteiroTeorFetcher');

describe('stripHtml', () => {
  it('removes HTML tags and returns plain text', () => {
    const html = '<div><p>Hello <b>world</b></p></div>';
    assert.strictEqual(stripHtml(html), 'Hello world');
  });

  it('decodes HTML entities', () => {
    const html = '<p>Art. 201 &mdash; Par&aacute;grafo &uacute;nico</p>';
    const result = stripHtml(html);
    assert.ok(result.includes('Art. 201'));
    assert.ok(result.includes('Parágrafo'));
    assert.ok(result.includes('único'));
  });

  it('collapses excessive whitespace into single newlines', () => {
    const html = '<p>Line 1</p>\n\n\n\n<p>Line 2</p>';
    const result = stripHtml(html);
    assert.ok(!result.includes('\n\n\n'));
  });

  it('preserves paragraph breaks as double newlines', () => {
    const html = '<p>Paragraph 1</p><p>Paragraph 2</p>';
    const result = stripHtml(html);
    assert.ok(result.includes('Paragraph 1\n\nParagraph 2'));
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(stripHtml(''), '');
    assert.strictEqual(stripHtml(null), '');
    assert.strictEqual(stripHtml(undefined), '');
  });
});

describe('sanitizeFilename', () => {
  it('converts processo number to safe filename', () => {
    assert.strictEqual(
      sanitizeFilename('5015371-33.2025.4.04.7100/RS'),
      '5015371-33.2025.4.04.7100-RS'
    );
  });

  it('removes dangerous characters', () => {
    assert.strictEqual(sanitizeFilename('file:name?test'), 'filename_test');
  });
});
