'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MORA_NOTE_COLORS, MORA_NOTE_KINDS, MORA_NOTE_MAX_LENGTH, type MoraNoteColor, type MoraNoteKind } from '@kobrax/shared';
import { Modal } from '@/components/modal';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { NOTE_COLORS } from '@/lib/mora-notes';

export interface NoteDraft {
  body: string;
  kind: MoraNoteKind;
  color: MoraNoteColor;
}

/**
 * Crear o corregir un post-it: texto, tipo y color. El mismo diálogo para las dos cosas; `initial` lo distingue.
 * `onSubmit` devuelve un texto si algo salió mal (se muestra acá) o `null` si quedó guardado.
 */
export function NoteDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Ausente = nota nueva. */
  initial?: NoteDraft;
  onClose: () => void;
  onSubmit: (draft: NoteDraft) => Promise<string | null>;
}) {
  const t = useTranslations('panel.mora.ficha.notes');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MoraNoteKind>('INFO');
  const [color, setColor] = useState<MoraNoteColor>('YELLOW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBody(initial?.body ?? '');
    setKind(initial?.kind ?? 'INFO');
    setColor(initial?.color ?? 'YELLOW');
    setError(null);
  }, [open, initial]);

  async function submit() {
    setBusy(true);
    setError(null);
    const err = await onSubmit({ body: body.trim(), kind, color });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t('editTitle') : t('addTitle')}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="sm:w-auto sm:px-4">
            {t('cancel')}
          </Button>
          <Button onClick={submit} loading={busy} disabled={body.trim().length === 0} className="sm:w-auto sm:px-4">
            {initial ? t('saveChanges') : t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as MoraNoteKind)} aria-label={t('kind')}>
            {MORA_NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="block">
          <span className="sr-only">{t('title')}</span>
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MORA_NOTE_MAX_LENGTH}
            rows={5}
            placeholder={t('placeholder')}
            className="w-full rounded-lg border border-k-border bg-white px-3 py-2 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
          />
          <span className="mt-1 block text-right text-[12px] text-k-muted">{t('remaining', { n: MORA_NOTE_MAX_LENGTH - body.length })}</span>
        </label>
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-k-text-2">{t('colour')}</span>
          <div role="group" aria-label={t('colour')} className="flex gap-2.5">
            {MORA_NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t(`colors.${c}`)}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`h-[30px] w-[30px] rounded-full border-2 border-white ring-2 ${color === c ? 'ring-k-purple' : 'ring-black/10'}`}
                style={{ background: NOTE_COLORS[c].bg }}
              />
            ))}
          </div>
        </div>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
