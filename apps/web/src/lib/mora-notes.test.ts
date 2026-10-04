import { describe, expect, it } from 'vitest';
import { MORA_NOTE_COLORS, type CreditNote } from '@kobrax/shared';
import { canEditNoteText, displayBox, drawnLayers, NOTE_COLORS, notePreview, sortNotes } from './mora-notes';

const n = (id: string, kind: CreditNote['kind'], createdAt: string): CreditNote => ({ id, creditId: 'c', kind, body: id, createdAt, color: 'YELLOW', anchor: 'PAGE', x: 0, y: 0, w: 240, h: 180, zIndex: 1, updatedAt: createdAt });

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

describe('NOTE_COLORS', () => {
  it('cada color del contrato tiene su paleta', () => {
    for (const c of MORA_NOTE_COLORS) {
      expect(NOTE_COLORS[c].bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(NOTE_COLORS[c].head).toMatch(/^#[0-9a-f]{6}$/i);
      expect(NOTE_COLORS[c].ink).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('canEditNoteText', () => {
  it('quien la escribió, sí; otro cobrador, no; quien reparte cartera, siempre', () => {
    expect(canEditNoteText({ authorId: 'u1' }, 'u1', false)).toBe(true);
    expect(canEditNoteText({ authorId: 'u2' }, 'u1', false)).toBe(false);
    expect(canEditNoteText({ authorId: 'u2' }, 'u1', true)).toBe(true);
  });

  it('una nota sin autor sólo la corrige quien reparte; sin sesión, nadie', () => {
    expect(canEditNoteText({ authorId: undefined }, 'u1', false)).toBe(false);
    expect(canEditNoteText({ authorId: undefined }, 'u1', true)).toBe(true);
    expect(canEditNoteText({ authorId: 'u1' }, undefined, false)).toBe(false);
  });
});

describe('displayBox', () => {
  it('una nota guardada en una pantalla grande se dibuja dentro de una chica', () => {
    expect(displayBox({ x: 900, y: 700, w: 240, h: 180 }, { width: 500, height: 400 })).toEqual({ x: 260, y: 220, w: 240, h: 180 });
  });
});

describe('drawnLayers', () => {
  it('🔴 dibuja el ORDEN (1…9), no el número guardado: una nota con zIndex 40 no le pasa por encima al encabezado fijo', () => {
    const layers = drawnLayers([
      { id: 'a', zIndex: 40 },
      { id: 'b', zIndex: 3 },
      { id: 'c', zIndex: 17 },
    ]);
    expect([layers.get('b'), layers.get('c'), layers.get('a')]).toEqual([1, 2, 3]);
  });

  it('con más de nueve notas el tope es 9 (siempre debajo del encabezado)', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, zIndex: i + 1 }));
    expect(Math.max(...drawnLayers(many).values())).toBe(9);
  });
});
