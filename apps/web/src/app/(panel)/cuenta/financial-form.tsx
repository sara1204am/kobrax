'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrearsMethod, COUNTRY_CURRENCIES, type AccountInfo } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { useAccountForm } from './use-account-form';

/**
 * Configuración financiera (pestaña Cobranza): país y moneda, decimales y cómo se cuenta la mora.
 * Mismo `PATCH /accounts/me` que General, con su propio estado.
 */
export function FinancialForm({ account }: { account: AccountInfo }) {
  const locale = useLocale();
  const t = useTranslations('account');
  const { form, setForm, error, saving, dirty, save, editable } = useAccountForm(account);

  // El nombre del país lo pone el navegador en el idioma activo. `shared` guarda la regla
  // (qué países y con qué moneda), no cómo se escriben.
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return COUNTRY_CURRENCIES.map((c) => ({ ...c, name: names.of(c.code) ?? c.code })).sort((a, b) =>
      a.name.localeCompare(b.name, locale),
    );
  }, [locale]);

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
    <form onSubmit={save} className="space-y-6">
      <ErrorBanner message={error} />

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

      {/* D20: viene preseleccionado en el alta de cada crédito; cada crédito guarda el suyo. */}
      <Field label={t('arrearsMethod')} hint={t('arrearsMethodHint')}>
        <Select
          value={form.arrearsMethod}
          onChange={(e) => setForm({ ...form, arrearsMethod: e.target.value })}
          disabled={!editable}
        >
          {Object.values(ArrearsMethod).map((m) => (
            <option key={m} value={m}>
              {t(`arrearsMethods.${m}`)}
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
