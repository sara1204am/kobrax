'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AccountInfo } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { useAccountForm } from './use-account-form';

/**
 * Los husos de América que conoce el navegador, con su corrimiento a la vista —
 * «La Paz (GMT-4)» se elige sin saberse el nombre IANA. Sin librería: `Intl` trae la lista
 * y el offset. En un navegador viejo sin `supportedValuesOf` la lista queda en el valor
 * actual + «según el país», que sigue siendo usable.
 */
function americanTimezones(pinned: (string | null)[]): { tz: string; label: string }[] {
  const intl = Intl as { supportedValuesOf?: (key: 'timeZone') => string[] };
  const all = (intl.supportedValuesOf?.('timeZone') ?? []).filter((tz) => tz.startsWith('America/'));
  // La guardada y la detectada entran aunque no sean de América (una zona europea guardada a
  // mano, o el botón de «este equipo» en una laptop de viaje): sin esto el select quedaría mudo.
  for (const tz of pinned) if (tz && !all.includes(tz)) all.push(tz);
  const offset = (tz: string) => {
    try {
      return (
        new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
          .formatToParts(new Date())
          .find((p) => p.type === 'timeZoneName')?.value ?? ''
      );
    } catch {
      return '';
    }
  };
  return all
    .map((tz) => ({
      tz,
      label: `${tz.replace(/^America\//, '').replaceAll('_', ' ')}${offset(tz) ? ` (${offset(tz)})` : ''}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Datos del negocio (pestaña General).
 *
 * Guarda sólo lo que cambió; el botón está apagado mientras no haya nada que guardar.
 */
export function GeneralForm({ account }: { account: AccountInfo }) {
  const t = useTranslations('account');
  const { form, setForm, error, saving, dirty, save, editable } = useAccountForm(account);

  const timezones = useMemo(
    () => americanTimezones([account.timezone, form.timezone]),
    [account.timezone, form.timezone],
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <ErrorBanner message={error} />

      <Section title={t('businessData')} inner="space-y-5 p-6">
      <Field label={t('businessName')}>
        <Input
          value={form.businessName}
          onChange={(e) => setForm({ ...form, businessName: e.target.value })}
          disabled={!editable}
          required
          minLength={2}
          maxLength={160}
        />
      </Field>

      <Field label={t('taxId')}>
        <Input
          value={form.taxId}
          onChange={(e) => setForm({ ...form, taxId: e.target.value })}
          disabled={!editable}
          maxLength={40}
          placeholder={t('taxIdPlaceholder')}
        />
      </Field>

      {/*
        La zona manda en cosas que duelen: cuándo un vencimiento «es hoy», la agenda, y el 1 del
        mes de los contadores del plan. El móvil la muestra y dice «se configura desde la web»
        (S1-D2) — este selector es esa promesa. `''` = según el país (el server cae a
        TZ_BY_COUNTRY), y viaja como `null`.
      */}
      <Field label={t('timezone')} hint={t('timezoneHint')}>
        <span className="flex gap-2">
          <span className="flex-1">
            <Select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              disabled={!editable}
            >
              <option value="">{t('timezoneAuto')}</option>
              {timezones.map(({ tz, label }) => (
                <option key={tz} value={tz}>
                  {label}
                </option>
              ))}
            </Select>
          </span>
          {/* La zona del navegador (`resolvedOptions`), sin permisos ni GPS: es la del sistema. */}
          {editable && (
            <button
              type="button"
              onClick={() => {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (tz) setForm({ ...form, timezone: tz });
              }}
              className="shrink-0 rounded-xl border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
            >
              {t('timezoneDetect')}
            </button>
          )}
        </span>
      </Field>

      {/*
        Lo personal —foto, teléfono, QR de cobro— vive en Mi perfil, no acá: es de la persona,
        no del negocio. Sin este puente, quien busca su QR abre Cuenta y no lo encuentra.
      */}
      <p className="border-t border-k-border pt-4 text-[13px] text-k-text-2">
        {t('profileHint')}{' '}
        <Link href="/settings/perfil" className="font-medium text-k-purple hover:underline">
          {t('profileLink')}
        </Link>
      </p>
      </Section>


      {editable && (
        <div className="flex justify-end">
          <span className="w-full sm:w-56">
            <Button type="submit" loading={saving} disabled={!dirty}>
              {t('save')}
            </Button>
          </span>
        </div>
      )}
    </form>
  );
}
