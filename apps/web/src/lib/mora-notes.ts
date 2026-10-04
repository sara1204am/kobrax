import { clampNoteBox, type CreditNote, type MoraNoteColor } from '@kobrax/shared';

const KIND_RANK: Record<CreditNote['kind'], number> = { IMPORTANT: 0, WARNING: 1, INFO: 2 };

/**
 * El orden de las notas de la ficha: **las importantes primero** (son las que hay que leer antes de salir a
 * cobrar) y, dentro de cada tipo, la más reciente arriba. Una importante vieja no se hunde detrás de veinte
 * informativas nuevas.
 */
export function sortNotes(notes: readonly CreditNote[]): CreditNote[] {
  return [...notes].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * La nota plegada: **la primera línea**, recortada. El resto se ve al abrirla. Si el texto entero cabe en el
 * resumen, no hay nada más que abrir y quien llama lo sabe por `truncated`.
 */
export function notePreview(body: string, max = 80): { text: string; truncated: boolean } {
  const first = body.trim().split(/\r?\n/)[0] ?? '';
  const multiline = body.trim().includes('\n');
  if (first.length <= max) return { text: first, truncated: multiline };
  return { text: `${first.slice(0, max).trimEnd()}…`, truncated: true };
}

/** La paleta del post-it (la de Gallium): fondo, encabezado y tinta. El color del tipo de nota es otra cosa. */
export const NOTE_COLORS: Record<MoraNoteColor, { bg: string; head: string; ink: string }> = {
  YELLOW: { bg: '#fef9c3', head: '#fdef8a', ink: '#854d0e' },
  PINK: { bg: '#fce7f3', head: '#fbcfe8', ink: '#9d174d' },
  BLUE: { bg: '#dbeafe', head: '#bfdbfe', ink: '#1e40af' },
  GREEN: { bg: '#dcfce7', head: '#bbf7d0', ink: '#166534' },
  PURPLE: { bg: '#ede9fe', head: '#ddd6fe', ink: '#5b21b6' },
  ORANGE: { bg: '#ffedd5', head: '#fed7aa', ink: '#9a3412' },
};

/**
 * ¿Puede esta persona cambiar el **texto** (o el tipo) y borrar esta nota? Es la regla de la API (`canEditNote`):
 * quien la escribió, o quien reparte cartera. Acá sólo decide qué botones se ofrecen; la API la vuelve a exigir.
 * Mover, pintar y redimensionar no pasan por acá: los puede quien pueda escribir sobre el crédito.
 */
export function canEditNoteText(note: Pick<CreditNote, 'authorId'>, userId: string | undefined, canAssign: boolean): boolean {
  return canAssign || (!!userId && note.authorId === userId);
}

/** Dónde se dibuja la nota: lo guardado, acotado al tablero actual para que nunca quede fuera de la pantalla. */
export function displayBox(note: Pick<CreditNote, 'x' | 'y' | 'w' | 'h'>, board: { width: number; height: number }) {
  return clampNoteBox(note, board);
}
