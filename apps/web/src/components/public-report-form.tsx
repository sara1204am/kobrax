'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input, Select, Textarea } from '@/components/ui';
import { postJson } from '@/lib/client';

/** Lo que una persona sin cuenta puede pedir. Debe coincidir con `PUBLIC_REPORT_TYPES` de la API (lista cerrada). */
export const PUBLIC_REPORT_TYPES = ['ABUSE_REPORT', 'ACCESS', 'RECTIFICATION', 'ERASURE', 'OBJECTION', 'OTHER'] as const;
export type PublicReportType = (typeof PUBLIC_REPORT_TYPES)[number] | 'ACCOUNT_DELETION';

/**
 * Formulario público (sin sesión). `mode="deletion"` es la web para pedir la eliminación de la cuenta (la exige Google Play): el motivo
 * va fijo y la descripción es opcional. `website` es una trampa para robots: va oculto y un formulario real lo deja vacío.
 */
export function PublicReportForm({ mode }: { mode: 'report' | 'deletion' }) {
  const t = useTranslations('report');
  const deletion = mode === 'deletion';
  const [type, setType] = useState<PublicReportType>(deletion ? 'ACCOUNT_DELETION' : 'ABUSE_REPORT');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const text = description.trim() || (deletion ? t('deletionDefault') : '');
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && text.length >= 10;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson<{ reference?: string }>('/api/public/reports', {
      type,
      contactEmail: email.trim(),
      contactName: name.trim(),
      reportedSubject: subject.trim(),
      description: text,
      website,
    });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    setReference((data as { reference?: string }).reference ?? 'recibido');
  }

  if (reference) {
    return (
      <div role="status" className="rounded-2xl border border-k-border bg-white px-6 py-6 shadow-k-card">
        <h2 className="text-[18px] font-semibold text-k-navy">{t('sentTitle')}</h2>
        <p className="mt-2 text-[14px] text-k-text-2">{t('sentBody')}</p>
        {reference !== 'recibido' && <p className="mt-3 text-[13px] text-k-muted">{t('reference', { code: reference })}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative space-y-4 rounded-2xl border border-k-border bg-white px-6 py-6 shadow-k-card">
      <ErrorBanner message={error} />
      {!deletion && (
        <Field label={t('type')}>
          <Select value={type} onChange={(e) => setType(e.target.value as PublicReportType)}>
            {PUBLIC_REPORT_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`types.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('email')} hint={t('emailHint')}>
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label={t('name')}>
        <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <Field label={deletion ? t('deletionSubject') : t('subject')} hint={deletion ? t('deletionSubjectHint') : t('subjectHint')}>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </Field>
      <Field label={deletion ? t('deletionDescription') : t('description')} hint={deletion ? t('deletionDescriptionHint') : t('descriptionHint')}>
        <Textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} required={!deletion} />
      </Field>
      {/* Trampa para robots: oculta a la vista y a los lectores de pantalla; una persona la deja vacía. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <p className="text-[12px] text-k-muted">{t('privacyNote')}</p>
      <Button type="submit" loading={loading} disabled={!valid}>
        {deletion ? t('submitDeletion') : t('submit')}
      </Button>
    </form>
  );
}
