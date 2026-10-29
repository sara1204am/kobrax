'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AccountInfo } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { ImageUploadField } from '@/components/image-upload-field';
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
  // Lo guardado se ve en modo vista; «Editar» lo habilita y Cancelar/Guardar lo cierran.
  const { form, setForm, error, setError, saving, dirty, save, reset, editable: canEdit } = useAccountForm(account, 'general', {
    inline: true,
  });
  const [editing, setEditing] = useState(false);
  const editable = canEdit && editing;

  const timezones = useMemo(
    () => americanTimezones([account.timezone, form.timezone]),
    [account.timezone, form.timezone],
  );

  return (
    <form
      onSubmit={async (e) => {
        if (await save(e)) setEditing(false);
      }}
      className="space-y-6"
    >
      <ErrorBanner message={error} />

      <Section title={t('businessData')} description={t('businessDataHint')} inner="space-y-5 px-6 pb-6 pt-5">
        <div className="grid gap-5 md:grid-cols-3">
          <Field label={`${t('businessName')} *`}>
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
          <Field label={`${t('timezone')} *`} hint={t('timezoneHint')}>
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
        </div>

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

      <Section title={t('identity.title')} description={t('identity.subtitle')} inner="px-6 pb-6 pt-5">
        <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
          <ImageUploadField
            label={t('identity.logo')}
            hint={t('identity.logoHint')}
            value={form.logoUrl}
            onChange={(url) => setForm({ ...form, logoUrl: url })}
            onError={setError}
            disabled={!editable}
            readOnlyText={t('identity.logoReadOnly')}
            texts={{
              uploading: t('identity.uploading'),
              remove: t('identity.remove'),
              uploadError: t('identity.uploadError'),
              dropTitle: t('identity.dropTitle'),
              dropOr: t('identity.dropOr'),
            }}
          />

          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('identity.phone')} hint={t('identity.phoneHint')}>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  disabled={!editable}
                  minLength={5}
                  maxLength={32}
                  placeholder={t('identity.phonePlaceholder')}
                />
              </Field>
              <Field label={t('identity.email')}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={!editable}
                  maxLength={160}
                  placeholder={t('identity.emailPlaceholder')}
                />
              </Field>
            </div>

            <Field label={t('identity.website')} hint={t('identity.websiteHint')}>
              <Input
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                disabled={!editable}
                maxLength={200}
                placeholder="https://"
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label={t('identity.address')}>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              disabled={!editable}
              maxLength={240}
              placeholder={t('identity.phonePlaceholder')}
            />
          </Field>
          <Field label={t('identity.city')}>
            <Input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              disabled={!editable}
              maxLength={80}
              placeholder={t('identity.phonePlaceholder')}
            />
          </Field>
        </div>
      </Section>

      {canEdit && (
        <div className="flex justify-end gap-3 border-t border-k-border pt-5">
          {editing ? (
            <>
              <span className="w-full sm:w-36">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    reset();
                    setEditing(false);
                  }}
                >
                  {t('cancel')}
                </Button>
              </span>
              <span className="w-full sm:w-48">
                <Button type="submit" loading={saving} disabled={!dirty}>
                  {t('save')}
                </Button>
              </span>
            </>
          ) : (
            <span className="w-full sm:w-48">
              <Button type="button" onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            </span>
          )}
        </div>
      )}
    </form>
  );
}
