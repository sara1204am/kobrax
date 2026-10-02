import { describe, expect, it } from 'vitest';
import { NOTE_BOARD_LIMITS } from '../types/mora.types';
import { cascadePosition, clampNoteBox } from './credit-note-board';

describe('cascadePosition', () => {
  it('cada nota baja y se corre un escalón', () => {
    expect(cascadePosition(0)).toEqual({ x: 40, y: 40 });
    expect(cascadePosition(1)).toEqual({ x: 66, y: 62 });
  });

  it('vuelve al principio cada 5 para no irse de la pantalla', () => {
    expect(cascadePosition(5)).toEqual(cascadePosition(0));
    expect(cascadePosition(12)).toEqual(cascadePosition(2));
  });

  it('un índice negativo o con decimales no rompe', () => {
    expect(cascadePosition(-1)).toEqual(cascadePosition(1));
    expect(cascadePosition(1.9)).toEqual(cascadePosition(1));
  });
});

describe('clampNoteBox', () => {
  const ok = { x: 10, y: 20, w: 240, h: 180 };

  it('lo que ya cabe no cambia', () => {
    expect(clampNoteBox(ok, { width: 1000, height: 800 })).toEqual(ok);
  });

  it('respeta el tamaño mínimo y el máximo', () => {
    expect(clampNoteBox({ ...ok, w: 10, h: 10 })).toMatchObject({ w: NOTE_BOARD_LIMITS.minWidth, h: NOTE_BOARD_LIMITS.minHeight });
    expect(clampNoteBox({ ...ok, w: 9999, h: 9999 })).toMatchObject({ w: NOTE_BOARD_LIMITS.maxWidth, h: NOTE_BOARD_LIMITS.maxHeight });
  });

  it('no deja salir la nota del tablero', () => {
    expect(clampNoteBox({ x: 900, y: 790, w: 240, h: 180 }, { width: 1000, height: 800 })).toMatchObject({ x: 760, y: 620 });
    expect(clampNoteBox({ x: -50, y: -5, w: 240, h: 180 }, { width: 1000, height: 800 })).toMatchObject({ x: 0, y: 0 });
  });

  it('un tablero más chico que la nota la deja en 0 en vez de negativa', () => {
    expect(clampNoteBox({ x: 30, y: 30, w: 240, h: 180 }, { width: 100, height: 100 })).toMatchObject({ x: 0, y: 0 });
  });

  it('sin tablero sólo acota el tamaño y que no sea negativa', () => {
    expect(clampNoteBox({ x: 5000, y: 5000, w: 240, h: 180 })).toMatchObject({ x: 5000, y: 5000 });
    expect(clampNoteBox({ x: -1, y: -1, w: 240, h: 180 })).toMatchObject({ x: 0, y: 0 });
  });

  it('redondea: la base guarda enteros', () => {
    expect(clampNoteBox({ x: 10.6, y: 20.4, w: 240.5, h: 180.2 })).toEqual({ x: 11, y: 20, w: 241, h: 180 });
  });
});
