'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ScopeMember } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * Asesores de los reportes → usuarios (D8).
 *
 * Un reporte de mora suele ser de UN asesor ("Asesor: CQE"). Vincular su código a un usuario hace dos
 * cosas: sus operaciones nuevas quedan asignadas a esa persona, y lo que falta de su reporte falta de
 * **su** cartera — no de la de todos. Sin vínculo, un reporte de asesor no se aplica con alcance de
 * empresa: pondría ausentes a las operaciones de los demás.
 *
 * El código no es la identidad del usuario: sólo dice de quién es un reporte.
 */
export function AdvisorLinks({
  links,
  unlinked,
  members,
}: {
  links: { advisorCode: string; userId: string }[];
  unlinked: string[];
  members: ScopeMember[];
}) {
  const t = useTranslations('panel.import.advisors');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState(unlinked[0] ?? '');
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !userId) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/imports/advisors/${encodeURIComponent(code.trim())}`, { userId }, 'PUT');
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data.error, t, locale));
    toast(t('saved'));
    setCode('');
    setUserId('');
    router.refresh();
  }

  async function remove(advisorCode: string) {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/imports/advisors/${encodeURIComponent(advisorCode)}`, {}, 'DELETE');
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data.error, t, locale));
    router.refresh();
  }

  return (
    <section className="mt-8 rounded-2xl border border-k-border bg-white p-6">
      <h2 className="text-[18px] font-semibold text-k-navy">{t('title')}</h2>
      <p className="mt-1 text-[14px] text-k-text-2">{t('subtitle')}</p>
      <ErrorBanner message={error} />

      {unlinked.length > 0 && (
        <p className="mt-3 rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          {t('unlinked', { codes: unlinked.join(', ') })}
        </p>
      )}

      {links.length > 0 ? (
        <ul className="mt-4 divide-y divide-k-border">
          {links.map((l) => (
            <li key={l.advisorCode} className="flex items-center justify-between py-2 text-[14px]">
              <span>
                <span className="font-semibold text-k-navy">{l.advisorCode}</span> → {nameOf(l.userId)}
              </span>
              <button
                type="button"
                className="text-[13px] font-semibold text-k-danger hover:underline disabled:opacity-50"
                onClick={() => void remove(l.advisorCode)}
                disabled={busy}
              >
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] text-k-text-2">{t('none')}</p>
      )}

      <form onSubmit={(e) => void save(e)} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label={t('code')}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} disabled={busy} />
        </Field>
        <Field label={t('user')}>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={busy}>
            <option value="">{t('pickUser')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.role}
              </option>
            ))}
          </Select>
        </Field>
        <span className="sm:w-auto">
          <Button type="submit" loading={busy} disabled={!code.trim() || !userId} className="sm:w-auto sm:px-5">
            {t('link')}
          </Button>
        </span>
      </form>
    </section>
  );
}
