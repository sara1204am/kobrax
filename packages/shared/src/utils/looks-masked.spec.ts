import { describe, expect, it } from 'vitest';
import { looksMasked, maskDocument } from './tokenize.js';

describe('looksMasked (F14 · F8, D-4)', () => {
  it('reconoce lo que produce la máscara y deja pasar un documento real', () => {
    expect(looksMasked(maskDocument('8821903'))).toBe(true);
    expect(looksMasked('12345***')).toBe(true);
    expect(looksMasked('8821903')).toBe(false);
    expect(looksMasked('')).toBe(false);
    expect(looksMasked(null)).toBe(false);
    expect(looksMasked(undefined)).toBe(false);
  });
});
