/**
 * El tablero de post-its de la ficha de mora: dónde cae una nota nueva y cómo se acota lo que el usuario arrastra.
 * Una sola regla, escrita una vez: la web la usa mientras se arrastra y la API vuelve a acotar lo que recibe.
 */
import { NOTE_BOARD_LIMITS } from '../types/mora.types.js';

export interface NoteBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/**
 * Dónde cae la nota número `index` si nadie la puso: en cascada, para que no queden una encima de otra.
 * Vuelve al principio cada 5 (son 5 escalones de 26 × 22 px).
 */
export function cascadePosition(index: number): { x: number; y: number } {
  const step = Math.abs(Math.trunc(index)) % 5;
  return { x: 40 + step * 26, y: 40 + step * 22 };
}

/**
 * Acota una nota al tamaño permitido y, si se conoce el tablero, a que no se salga de él.
 * Todo entero: se guarda en columnas `INTEGER`.
 */
export function clampNoteBox(box: NoteBox, board?: { width: number; height: number }): NoteBox {
  const w = Math.round(clamp(box.w, NOTE_BOARD_LIMITS.minWidth, NOTE_BOARD_LIMITS.maxWidth));
  const h = Math.round(clamp(box.h, NOTE_BOARD_LIMITS.minHeight, NOTE_BOARD_LIMITS.maxHeight));
  const maxX = board ? Math.max(0, board.width - w) : Number.MAX_SAFE_INTEGER;
  const maxY = board ? Math.max(0, board.height - h) : Number.MAX_SAFE_INTEGER;
  return { x: Math.round(clamp(box.x, 0, maxX)), y: Math.round(clamp(box.y, 0, maxY)), w, h };
}
