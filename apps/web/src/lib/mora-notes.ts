import type { CreditNote } from '@kobrax/shared';

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
