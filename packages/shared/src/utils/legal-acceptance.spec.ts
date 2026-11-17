import { describe, expect, it } from 'vitest';
import { EMPTY_CHOICE, LEGAL_LOCALE, canSubmitLegal, legalPayload, parseLegal, parseLegalInline, type SignupDocument } from './legal-acceptance.js';

const DOCS: SignupDocument[] = [
  { type: 'TERMS', action: 'ACCEPTED', versionId: 't-1', version: '1.0.0', title: 'T', contentSha256: 'a'.repeat(64) },
  { type: 'PRIVACY', action: 'ACKNOWLEDGED', versionId: 'p-1', version: '1.0.0', title: 'P', contentSha256: 'b'.repeat(64) },
];

describe('aceptación legal (compartida web + móvil)', () => {
  it('🔴 nada viene premarcado', () => {
    expect(EMPTY_CHOICE).toEqual({ terms: false, privacy: false });
  });

  it('solo se puede enviar con los documentos cargados y las DOS obligatorias marcadas', () => {
    expect(canSubmitLegal(null, { terms: true, privacy: true })).toBe(false);
    expect(canSubmitLegal(DOCS, EMPTY_CHOICE)).toBe(false);
    expect(canSubmitLegal(DOCS, { terms: true, privacy: false })).toBe(false);
    expect(canSubmitLegal(DOCS, { terms: false, privacy: true })).toBe(false);
    expect(canSubmitLegal(DOCS, { terms: true, privacy: true })).toBe(true);
  });

  it('si el servidor no devolvió uno de los dos documentos no hay alta posible', () => {
    expect(canSubmitLegal([DOCS[0]!], { terms: true, privacy: true })).toBe(false);
  });

  it('🔴 el cuerpo lleva ids de versión (nunca texto ni hash) y ningún consentimiento opcional', () => {
    const body = legalPayload(DOCS, { terms: true, privacy: true });
    expect(body).toEqual({ termsVersionId: 't-1', privacyVersionId: 'p-1' });
    expect('marketingOptIn' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('aaaa');
  });

  it('sin lo obligatorio el cuerpo va vacío', () => {
    expect(legalPayload(DOCS, EMPTY_CHOICE)).toEqual({});
    expect(legalPayload(null, { terms: true, privacy: true })).toEqual({});
  });

  it('los documentos se piden en español mientras no haya traducciones publicadas', () => {
    expect(LEGAL_LOCALE).toBe('es');
  });
});

describe('lector del texto de los documentos', () => {
  it('arma títulos, párrafos (varias líneas = uno) y listas con y sin numeración', () => {
    expect(parseLegal('# Título\n\nUn párrafo\ncon dos líneas.\n\n## Sección\n\n- uno\n- dos\n\n1. primero\n2. segundo')).toEqual([
      { kind: 'h', level: 1, text: 'Título' },
      { kind: 'p', text: 'Un párrafo con dos líneas.' },
      { kind: 'h', level: 2, text: 'Sección' },
      { kind: 'ul', items: ['uno', 'dos'] },
      { kind: 'ol', items: ['primero', 'segundo'] },
    ]);
  });

  it('tolera saltos de línea de Windows', () => {
    expect(parseLegal('# A\r\n\r\ntexto')).toEqual([
      { kind: 'h', level: 1, text: 'A' },
      { kind: 'p', text: 'texto' },
    ]);
  });

  it('🔴 devuelve datos, no HTML: un texto con etiquetas queda como texto', () => {
    const [block] = parseLegal('Hola <script>alert(1)</script>');
    expect(block).toEqual({ kind: 'p', text: 'Hola <script>alert(1)</script>' });
  });

  it('reconoce negrita, marcadores PENDIENTE y enlaces internos; una URL externa NO es enlace', () => {
    expect(parseLegalInline('Es **muy importante** y [PENDIENTE DE CONFIRMACIÓN LEGAL] ver [Política](/privacidad) o [esto](https://malo.example)')).toEqual([
      { kind: 'text', text: 'Es ' },
      { kind: 'bold', text: 'muy importante' },
      { kind: 'text', text: ' y ' },
      { kind: 'pending', text: '[PENDIENTE DE CONFIRMACIÓN LEGAL]' },
      { kind: 'text', text: ' ver ' },
      { kind: 'link', text: 'Política', href: '/privacidad' },
      { kind: 'text', text: ' o [esto](https://malo.example)' },
    ]);
  });
});
