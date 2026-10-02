'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, MORA_NOTE_KINDS, MORA_NOTE_MAX_LENGTH, type CreditNote, type Member, type MoraNoteKind } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { postJson } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { notePreview, sortNotes } from '@/lib/mora-notes';

/** El color del punto de cada tipo: lo importante se ve antes de leerlo. */
const DOT: Record<MoraNoteKind, string> = {
  INFO: 'bg-k-muted',
  WARNING: 'bg-k-warning',
  IMPORTANT: 'bg-k-danger',
};

/**
 * Las notas del crédito: **compactas y plegadas**, la importante arriba, y un formulario para dejar otra.
 *
 * 🔴 **Son del crédito, no del caso**: sobreviven a que el caso se cierre y existen aunque todavía no haya uno
 * (un crédito en mora sin caso también tiene cosas que decir). Se escriben y no se editan: una nota es lo que
 * alguien dijo en un momento, y corregirla es escribir otra.
 *
 * `notes === null` es «no se pudo leer» (la API sin la migración, o sin permiso): la ficha sigue entera.
 */
export function NotesSection({
  creditId,
  notes,
  members,
  canWrite,
}: {
  creditId: string;
  notes: CreditNote[] | null;
  members: Member[];
  canWrite: boolean;
}) {
  const t = useTranslations('panel.cases.ficha.notes');
  const tErr = useTranslations('panel.cases');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MoraNoteKind>('INFO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));
  // Un id por nota que se está escribiendo: si el envío falla y se reintenta (o se hace doble clic), viaja el mismo.
  const pendingId = useRef<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    // El id lo genera quien escribe: si el envío se repite (doble clic, reintento), la API no duplica la nota.
    pendingId.current ??= crypto.randomUUID();
    const res = await postJson(`/api/mora/${creditId}/notes`, { id: pendingId.current, kind, body: body.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, tErr, locale));
      return;
    }
    setBody('');
    setKind('INFO');
    setOpen(false);
    pendingId.current = null;
    toast(t('saved'));
    router.refresh();
  }

  const sorted = notes ? sortNotes(notes) : [];

  return (
    <Section
      title={t('title')}
      action={
        canWrite && notes !== null && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="text-[13px] font-medium text-k-periwinkle hover:underline">
            {t('add')}
          </button>
        ) : undefined
      }
    >
      <p className="mb-3 text-[13px] text-k-text-2">{t('hint')}</p>

      {open && (
        <div className="mb-4 space-y-3 rounded-xl border border-k-border bg-k-bg p-3">
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
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MORA_NOTE_MAX_LENGTH}
              rows={3}
              placeholder={t('placeholder')}
              className="w-full rounded-lg border border-k-border bg-white px-3 py-2 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
            />
            <span className="mt-1 block text-right text-[12px] text-k-muted">{t('remaining', { n: MORA_NOTE_MAX_LENGTH - body.length })}</span>
          </label>
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={busy}
              className="sm:w-auto sm:px-4"
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={save} loading={busy} disabled={body.trim().length === 0} className="sm:w-auto sm:px-4">
              {t('save')}
            </Button>
          </div>
        </div>
      )}

      {notes === null ? (
        <p className="text-[13px] text-k-muted">{t('unavailable')}</p>
      ) : sorted.length === 0 ? (
        <p className="text-[13px] text-k-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((n) => {
            const preview = notePreview(n.body);
            const author = n.authorId ? (byId.get(n.authorId) ?? t('unknownAuthor')) : t('unknownAuthor');
            return (
              <li key={n.id}>
                {/* `details` nativo: plegada por defecto, se abre con el teclado y no necesita estado. */}
                <details className="group rounded-lg border border-k-border bg-white px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-k-text">
                    <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[n.kind]}`} />
                    <span className="sr-only">{t(`kinds.${n.kind}`)}</span>
                    <span className="min-w-0 flex-1 truncate">{preview.text}</span>
                    <span className="shrink-0 text-[12px] text-k-muted">{dateTime(n.createdAt, locale)}</span>
                  </summary>
                  <div className="mt-2 border-t border-k-border pt-2">
                    <p className="whitespace-pre-wrap text-[14px] text-k-text">{n.body}</p>
                    <p className="mt-1 text-[12px] text-k-muted">{t('by', { name: author })}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
