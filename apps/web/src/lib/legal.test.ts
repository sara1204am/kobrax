import { describe, expect, it } from 'vitest';
import { EMPTY_CHOICE, LEGAL_LOCALE, canSubmitLegal, legalPayload, type SignupDocument } from './legal';

const DOCS: SignupDocument[] = [
  { type: 'TERMS', action: 'ACCEPTED', versionId: 't-1', version: '1.0.0', title: 'T', contentSha256: 'a'.repeat(64) },
  { type: 'PRIVACY', action: 'ACKNOWLEDGED', versionId: 'p-1', version: '1.0.0', title: 'P', contentSha256: 'b'.repeat(64) },
];

describe('lib/legal', () => {
  it('🔴 nada viene premarcado', () => {
    expect(EMPTY_CHOICE).toEqual({ terms: false, privacy: false });
  });

  it('solo se puede enviar con los documentos cargados y las DOS obligatorias marcadas', () => {
    expect(canSubmitLegal(null, { terms: true, privacy: true })).toBe(false);
    expect(canSubmitLegal(DOCS, EMPTY_CHOICE)).toBe(false);
    expect(canSubmitLegal(DOCS, { ...EMPTY_CHOICE, terms: true })).toBe(false);
    expect(canSubmitLegal(DOCS, { ...EMPTY_CHOICE, privacy: true })).toBe(false);
    expect(canSubmitLegal(DOCS, { terms: true, privacy: true })).toBe(true);
  });


  it('si el servidor no devolvió uno de los dos documentos, no hay alta posible', () => {
    expect(canSubmitLegal([DOCS[0]!], { terms: true, privacy: true })).toBe(false);
  });

  it('el cuerpo lleva ids de versión (nunca texto ni hash) y ningún consentimiento opcional', () => {
    const body = legalPayload(DOCS, { terms: true, privacy: true });
    expect(body).toEqual({ termsVersionId: 't-1', privacyVersionId: 'p-1' });
    expect('marketingOptIn' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('aaaa');
  });

  it('sin lo obligatorio el cuerpo va vacío: ese envío no debería ocurrir', () => {
    expect(legalPayload(DOCS, EMPTY_CHOICE)).toEqual({});
    expect(legalPayload(null, { terms: true, privacy: true })).toEqual({});
  });

  it('los documentos se piden en español mientras no haya traducciones publicadas', () => {
    expect(LEGAL_LOCALE).toBe('es');
  });
});
