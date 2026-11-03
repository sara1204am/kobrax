'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  DEFAULT_PREFERENCES,
  diffPreferences,
  hasChanges,
  validatePreferences,
  type AccountInfo,
  type AccountPreferences,
} from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { useSaveSection } from './save-bar';

/** El nombre del día ISO (1 = lunes) en el idioma activo. El 1 de enero de 2024 fue lunes. */
function dayName(locale: string, isoDay: number): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, isoDay)));
}

/**
 * Preferencias de trabajo de la cuenta (pestaña Cobranza): días y horario laboral, con qué día empieza la semana y el
 * idioma con el que se abre el panel por defecto.
 *
 * Se guardan y se sirven ya; que cada módulo las respete (agenda, recordatorios, calendarios) se va sumando módulo a
 * módulo — la pantalla lo dice, para no prometer un efecto que todavía no tienen todas las pantallas.
 *
 * Manda sólo lo que cambió (`diffPreferences`) y la API mezcla con lo guardado.
 */
export function PreferencesForm({ account }: { account: AccountInfo }) {
  const t = useTranslations('account.preferences');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const [initial, setInitial] = useState<AccountPreferences>(() => account.preferences ?? DEFAULT_PREFERENCES);
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = diffPreferences(initial, prefs);
  const dirty = hasChanges(patch);
  const problem = validatePreferences(prefs);
  const days = useMemo(() => [1, 2, 3, 4, 5, 6, 7], []);

  async function save(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    if (problem) return false;
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson('/api/account/me', { preferences: patch }, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    setInitial(prefs);
    toast(t('saved'));
    router.refresh();
    return true;
  }

  const { managed } = useSaveSection('preferences', {
    dirty,
    saving,
    valid: problem === null,
    save,
    reset: () => {
      setPrefs(initial);
      setError(null);
    },
  });

  function toggleDay(day: number) {
    const next = prefs.workDays.includes(day) ? prefs.workDays.filter((d) => d !== day) : [...prefs.workDays, day];
    setPrefs({ ...prefs, workDays: next.sort((a, b) => a - b) });
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <ErrorBanner message={error} />
      <Section title={t('title')} inner="space-y-5 p-6">
        <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

        <fieldset disabled={!editable} className="space-y-2">
          <legend className="text-[14px] font-medium text-k-text">{t('workDays')}</legend>
          <div className="flex flex-wrap gap-2">
            {days.map((day) => {
              const on = prefs.workDays.includes(day);
              return (
                <label
                  key={day}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px] capitalize ${
                    on ? 'border-k-periwinkle bg-k-highlight text-k-navy' : 'border-k-border bg-white text-k-text-2'
                  }`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleDay(day)} />
                  {dayName(locale, day)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('workStart')}>
            <Input
              type="time"
              value={prefs.workStart}
              onChange={(e) => setPrefs({ ...prefs, workStart: e.target.value })}
              disabled={!editable}
              required
            />
          </Field>
          <Field label={t('workEnd')}>
            <Input
              type="time"
              value={prefs.workEnd}
              onChange={(e) => setPrefs({ ...prefs, workEnd: e.target.value })}
              disabled={!editable}
              required
            />
          </Field>
        </div>

        {problem && (
          <p role="alert" className="rounded-xl bg-k-danger-bg px-4 py-3 text-[13px] text-k-danger">
            {t(`problems.${problem}`)}
          </p>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('weekStart')}>
            <Select
              value={prefs.weekStart}
              onChange={(e) => setPrefs({ ...prefs, weekStart: e.target.value as AccountPreferences['weekStart'] })}
              disabled={!editable}
            >
              <option value="MON">{dayName(locale, 1)}</option>
              <option value="SUN">{dayName(locale, 7)}</option>
            </Select>
          </Field>
          <Field label={t('defaultLocale')} hint={t('defaultLocaleHint')}>
            <Select
              value={prefs.defaultLocale}
              onChange={(e) => setPrefs({ ...prefs, defaultLocale: e.target.value as AccountPreferences['defaultLocale'] })}
              disabled={!editable}
            >
              <option value="es">{t('locales.es')}</option>
              <option value="en">{t('locales.en')}</option>
            </Select>
          </Field>
        </div>

        <p className="text-[12px] text-k-muted">{t('scope')}</p>
      </Section>

      {editable && !managed && (
        <div className="flex justify-end">
          <span className="w-full sm:w-56">
            <Button type="submit" loading={saving} disabled={!dirty || problem !== null}>
              {t('save')}
            </Button>
          </span>
        </div>
      )}
    </form>
  );
}
