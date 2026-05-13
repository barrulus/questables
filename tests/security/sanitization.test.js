/**
 * @jest-environment node
 *
 * Coverage for the API-boundary HTML strip used as defence-in-depth at
 * write sites for free-text columns the UI renders (F6 + sweep).
 */
import { describe, it, expect } from '@jest/globals';
import { sanitizeFreeText, stripHtmlTags } from '../../server/utils/sanitization.js';

describe('stripHtmlTags', () => {
  it('removes script and style blocks wholesale', () => {
    expect(stripHtmlTags('hi<script>alert(1)</script>there')).toBe('hithere');
    expect(stripHtmlTags('a<style>x{color:red}</style>b')).toBe('ab');
  });

  it('strips bare tags while keeping whitespace', () => {
    expect(stripHtmlTags('<b>bold</b>\n<i>italic</i>')).toBe('bold\nitalic');
  });

  it('neutralises img onerror', () => {
    expect(stripHtmlTags('<img src=x onerror=alert(1)>')).toBe('');
  });
});

describe('sanitizeFreeText', () => {
  it('returns null for non-strings', () => {
    expect(sanitizeFreeText(undefined)).toBeNull();
    expect(sanitizeFreeText(123)).toBeNull();
  });

  it('returns null when the result is empty after stripping', () => {
    expect(sanitizeFreeText('   ')).toBeNull();
    expect(sanitizeFreeText('<script>only tags</script>')).toBeNull();
  });

  it('returns the stripped trimmed value', () => {
    expect(sanitizeFreeText('  <b>Hello</b> world  ')).toBe('Hello world');
  });
});
