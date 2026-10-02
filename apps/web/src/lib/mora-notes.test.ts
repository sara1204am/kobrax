import { describe, expect, it } from 'vitest';
import type { CreditNote } from '@kobrax/shared';
import { notePreview, sortNotes } from './mora-notes';

const n = (id: string, kind: CreditNote['kind'], createdAt: string): CreditNote => ({ id, creditId: 'c', kind, body: id, createdAt });

describe('sortNotes', () => {
  it('🔴 las importantes primero, aunque sean viejas; dentro de cada tipo, la más reciente arriba', () => {
    const out = sortNotes([
      n('info-nueva', 'INFO', '2026-10-01T10:00:00Z'),
      n('importante-vieja', 'IMPORTANT', '2026-08-01T10:00:00Z'),
      n('atencion', 'WARNING', '2026-09-01T10:00:00Z'),
      n('importante-nueva', 'IMPORTANT', '2026-09-15T10:00:00Z'),
      n('info-vieja', 'INFO', '2026-07-01T10:00:00Z'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['importante-nueva', 'importante-vieja', 'atencion', 'info-nueva', 'info-vieja']);
  });

  it('no modifica la lista original', () => {
    const input = [n('a', 'INFO', '2026-01-01T00:00:00Z'), n('b', 'IMPORTANT', '2026-01-02T00:00:00Z')];
    sortNotes(input);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('notePreview', () => {
  it('un texto corto de una línea se muestra entero y no hay nada que abrir', () => {
    expect(notePreview('Visitar al padre para negociar pago')).toEqual({ text: 'Visitar al padre para negociar pago', truncated: false });
  });

  it('un texto largo se recorta y se puede abrir', () => {
    const r = notePreview('x'.repeat(200), 80);
    expect(r.text).toHaveLength(81);
    expect(r.text.endsWith('…')).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it('con varias líneas muestra la primera y se puede abrir', () => {
    expect(notePreview('Primera línea\nSegunda')).toEqual({ text: 'Primera línea', truncated: true });
  });

  it('los espacios de los bordes no cuentan', () => {
    expect(notePreview('   hola   ')).toEqual({ text: 'hola', truncated: false });
  });
});
