'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreditNote, UpdateCreditNote } from '@kobrax/shared';
import { canEditNoteText } from '@/lib/mora-notes';
import { StickyNote } from './sticky-note';

/**
 * El tablero: los post-its flotando **sobre la pantalla**, como en Gallium. Es una capa fija que no tapa nada
 * (`pointer-events-none`): sólo las notas y la barra de abajo reciben el mouse, así que la ficha de atrás se
 * sigue leyendo y se puede seguir usando.
 *
 * Mide su propio tamaño y se lo pasa a cada nota: una nota guardada en una pantalla grande se dibuja acotada en
 * una chica, sin salirse. Lo que se guarda es lo que se mueve, no lo que se dibuja.
 */
export function NotesBoard({
  notes,
  nameOf,
  userId,
  canMove,
  canAssign,
  flashId,
  onPreview,
  onCommit,
  onDelete,
  onNew,
  onClose,
}: {
  notes: CreditNote[];
  nameOf: (n: CreditNote) => string;
  userId: string | undefined;
  /** Mover, pintar y redimensionar: quien puede escribir sobre el crédito. */
  canMove: boolean;
  /** Repartir cartera: puede corregir y borrar notas ajenas. */
  canAssign: boolean;
  flashId: string | null;
  onPreview: (note: CreditNote) => void;
  onCommit: (before: CreditNote, patch: UpdateCreditNote) => void;
  onDelete: (note: CreditNote) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('panel.cases.ficha.notes');
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    const measure = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setSize({ width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Esc cierra el tablero, salvo que el foco esté escribiendo en una nota.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('[contenteditable="true"]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const top = notes.reduce((m, n) => Math.max(m, n.zIndex), 0);

  return (
    <div ref={ref} role="region" aria-label={t('boardLabel')} className="pointer-events-none fixed inset-0 z-40">
      {notes.map((n) => (
        <StickyNote
          key={n.id}
          note={n}
          authorName={nameOf(n)}
          flash={flashId === n.id}
          canMove={canMove}
          canEditText={canMove && canEditNoteText(n, userId, canAssign)}
          size={size}
          onPreview={onPreview}
          onCommit={onCommit}
          // Traerla al frente en pantalla al instante; el servidor la ordena al soltar (`front: true`).
          onFront={() => n.zIndex <= top && n.zIndex !== top + 1 && onPreview({ ...n, zIndex: top + 1 })}
          onDelete={() => onDelete(n)}
        />
      ))}

      <div className="pointer-events-auto absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-k-border bg-white px-2 py-1.5 shadow-k-card">
        {canMove && (
          <button type="button" onClick={onNew} className="rounded-full bg-k-navy px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-k-slate">
            + {t('newNote')}
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-k-text-2 hover:bg-k-bg">
          {t('hide')}
        </button>
      </div>
    </div>
  );
}
