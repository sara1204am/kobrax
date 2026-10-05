import { cascadePosition, clampNoteBox, MORA_NOTE_ANCHORS, type CreditNote, type MoraNoteAnchor, type MoraNoteColor } from '@kobrax/shared';

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

/** La paleta del post-it (la paleta de post-its de Kobrax): fondo, encabezado y tinta. El color del tipo de nota es otra cosa. */
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

// ── Anclaje a las secciones de la ficha ──────────────────────────────────────────────────────────────────
//
// Un post-it vive **dentro** de la sección a la que está anclado (`data-note-anchor` en el DOM): su `x`/`y` se
// miden desde la esquina de esa sección. Así viaja con ella al hacer scroll, al plegar o al cambiar el ancho de la
// ventana, en vez de quedarse quieto en la pantalla mientras la ficha pasa por debajo.

const ANCHOR_ATTR = 'data-note-anchor';

/** El elemento de una sección. Si esa sección no está en la ficha (sin permiso, por ejemplo), la ficha entera. */
export function anchorElement(anchor: MoraNoteAnchor): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="${anchor}"]`) ?? document.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="PAGE"]`);
}

/** La esquina desde la que se miden `x`/`y` (el borde interior: así es como `absolute` se mide dentro de un `relative`). */
export function anchorOrigin(el: HTMLElement): { left: number; top: number } {
  const r = el.getBoundingClientRect();
  return { left: r.left + el.clientLeft, top: r.top + el.clientTop };
}

/**
 * ¿Sobre qué sección está el puntero? La más de adentro que esté a la vista: una sección plegada **no** vale
 * (una nota soltada ahí quedaría escondida), cae en la que la contiene. Las notas mismas no cuentan.
 */
export function anchorAtPoint(clientX: number, clientY: number): { anchor: MoraNoteAnchor; el: HTMLElement } | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  for (const hit of document.elementsFromPoint(clientX, clientY)) {
    if (hit.closest('[data-note-id]')) continue;
    let el = hit.closest<HTMLElement>(`[${ANCHOR_ATTR}]`);
    while (el instanceof HTMLDetailsElement && !el.open) el = el.parentElement?.closest<HTMLElement>(`[${ANCHOR_ATTR}]`) ?? null;
    const anchor = el?.getAttribute(ANCHOR_ATTR) as MoraNoteAnchor | null | undefined;
    if (el && anchor && (MORA_NOTE_ANCHORS as readonly string[]).includes(anchor)) return { anchor, el };
  }
  return null;
}

/**
 * Dónde cae una nota nueva: sobre la ficha, **en lo que se está viendo** (no arriba de todo, donde quizá hace
 * rato que no se mira), en cascada para que no se apilen. Bajo el encabezado fijo del panel.
 */
export function newNoteSpot(index: number): { anchor: MoraNoteAnchor; x: number; y: number } {
  const cascade = cascadePosition(index);
  const page = anchorElement('PAGE');
  const scrolled = page ? Math.max(0, Math.round(-page.getBoundingClientRect().top)) : 0;
  return { anchor: 'PAGE', x: cascade.x, y: scrolled + cascade.y + 56 };
}

/**
 * El `z-index` que se dibuja. Las notas viven dentro de la página, que tiene el encabezado fijo en `z-10`: una
 * nota con un `zIndex` guardado de 40 le pasaría por encima. Se dibuja el **orden** (1…9), no el número guardado.
 */
export function drawnLayers(notes: readonly Pick<CreditNote, 'id' | 'zIndex'>[]): Map<string, number> {
  const ranked = [...notes].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  return new Map(ranked.map((n, i) => [n.id, Math.min(i + 1, 9)]));
}
