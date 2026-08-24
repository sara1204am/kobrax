'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  COUNTRY_CURRENCIES,
  diffAccount,
  hasChanges,
  type AccountForm,
  type AccountInfo,
} from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

const formOf = (a: AccountInfo): AccountForm => ({
  businessName: a.businessName,
  taxId: a.taxId ?? '',
  countryCode: a.countryCode,
  currencyCode: a.currencyCode,
  timezone: a.timezone ?? '',
  currencyDecimals: String(a.currencyDecimals ?? 2),
});

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
 * Datos del negocio.
 *
 * Guarda **sólo lo que cambió** (`diffAccount` de `shared`): la API corre con
 * `forbidNonWhitelisted: true` y reenviar el objeto del `GET` sería un 400. De paso, el botón
 * está apagado mientras no haya nada que guardar — la regla se ve en pantalla.
 */
export function BusinessForm({ account }: { account: AccountInfo }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('account');
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const [initial, setInitial] = useState(() => formOf(account));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // El nombre del país lo pone el navegador en el idioma activo. `shared` guarda la regla
  // (qué países y con qué moneda), no cómo se escriben.
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return COUNTRY_CURRENCIES.map((c) => ({ ...c, name: names.of(c.code) ?? c.code })).sort((a, b) =>
      a.name.localeCompare(b.name, locale),
    );
  }, [locale]);

  const timezones = useMemo(
    () => americanTimezones([account.timezone, form.timezone]),
    [account.timezone, form.timezone],
  );

  const patch = diffAccount(initial, form);
  const dirty = hasChanges(patch);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<AccountInfo>('/api/account/me', patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    setInitial(form);
    toast(t('saved'));
    // El nombre del negocio también vive en el selector de empresa de la topbar, que lo pintó
    // el servidor: sin refrescar, el panel sigue mostrando el viejo.
    router.refresh();
  }

  // El monto de muestra de cada opción de decimales, en la moneda que la cuenta tiene puesta:
  // «2 decimales · Bs 1.250,50» se elige sin explicación.
  const ejemplo = (d: number) => {
    try {
      return new Intl.NumberFormat('es-BO', {
        style: 'currency',
        currency: form.currencyCode || 'BOB',
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(1250.5);
    } catch {
      return '';
    }
  };

  return (
    // Un solo <form> y un solo Guardar para las dos secciones: es el mismo PATCH, y dos botones
    // serían dos maneras de perder la mitad de los cambios.
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

      <Section title={t('financialData')} inner="space-y-5 p-6">
      {/*
        País y moneda son UN campo: van acoplados (decisión S1-D1 del móvil) y por eso no se
        pueden combinar mal. `<select>` nativo — no hay dropdown que valga la pena escribir
        para seis opciones.
      */}
      <Field label={t('country')}>
        <Select
          value={form.countryCode}
          onChange={(e) => {
            const picked = countries.find((c) => c.code === e.target.value);
            if (picked) setForm({ ...form, countryCode: picked.code, currencyCode: picked.currency });
          }}
          disabled={!editable}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} · {c.currency} ({c.symbol})
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('decimals')} hint={t('decimalsHint')}>
        <Select
          value={form.currencyDecimals}
          onChange={(e) => setForm({ ...form, currencyDecimals: e.target.value })}
          disabled={!editable}
        >
          {[2, 1, 0].map((d) => (
            <option key={d} value={String(d)}>
              {t('decimalsValue', { n: d })} · {ejemplo(d)}
            </option>
          ))}
        </Select>
      </Field>
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
