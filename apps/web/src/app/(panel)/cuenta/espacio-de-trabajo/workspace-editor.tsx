'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CreditDefinition,
  OFFERED_FREQUENCIES,
  WORKSPACE_MODULES,
  emptyWorkspace,
  resolveWorkspace,
  sameWorkspace,
  type AccountInfo,
  type Workspace,
  type WorkspaceModuleKey,
  type WorkspaceNavKey,
  type WorkspaceOptionKey,
} from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { Button } from '@/components/ui';
import { ChoiceCard, SwitchRow } from '@/components/workspace-fields';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import {
  applyPlanGatesTo,
  blockedModules,
  creditDefinitionOf,
  draftOf,
  gatedModules,
  isModuleShown,
  isOptionShown,
  presetDraft,
  setAdvancedCredit,
  setCreditDefinition,
  setModuleShown,
  setOptionShown,
  setTeamWork,
  type Draft,
} from '@/lib/onboarding-wizard';

type SaveError =
  | { kind: 'conflict'; reason: 'REV' | 'VERSION' }
  | { kind: 'blocked'; blocks: { module: string; reason: string; count: number }[] }
  | { kind: 'plan' }
  | { kind: 'invalid' }
  | { kind: 'generic'; message?: string };

const DEFINITIONS = [
  CreditDefinition.AGREED_INSTALLMENT,
  CreditDefinition.AGREED_TOTAL,
  CreditDefinition.CALCULATED,
] as const;

/** Las mismas secciones y el mismo orden que el asistente de configuración (`OnboardingWizard`). */
const CLIENT_CORE: WorkspaceOptionKey[] = [
  'client.income',
  'client.guarantors',
  'client.collateral',
  'client.attachments',
];
const CLIENT_OPTIONAL: WorkspaceOptionKey[] = ['client.preferredChannel', 'client.gender'];
const clientKey = (k: WorkspaceOptionKey) => k.split('.')[1]!;
const TOOLS: WorkspaceModuleKey[] = ['routes', 'import', 'export'];

/**
 * Cuenta › Espacio de trabajo (F15 · P4): qué ve esta organización. Solo quita (R1); no toca permisos, planes ni datos.
 *
 * El formulario trabaja sobre un borrador y guarda UN documento con el `rev` que leyó: si otra persona guardó antes, el servidor
 * responde 409 y la pantalla pide recargar en vez de pisar. Las salvaguardas (una sola persona para ocultar Equipo o Actividad, una
 * oficina para Organización, sin rutas en curso) las aplica el servidor; aquí se anticipan con lo que ya sabe `usage`.
 */
export function WorkspaceEditor({ account }: { account: AccountInfo }) {
  const t = useTranslations('account.workspace');
  const to = useTranslations('onboarding');
  const tc = useTranslations('account.workspace.client');
  const tNav = useTranslations('panel.nav');
  const tp = useTranslations('portfolio');
  const router = useRouter();
  const toast = useToast();

  const [base, setBase] = useState<Workspace>(() => account.workspace ?? emptyWorkspace());
  const [draft, setDraft] = useState<Draft>(() => draftOf(base));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);

  const members = account.usage?.users ?? 1;
  const offices = account.usage?.branches ?? 1;
  const dirty = !sameWorkspace(draft, base);
  const shownMenu = resolveWorkspace({ ...base, ...draft }).visibleNavKeys();

  /** Lo que el servidor no dejaría ocultar hoy: solo se bloquea lo que ahora se ve (volver a mostrar nunca se bloquea). */
  const blocked = useMemo(() => {
    const all = blockedModules(account.usage);
    return new Set([...all].filter((m) => !base.hiddenModules.includes(m)));
  }, [account.usage, base.hiddenModules]);
  /** Lo que el plan no puede usar (un solo asiento, una sola oficina): no se ofrece y siempre queda oculto. */
  const gated = useMemo(() => gatedModules(account.limits, blocked), [account.limits, blocked]);
  const withGates = (d: Draft): Draft => applyPlanGatesTo(d, gated);
  const hasTeam = !gated.has('team');
  const hasOffices = !gated.has('organization');

  const blockedHint = (m: WorkspaceModuleKey, fallback: string) => {
    if (!blocked.has(m)) return fallback;
    if (m === 'organization') return t('blocked.offices', { count: offices });
    if (m === 'team') return t('blocked.members', { count: members });
    return to('tools.inUse');
  };

  const allowedFrequencies = (draft.options['credit.frequencies'] as string[] | undefined) ?? [
    ...OFFERED_FREQUENCIES,
  ];
  const toggleFrequency = (frequency: string, on: boolean) => {
    const next = OFFERED_FREQUENCIES.filter((f) =>
      f === frequency ? on : allowedFrequencies.includes(f),
    );
    if (next.length === 0) return; // siempre al menos una (S-4)
    const options = { ...draft.options };
    if (next.length === OFFERED_FREQUENCIES.length) delete options['credit.frequencies'];
    else options['credit.frequencies'] = next;
    setDraft({ ...draft, options });
  };

  function resetToComplete() {
    setDraft(withGates(presetDraft('complete', blocked)));
    setError(null);
  }

  async function save() {
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<AccountInfo>(
      '/api/account/me',
      { workspace: { version: 1, rev: base.rev, ...withGates(draft) } },
      'PATCH',
    );
    setSaving(false);
    if (!ok) {
      const e = data.error as
        | {
            code?: string;
            message?: string;
            details?: {
              reason?: 'REV' | 'VERSION';
              blocks?: { module: string; reason: string; count: number }[];
            };
          }
        | undefined;
      if (e?.code === 'WORKSPACE_CONFLICT')
        setError({ kind: 'conflict', reason: e.details?.reason ?? 'REV' });
      else if (e?.code === 'WORKSPACE_BLOCKED')
        setError({ kind: 'blocked', blocks: e.details?.blocks ?? [] });
      else if (e?.code === 'WORKSPACE_PLAN_GATED') setError({ kind: 'plan' });
      else if (e?.code === 'WORKSPACE_INVALID') setError({ kind: 'invalid' });
      else setError({ kind: 'generic', message: e?.message });
      return;
    }
    const saved = data.workspace ?? { ...base, ...draft, rev: base.rev + 1 };
    setBase(saved);
    setDraft(draftOf(saved));
    toast(t('saved'));
    // El menú, los avisos y las pantallas leen el workspace del layout: sin refrescar siguen mostrando el viejo.
    router.refresh();
  }

  const moduleRow = (m: WorkspaceModuleKey) => (
    <SwitchRow
      key={m}
      id={`tool-${m}`}
      label={to(`tools.items.${m}.label`)}
      hint={blockedHint(m, to(`tools.items.${m}.hint`))}
      checked={isModuleShown(draft, m)}
      disabled={blocked.has(m)}
      onChange={(v) =>
        setDraft(
          m === 'team'
            ? setTeamWork(draft, v, blocked, gated)
            : setModuleShown(draft, m, v, blocked, gated),
        )
      }
    />
  );
  const clientRow = (k: WorkspaceOptionKey) => (
    <SwitchRow
      key={k}
      id={`client-${clientKey(k)}`}
      label={tc(`${clientKey(k)}.label`)}
      hint={tc(`${clientKey(k)}.hint`)}
      checked={isOptionShown(draft, k)}
      onChange={(v) => setDraft(setOptionShown(draft, k, v))}
    />
  );
  const definition = creditDefinitionOf(draft);

  return (
    <div className="space-y-5">
      <p className="max-w-[720px] text-[14px] leading-relaxed text-k-text-2">{t('intro')}</p>

      <h2 className="text-[18px] font-semibold text-k-navy">{to('tools.title')}</h2>
      <Section title={to('tools.tools')} inner="px-5 py-1">
        {TOOLS.map(moduleRow)}
      </Section>
      {hasTeam && (
        <Section title={to('tools.team')} inner="px-5 py-1">
          {moduleRow('team')}
          {hasOffices && moduleRow('organization')}
        </Section>
      )}
      <p className="text-[13px] text-k-text-2">{to('tools.always')}</p>

      <div>
        <h2 className="text-[18px] font-semibold text-k-navy">{to('clients.title')}</h2>
        <p className="mt-1 text-[13px] text-k-text-2">{to('clients.intro')}</p>
      </div>
      <Section title={to('clients.core')} inner="px-5 py-1">
        {CLIENT_CORE.map(clientRow)}
      </Section>
      <Section title={to('clients.optional')} inner="px-5 py-1">
        {CLIENT_OPTIONAL.map(clientRow)}
      </Section>
      <p className="text-[13px] text-k-text-2">{to('clients.note')}</p>

      <div>
        <h2 className="text-[18px] font-semibold text-k-navy">{to('credits.title')}</h2>
        <p className="mt-1 text-[13px] text-k-text-2">{to('credits.intro')}</p>
      </div>
      <Section title={to('credits.definition')} inner="p-4">
        <div role="radiogroup" aria-label={to('credits.definition')} className="space-y-2">
          {[...DEFINITIONS, null].map((d) => {
            const value = d as string | null;
            const key = value ?? 'choose';
            return (
              <ChoiceCard
                key={key}
                name={to(`credits.definitions.${key}.name`)}
                description={to(`credits.definitions.${key}.desc`)}
                checked={definition === value}
                onSelect={() => setDraft(setCreditDefinition(draft, value))}
              />
            );
          })}
        </div>
      </Section>
      <Section title={to('credits.more')} inner="px-5 py-1">
        <SwitchRow
          id="credit-advanced"
          label={to('credits.advanced')}
          hint={to('credits.advancedHint')}
          checked={isOptionShown(draft, 'credit.advanced')}
          onChange={(v) => setDraft(setAdvancedCredit(draft, v))}
        />
        <fieldset className="border-t border-k-border py-3">
          <legend className="text-[14px] font-semibold text-k-text">
            {t('credit.frequencies.label')}
          </legend>
          <p className="mt-0.5 text-[13px] text-k-text-2">{t('credit.frequencies.hint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {OFFERED_FREQUENCIES.map((f) => (
              <label
                key={f}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-k-border px-3 text-[13px] text-k-text"
              >
                <input
                  type="checkbox"
                  checked={allowedFrequencies.includes(f)}
                  // La última no se puede quitar (siempre queda al menos una): se ve bloqueada en vez de «no hacer nada».
                  disabled={allowedFrequencies.length === 1 && allowedFrequencies.includes(f)}
                  onChange={(e) => toggleFrequency(f, e.target.checked)}
                />
                {tp(`frequency.${f}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <p className="rounded-xl border border-k-success bg-k-success-bg px-4 py-3 text-[13px] text-k-text">
        {to('summary.guarantee')}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-[14px] text-k-warning-text"
        >
          {error.kind === 'conflict' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>{error.reason === 'VERSION' ? t('errors.version') : t('errors.conflict')}</p>
              {error.reason === 'REV' && (
                <Button type="button" variant="ghost" onClick={() => router.refresh()}>
                  {t('errors.reload')}
                </Button>
              )}
            </div>
          )}
          {error.kind === 'blocked' && (
            <div>
              <p className="font-semibold">{t('errors.blocked')}</p>
              <ul className="mt-1 list-disc pl-5">
                {error.blocks.map((b) => (
                  <li key={`${b.module}-${b.reason}`}>
                    {t(
                      b.reason === 'OFFICES'
                        ? 'errors.blockedOffices'
                        : b.reason === 'ROUTES_IN_PROGRESS'
                          ? 'errors.blockedRoutes'
                          : 'errors.blockedMembers',
                      { module: tNav(b.module as WorkspaceNavKey), count: b.count },
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error.kind === 'plan' && <p>{t('errors.plan')}</p>}
          {error.kind === 'invalid' && <p>{t('errors.invalid')}</p>}
          {error.kind === 'generic' && <p>{error.message ?? t('errors.generic')}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-k-border bg-white px-5 py-4">
        <p className="min-w-[200px] flex-1 text-[14px] text-k-text-2">
          <span className="font-semibold text-k-text">
            {t('menuPreview', { shown: shownMenu.length, total: WORKSPACE_MODULES.length })}.
          </span>{' '}
          {dirty ? t('actions.unsaved') : t('actions.clean')}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={resetToComplete}
          disabled={saving}
        >
          {t('actions.reset')}
        </Button>
        <Button type="button" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </div>
  );
}
