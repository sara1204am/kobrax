import type { CreditNote, MoraNoteAnchor, MoraNoteColor, MoraNoteKind } from '@kobrax/shared';

/** Lo que `MoraService` lee de `credit_notes`. */
export interface NoteRow {
  id: string;
  creditId: string;
  kind: string;
  body: string;
  color: string;
  anchor: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  zIndex: number;
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeNote(n: NoteRow): CreditNote {
  return {
    id: n.id,
    creditId: n.creditId,
    kind: n.kind as MoraNoteKind,
    body: n.body,
    color: n.color as MoraNoteColor,
    anchor: n.anchor as MoraNoteAnchor,
    x: n.posX,
    y: n.posY,
    w: n.width,
    h: n.height,
    zIndex: n.zIndex,
    authorId: n.authorId ?? undefined,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}
