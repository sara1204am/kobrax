'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { clampNoteBox, MORA_NOTE_COLORS, type CreditNote, type MoraNoteColor, type UpdateCreditNote } from '@kobrax/shared';
import { anchorAtPoint, anchorOrigin, displayBox, NOTE_COLORS } from '@/lib/mora-notes';

/**
 * Un post-it anclado a una sección de la ficha (se dibuja dentro de ella, `x`/`y` desde su esquina): se arrastra por el encabezado, se redimensiona por la esquina, se pinta y (si es
 * tuyo, o repartís cartera) se corrige el texto y se borra. Es el de Gallium, con los colores de Kobrax.
 *
 * 🔴 **Arrastrar y redimensionar no guardan a cada píxel**: `onPreview` mueve la nota en pantalla y `onCommit`
 * guarda UNA vez, al soltar. Sin eso, un arrastre de dos segundos son cien PATCH.
 *
 * `latest` guarda el último valor producido durante el gesto, así el guardado al soltar usa la nota ya movida y
 * no la que había cuando empezó el gesto.
 */
export function StickyNote({
  note,
  authorName,
  flash,
  canMove,
  canEditText,
  size,
  layer,
  onPreview,
  onCommit,
  onFront,
  onDelete,
}: {
  note: CreditNote;
  authorName: string;
  flash: boolean;
  canMove: boolean;
  canEditText: boolean;
  /** Tamaño de la sección a la que está anclada, ahora mismo. Sin medir todavía, se dibuja lo guardado. */
  size: { width: number; height: number } | undefined;
  /** El orden de apilado que se dibuja (1…9), no el número guardado: ver `drawnLayers`. */
  layer: number;
  onPreview: (note: CreditNote) => void;
  onCommit: (before: CreditNote, patch: UpdateCreditNote) => void;
  onFront: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('panel.cases.ficha.notes');
  const C = NOTE_COLORS[note.color];
  const [dragging, setDragging] = useState(false);
  const [palette, setPalette] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ mx: number; my: number; box: { x: number; y: number; w: number; h: number } } | null>(null);
  const latest = useRef<CreditNote>(note);

  // Lo que se dibuja: lo guardado, acotado al tablero de ahora (en una pantalla chica nunca queda fuera).
  // Mientras se arrastra se dibuja libre (puede cruzar a otra sección); en reposo, acotado a la sección de ahora.
  const shown = size && !dragging ? displayBox(note, size) : { x: note.x, y: note.y, w: note.w, h: note.h };

  function gesture(e: ReactPointerEvent, kind: 'move' | 'resize') {
    if (!canMove) return;
    e.preventDefault();
    e.stopPropagation();
    onFront();
    const before = note;
    const home = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-note-anchor]');
    start.current = { mx: e.clientX, my: e.clientY, box: { ...shown } };
    latest.current = before;
    if (kind === 'move') setDragging(true);

    const move = (ev: PointerEvent) => {
      if (!start.current) return;
      const dx = ev.clientX - start.current.mx;
      const dy = ev.clientY - start.current.my;
      const b = start.current.box;
      // Moverla se ve libre —puede salirse de su sección camino a otra—; el lugar definitivo se acota al soltar.
      const box = kind === 'move' ? { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h } : clampNoteBox({ x: b.x, y: b.y, w: b.w + dx, h: b.h + dy }, size);
      const next = { ...before, x: box.x, y: box.y, w: box.w, h: box.h };
      latest.current = next;
      onPreview(next);
    };
    const up = (ev: PointerEvent) => {
      setDragging(false);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      let n = latest.current;
      let patch: UpdateCreditNote;
      if (kind === 'move' && home) {
        // ¿Sobre qué sección la soltó? Si es otra, se re-ancla: sus coordenadas pasan a medirse desde esa sección.
        const hit = anchorAtPoint(ev.clientX, ev.clientY);
        const target = hit && hit.anchor !== before.anchor ? hit : null;
        const from = anchorOrigin(home);
        const into = target ? anchorOrigin(target.el) : from;
        const bounds = target ? target.el.getBoundingClientRect() : home.getBoundingClientRect();
        const box = clampNoteBox({ x: n.x + from.left - into.left, y: n.y + from.top - into.top, w: n.w, h: n.h }, { width: bounds.width, height: bounds.height });
        n = { ...n, ...box, anchor: target ? target.anchor : n.anchor };
        patch = { x: n.x, y: n.y, w: n.w, h: n.h, ...(target ? { anchor: n.anchor } : {}), front: true };
        onPreview(n);
      } else {
        patch = { x: n.x, y: n.y, w: n.w, h: n.h, front: true };
      }
      const moved = n.x !== before.x || n.y !== before.y || n.w !== before.w || n.h !== before.h || n.anchor !== before.anchor;
      // Un clic sin movimiento sólo la trae al frente; moverla guarda el lugar (y también la trae al frente).
      onCommit(before, moved ? patch : { front: true });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  const commitBody = () => {
    const text = (bodyRef.current?.innerText ?? '').trim();
    if (text === note.body.trim()) return;
    // Una nota vacía no es una nota: se deja como estaba en vez de mandar un texto que la API rechaza.
    if (text.length === 0 && bodyRef.current) {
      bodyRef.current.innerText = note.body;
      return;
    }
    onPreview({ ...note, body: text });
    onCommit(note, { body: text });
  };

  return (
    <div
      data-note-id={note.id}
      className={`absolute flex flex-col rounded-[6px] shadow-[0_6px_18px_rgba(26,58,82,.22)] ${dragging ? 'cursor-grabbing shadow-[0_14px_30px_rgba(26,58,82,.3)]' : ''} ${flash ? 'ring-4 ring-k-purple/60' : ''}`}
      style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h, background: C.bg, zIndex: layer }}
      onPointerDown={() => canMove && onFront()}
    >
      <div
        className="flex h-[30px] shrink-0 items-center gap-1 rounded-t-[6px] px-2.5"
        style={{ background: C.head, cursor: canMove ? 'grab' : 'default', touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-sn-btn]')) return;
          gesture(e, 'move');
        }}
        title={canMove ? t('dragHint') : undefined}
      >
        <span aria-hidden className="mr-auto select-none text-[13px] leading-none text-black/30">
          ⋮⋮
        </span>
        {canMove && (
          <div className="relative">
            <button
              type="button"
              data-sn-btn
              aria-label={t('colour')}
              title={t('colour')}
              className="grid h-6 w-6 place-items-center rounded hover:bg-black/10"
              onClick={() => setPalette((p) => !p)}
            >
              <span className="block h-[13px] w-[13px] rounded-full" style={{ background: C.ink }} />
            </button>
            {palette && (
              <div
                data-sn-btn
                role="group"
                aria-label={t('colour')}
                className="absolute left-0 top-7 z-10 flex gap-1.5 rounded-lg border border-k-border bg-white p-2 shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {MORA_NOTE_COLORS.map((c: MoraNoteColor) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={t(`colors.${c}`)}
                    aria-pressed={note.color === c}
                    className="h-[22px] w-[22px] rounded-full border-2 border-white"
                    style={{ background: NOTE_COLORS[c].bg, boxShadow: note.color === c ? '0 0 0 2px #7B68D6' : '0 0 0 1px rgba(0,0,0,.12)' }}
                    onClick={() => {
                      setPalette(false);
                      if (c === note.color) return;
                      onPreview({ ...note, color: c });
                      onCommit(note, { color: c });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {canEditText && (
          <button
            type="button"
            data-sn-btn
            aria-label={t('delete')}
            title={t('delete')}
            className="grid h-6 w-6 place-items-center rounded text-[13px] text-black/50 hover:bg-black/10"
            onClick={onDelete}
          >
            🗑
          </button>
        )}
      </div>

      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 pt-1.5 text-[14px] leading-snug outline-none"
        style={{ color: C.ink, cursor: canEditText ? 'text' : 'default' }}
        contentEditable={canEditText}
        suppressContentEditableWarning
        role={canEditText ? 'textbox' : undefined}
        aria-label={canEditText ? t('edit') : undefined}
        aria-multiline={canEditText || undefined}
        onBlur={commitBody}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {note.body}
      </div>
      <div className="shrink-0 px-3 pb-2 text-[11px]" style={{ color: C.ink, opacity: 0.65 }}>
        {authorName}
      </div>

      {canMove && (
        <div
          aria-hidden
          className="absolute bottom-0.5 right-0.5 grid h-4 w-4 cursor-nwse-resize place-items-center text-[10px] text-black/30"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => gesture(e, 'resize')}
        >
          ◢
        </div>
      )}
    </div>
  );
}

