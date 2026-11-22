'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LATE_POLICY_LIMITS, formatDate, validateLatePolicy, type LatePolicyDayCount, type LatePolicyInfo, type LatePolicyInput } from '@kobrax/shared';
import { Input } from '@/components/ui';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { SwitchRow } from '@/components/workspace-fields';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { useSaveSection } from './save-bar';

interface Form {
  enabled: boolean;
  rate: string;
  dayCount: LatePolicyDayCount;
  grace: string;
  cap: string;
}

const formOf = (p: LatePolicyInfo): Form => ({
  enabled: p.kind === 'ANNUAL_RATE',
  rate: p.annualRate === null ? '' : String(p.annualRate),
  dayCount: p.dayCount ?? 365,
  grace: String(p.graceDays),
  cap: p.capPctOfPrincipal === null ? '' : String(p.capPctOfPrincipal),
});

/** «12,5» y «12.5» valen lo mismo; vacío es `undefined`; texto inválido es `NaN` (lo rechaza la validación). */
const numberOf = (s: string): number | undefined => {
  const t = s.trim().replace(',', '.');
  return t === '' ? undefined : Number(t);
};

/** El cuerpo a enviar. Apagado no lleva parámetros: así «sin cargos» es exactamente eso, no una tasa guardada y escondida. */
function inputOf(f: Form): LatePolicyInput {
  if (!f.enabled) return { kind: 'NONE' };
  return { kind: 'ANNUAL_RATE', annualRate: numberOf(f.rate), dayCount: f.dayCount, graceDays: numberOf(f.grace) ?? 0, capPctOfPrincipal: numberOf(f.cap) };
}

/**
 * Interés moratorio (pestaña Cobranza). **Apagado por defecto**: una cuenta nueva no cobra nada hasta que un administrador lo active acá.
 * Cada guardado crea una versión nueva de la política y solo la toman los créditos que se creen después (nada es retroactivo).
 */
export function LatePolicyForm({ policy }: { policy: LatePolicyInfo }) {
  const t = useTranslations('account.latePolicy');
  const tAccount = useTranslations('account');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const [initial, setInitial] = useState(() => formOf(policy));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const input = inputOf(form);
  const problem = validateLatePolicy(input);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const valid = problem === null;

  async function save(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    if (!valid) return false;
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<LatePolicyInfo>('/api/account/late-policy', input, 'PUT');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    setInitial(form);
    toast(t('saved'));
    router.refresh();
    return true;
  }

  const reset = () => {
    setForm(initial);
    setError(null);
  };
  const { managed } = useSaveSection('late-policy', { dirty, saving, valid, save, reset });

  const limits = { max: LATE_POLICY_LIMITS.maxAnnualRate };
  const errorOf = (...codes: NonNullable<typeof problem>[]) => (problem && codes.includes(problem) && dirty ? t(`errors.${problem}`, { max: problem === 'GRACE_RANGE' ? LATE_POLICY_LIMITS.maxGraceDays : problem === 'CAP_RANGE' ? LATE_POLICY_LIMITS.maxCapPct : limits.max }) : undefined);

  const when = policy.version > 0 ? formatDate(policy.effectiveFrom, locale) : '';
  const currentLine =
    policy.version === 0 || policy.kind === 'NONE' && policy.version === 1
      ? t('currentDefault')
      : policy.createdByName
        ? t('currentBy', { version: policy.version, date: when, by: policy.createdByName })
        : t('current', { version: policy.version, date: when });

  return (
    <form onSubmit={save} className="space-y-6">
      <ErrorBanner message={error} />

      <Section title={t('title')} description={t('description')} inner="space-y-5 p-6">
        <SwitchRow id="late-policy-enable" label={t('enable')} hint={t('enableHint')} checked={form.enabled} disabled={!editable} onChange={(enabled) => setForm({ ...form, enabled })} />

        {form.enabled && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('rate')} hint={t('rateHint', limits)} error={errorOf('RATE_REQUIRED', 'RATE_RANGE')} required>
              <Input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} disabled={!editable} placeholder="18" />
            </Field>
            <Field label={t('dayCount')} error={errorOf('DAYCOUNT')}>
              <Select value={String(form.dayCount)} onChange={(e) => setForm({ ...form, dayCount: Number(e.target.value) === 360 ? 360 : 365 })} disabled={!editable}>
                <option value="365">{t('dayCount365')}</option>
                <option value="360">{t('dayCount360')}</option>
              </Select>
            </Field>
            <Field label={t('grace')} hint={t('graceHint', { max: LATE_POLICY_LIMITS.maxGraceDays })} error={errorOf('GRACE_RANGE')}>
              <Input inputMode="numeric" value={form.grace} onChange={(e) => setForm({ ...form, grace: e.target.value })} disabled={!editable} placeholder="0" />
            </Field>
            <Field label={t('cap')} hint={t('capHint')} error={errorOf('CAP_RANGE')}>
              <Input inputMode="decimal" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} disabled={!editable} />
            </Field>
          </div>
        )}

        <p className="text-k-sm text-k-text-2">{t('notRetroactive')}</p>
        <p className="text-k-xs text-k-text-2">{currentLine}</p>
        {!editable && <p className="text-k-sm text-k-text-2">{t('readOnly')}</p>}
      </Section>

      {editable && !managed && (
        <div className="flex justify-end">
          <span className="w-full sm:w-56">
            <Button type="submit" loading={saving} disabled={!dirty || !valid}>
              {tAccount('save')}
            </Button>
          </span>
        </div>
      )}
    </form>
  );
}
