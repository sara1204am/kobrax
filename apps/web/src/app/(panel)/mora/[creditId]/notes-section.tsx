'use client';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, type CreditNote, type Member, type MoraNoteKind } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { dateTime } from '@/lib/format';
import { anchorElement, canEditNoteText, newNoteSpot, NOTE_COLORS, sortNotes } from '@/lib/mora-notes';
import { NoteDialog, type NoteDraft } from './note-dialog';
import { NotesBoard } from './notes-board';
import { useNotes } from './use-notes';

/** El color del punto de cada tipo: lo importante se ve antes de leerlo. */
const BADGE: Record<MoraNoteKind, string> = {
  INFO: 'bg-black/5 text-k-text-2',
  WARNING: 'bg-k-warning-bg text-k-warning-text',
  IMPORTANT: 'bg-k-danger-bg text-k-danger',
};

/**
 * Las notas del crédito, como **post-its** (la paleta de post-its de Kobrax): tarjetas de colores en la lista de
 * la ficha y, si se quiere, el tablero: cada nota queda **anclada a una sección** de la ficha y se dibuja dentro de
 * ella; se arrastra, se pinta y se redimensiona. Lo único fijo en pantalla es la barra de abajo.
 *
 * 🔴 **Son del crédito, no del caso**: sobreviven a que el caso se cierre y existen aunque todavía no haya uno.
 * Se pueden corregir y borrar, con una regla: **el texto, el tipo y el borrado son de quien la escribió o de
 * quien reparte cartera**; mover, pintar y redimensionar, de cualquiera que pueda escribir sobre el crédito
 * (es ordenar el tablero, no cambiar lo que la nota dice). La API hace cumplir las dos; acá sólo se decide qué
 * botones se ofrecen.
 *
 * `notes === null` es «no se pudo leer» (la API sin la migración, o sin permiso): la ficha sigue entera.
 */
export function NotesSection({
  creditId,
  notes: initial,
  members,
  canWrite,
  userId,
  canAssign = false,
}: {
  creditId: string;
  notes: CreditNote[] | null;
  members: Member[];
  canWrite: boolean;
  /** Quién mira: decide de qué notas puede corregir el texto. */
  userId?: string;
  /** Repartir cartera: puede corregir y borrar notas ajenas. */
  canAssign?: boolean;
}) {
  const t = useTranslations('panel.mora.ficha.notes');
  const tErr = useTranslations('panel.mora');
  const locale = useLocale();
  const toast = useToast();
  const { notes, preview, save, create, remove } = useNotes(creditId, initial);
  const [board, setBoard] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ note?: CreditNote } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CreditNote | null>(null);
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));
  const nameOf = useCallback(
    (n: CreditNote) => (n.authorId ? (byId.get(n.authorId) ?? t('unknownAuthor')) : t('unknownAuthor')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, t],
  );

  /**
   * «Ubicar en la ficha»: abre el tablero, **abre la sección** a la que está anclada la nota (plegada, la nota no se
   * ve), la lleva al centro de la pantalla con scroll y la hace parpadear un momento.
   */
  function locate(id: string, anchor?: CreditNote['anchor']) {
    setBoard(true);
    setFlashId(id);
    const section = anchor ? anchorElement(anchor) : null;
    if (section instanceof HTMLDetailsElement) section.open = true;
    window.setTimeout(() => document.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1800);
  }

  async function submit(draft: NoteDraft): Promise<string | null> {
    if (dialog?.note) {
      const before = dialog.note;
      preview({ ...before, ...draft });
      // Una sola escritura: texto, tipo y color juntos. Si la API la rechaza vuelve a como estaba.
      const ok = await save(before, { body: draft.body, kind: draft.kind, color: draft.color });
      if (!ok) return errorText(undefined, tErr, locale);
      toast(t('updated'));
    } else {
      // Cae sobre la ficha, en lo que se está viendo: no arriba de todo, donde quizá nadie está mirando.
      const made = await create({ ...draft, ...newNoteSpot(notes.length) });
      if (!made) return errorText(undefined, tErr, locale);
      locate(made.id, made.anchor);
    }
    setDialog(null);
    return null;
  }

  const sorted = initial ? sortNotes(notes) : [];

  return (
    <Section
      title={t('title')}
      anchor="NOTES"
      collapsible={{ count: notes.length }}
      action={
        canWrite && initial !== null ? (
          <button type="button" onClick={() => setDialog({})} className="text-[13px] font-medium text-k-periwinkle hover:underline">
            {t('add')}
          </button>
        ) : undefined
      }
    >
      <p className="mb-3 text-[13px] text-k-text-2">{t('hint')}</p>

      {initial === null ? (
        <p className="text-[13px] text-k-muted">{t('unavailable')}</p>
      ) : (
        <>
          {notes.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-k-border bg-k-bg px-3.5 py-3">
              <span aria-hidden className="text-[20px]">
                📌
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-k-text">{board ? t('showing') : t('launcherTitle')}</div>
                <div className="text-[12px] text-k-text-2">{t('launcherSub')}</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => setBoard((b) => !b)} className="h-9 text-[13px] sm:w-auto sm:px-3">
                {board ? t('hide') : t('show')}
              </Button>
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="text-[13px] text-k-muted">{t('empty')}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {sorted.map((n) => {
                const C = NOTE_COLORS[n.color];
                const text = canWrite && canEditNoteText(n, userId, canAssign);
                return (
                  <li
                    key={n.id}
                    data-note-card={n.id}
                    className="relative flex min-h-[132px] flex-col gap-2.5 rounded-[10px] border border-black/5 p-3.5 shadow-sm"
                    style={{ background: C.bg, color: C.ink }}
                  >
                    <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[n.kind]}`}>
                      {t(`kinds.${n.kind}`)}
                    </span>
                    <p className="flex-1 whitespace-pre-wrap break-words pr-20 text-[14px] leading-normal">{n.body}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11.5px] opacity-70">
                        {nameOf(n)} · {dateTime(n.createdAt, locale)}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <IconButton label={t('locate')} onClick={() => locate(n.id, n.anchor)}>
                          📍
                        </IconButton>
                        {text && (
                          <IconButton label={t('edit')} onClick={() => setDialog({ note: n })}>
                            ✏️
                          </IconButton>
                        )}
                        {text && (
                          <IconButton label={t('delete')} onClick={() => setConfirmDelete(n)}>
                            🗑
                          </IconButton>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* El tablero va en `body` para que su barra fija (nueva nota / ocultar) no dependa del acordeón: plegado, éste
          esconde todo lo que tiene adentro. Las notas no flotan acá: cada una se dibuja dentro de su sección. */}
      {board &&
        createPortal(
        <NotesBoard
          notes={notes}
          nameOf={nameOf}
          userId={userId}
          canMove={canWrite}
          canAssign={canAssign}
          flashId={flashId}
          onPreview={preview}
          onCommit={(before, patch) => void save(before, patch)}
          onDelete={setConfirmDelete}
          onNew={() => setDialog({})}
          onClose={() => setBoard(false)}
        />,
        document.body,
      )}

      <NoteDialog
        open={dialog !== null}
        initial={dialog?.note ? { body: dialog.note.body, kind: dialog.note.kind, color: dialog.note.color } : undefined}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('deleteTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} className="sm:w-auto sm:px-4">
              {t('cancel')}
            </Button>
            <Button
              onClick={async () => {
                const n = confirmDelete;
                setConfirmDelete(null);
                if (n) await remove(n.id);
              }}
              className="sm:w-auto sm:px-4"
            >
              {t('delete')}
            </Button>
          </>
        }
      >
        <p>{t('deleteBody')}</p>
      </Modal>
    </Section>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md bg-black/5 text-[13px] hover:bg-black/15"
    >
      {children}
    </button>
  );
}
