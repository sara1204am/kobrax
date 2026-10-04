import type { CreditNote, MoraNoteKind } from '@kobrax/shared';

/** Lo que `MoraService` lee de `credit_notes`. */
export interface NoteRow {
  id: string;
  creditId: string;
  kind: string;
  body: string;
  authorId: string | null;
  createdAt: Date;
}

export function serializeNote(n: NoteRow): CreditNote {
  return {
    id: n.id,
    creditId: n.creditId,
    kind: n.kind as MoraNoteKind,
    body: n.body,
    authorId: n.authorId ?? undefined,
    createdAt: n.createdAt.toISOString(),
  };
}
