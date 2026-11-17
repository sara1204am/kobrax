'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/panel-ui';
import { SwitchRow } from '@/components/workspace-fields';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { LEGAL_PAGES, PAGE_OF_TYPE, type LegalOverview } from '@/lib/legal';

const LINK = 'font-medium text-k-purple underline-offset-2 hover:underline';

/**
 * Mi perfil › Privacidad: lo legal de la propia persona.
 *
 * - **Comunicaciones comerciales**: consentimiento opcional e independiente. Retirarlo es tan fácil como otorgarlo (un interruptor) y
 *   cada decisión deja una constancia nueva; el historial no se reescribe. Nunca afecta el acceso.
 * - **Documentos que aceptaste**: qué versión de cada documento aceptó y cuándo, con enlace a ESA versión exacta.
 *
 * Todo sale de la sesión: la API nunca recibe el id de la persona.
 */
export function PrivacyPanel({ overview }: { overview: LegalOverview }) {
  const t = useTranslations('privacy');
  const tDoc = useTranslations('legal.document');
  const toast = useToast();
  const [state, setState] = useState(overview);
  const [saving, setSaving] = useState(false);

  const marketing = state.consents.find((c) => c.purpose === 'MARKETING');
  const granted = marketing?.status === 'GRANTED';

  async function toggle(next: boolean) {
    setSaving(true);
    const res = await sendJson<LegalOverview>('/api/legal/consents/MARKETING', { granted: next }, 'PUT');
    setSaving(false);
    if (!res.ok) {
      toast(t('consents.error'));
      return;
    }
    setState(res.data);
    toast(t('consents.saved'));
  }

  return (
    <>
      <Section title={t('consents.title')} inner="px-5 py-1" description={t('consents.text')}>
        <SwitchRow
          id="consent-marketing"
          label={t('consents.marketing.label')}
          hint={
            marketing?.decided && marketing.recordedAt
              ? `${t('consents.marketing.hint')} ${t(granted ? 'consents.granted' : 'consents.withdrawn', { date: dateTime(marketing.recordedAt) })}`
              : `${t('consents.marketing.hint')} ${t('consents.never')}`
          }
          checked={granted}
          disabled={saving}
          onChange={(v) => void toggle(v)}
        />
      </Section>

      <Section title={t('documents.title')} inner="p-4" description={t('documents.text')}>
        {state.acceptances.length === 0 ? (
          <p className="text-k-sm text-k-text-2">{t('documents.empty')}</p>
        ) : (
          <ul className="divide-y divide-k-border">
            {state.acceptances.map((a) => {
              const page = PAGE_OF_TYPE[a.type];
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-k-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-k-text">
                      {a.title} · {t('documents.version', { version: a.version })}
                    </p>
                    <p className="text-k-text-2">
                      {t(a.action === 'ACCEPTED' ? 'documents.accepted' : 'documents.acknowledged')} · {dateTime(a.acceptedAt)} ·{' '}
                      {t.has(`documents.sources.${a.source}`) ? t(`documents.sources.${a.source}`) : a.source}
                    </p>
                  </div>
                  {page && (
                    <a href={`/${page}?v=${encodeURIComponent(a.version)}`} target="_blank" rel="noopener noreferrer" className={LINK}>
                      {t('documents.view')}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-k-sm">
          <span className="text-k-muted">{t('documents.current')}:</span>
          {(['terminos', 'privacidad', 'cookies'] as const).map((path) => (
            <a key={path} href={`/${path}`} target="_blank" rel="noopener noreferrer" className={LINK}>
              {tDoc(`names.${LEGAL_PAGES[path].key}`)}
            </a>
          ))}
        </p>
      </Section>

      {state.history.length > 0 && (
        <Section title={t('history.title')} inner="p-4">
          <ul className="space-y-1 text-k-sm text-k-text-2">
            {state.history.map((h) => (
              <li key={h.id}>
                {t(h.status === 'GRANTED' ? 'history.granted' : 'history.withdrawn')} · {dateTime(h.recordedAt)} ·{' '}
                {t.has(`documents.sources.${h.source}`) ? t(`documents.sources.${h.source}`) : h.source}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
