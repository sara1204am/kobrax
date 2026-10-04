'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { MORA_NOTE_ANCHORS, type CreditNote, type MoraNoteAnchor, type UpdateCreditNote } from '@kobrax/shared';
import { anchorElement, canEditNoteText, drawnLayers } from '@/lib/mora-notes';
import { StickyNote } from './sticky-note';

/**
 * El tablero: los post-its **anclados a las secciones de la ficha**. Cada nota se dibuja dentro de la sección a la
 * que pertenece (`data-note-anchor`), con `x`/`y` medidos desde la esquina de esa sección: viaja con ella al hacer
 * scroll, se esconde si se pliega y la sigue si cambia de lugar. Arrastrarla sobre otra sección la re-ancla ahí.
 *
 * Acá sólo queda **fija** la barra de abajo (nueva nota / ocultar); las notas ya no son una capa sobre la pantalla.
 *
 * Cada sección mide su propio tamaño y se lo pasa a sus notas: una nota guardada en una pantalla grande se dibuja
 * acotada en una chica, sin salirse. Lo que se guarda es lo que se mueve, no lo que se dibuja.
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

  // Esc cierra el tablero, salvo que el foco esté escribiendo en una nota.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('[contenteditable="true"]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const top = notes.reduce((m, n) => Math.max(m, n.zIndex), 0);
  const layers = drawnLayers(notes);

  return (
    <>
      {MORA_NOTE_ANCHORS.map((anchor) => {
        const mine = notes.filter((n) => n.anchor === anchor);
        if (mine.length === 0) return null;
        return (
          <AnchorLayer key={anchor} anchor={anchor}>
            {(size) =>
              mine.map((n) => (
                <StickyNote
                  key={n.id}
                  note={n}
                  authorName={nameOf(n)}
                  flash={flashId === n.id}
                  canMove={canMove}
                  canEditText={canMove && canEditNoteText(n, userId, canAssign)}
                  size={size}
                  layer={layers.get(n.id) ?? 1}
                  onPreview={onPreview}
                  onCommit={onCommit}
                  // Traerla al frente en pantalla al instante; el servidor la ordena al soltar (`front: true`).
                  onFront={() => n.zIndex <= top && n.zIndex !== top + 1 && onPreview({ ...n, zIndex: top + 1 })}
                  onDelete={() => onDelete(n)}
                />
              ))
            }
          </AnchorLayer>
        );
      })}

      <div role="region" aria-label={t('boardLabel')} className="pointer-events-none fixed inset-0 z-40">
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
    </>
  );
}

/**
 * Las notas de **una** sección, dibujadas adentro de ella (portal al elemento `data-note-anchor`) y con su tamaño
 * medido: cambia al redimensionar la ventana o al abrir/plegar cosas dentro de la sección.
 *
 * Si la sección no está en la ficha, sus notas caen en la ficha entera en vez de perderse.
 */
function AnchorLayer({ anchor, children }: { anchor: MoraNoteAnchor; children: (size: { width: number; height: number } | undefined) => React.ReactNode }) {
  const el = anchorElement(anchor);
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined);

  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((cur) => (cur && cur.width === r.width && cur.height === r.height ? cur : { width: r.width, height: r.height }));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [el]);

  return el ? createPortal(children(size), el) : null;
}
