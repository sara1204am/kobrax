'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  HIDEABLE_MODULES,
  OFFERED_FREQUENCIES,
  WORKSPACE_MODULES,
  WORKSPACE_PRESETS,
  emptyWorkspace,
  presetOf,
  resolveWorkspace,
  sameWorkspace,
  type AccountInfo,
  type Workspace,
  type WorkspaceModuleKey,
  type WorkspaceNavKey,
  type WorkspaceOptionKey,
  type WorkspacePresetKey,
} from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

type Draft = Pick<Workspace, 'hiddenModules' | 'options'>;
type SaveError =
  | { kind: 'conflict'; reason: 'REV' | 'VERSION' }
  | { kind: 'blocked'; blocks: { module: string; reason: string; count: number }[] }
  | { kind: 'invalid' }
  | { kind: 'generic'; message?: string };

const PRESET_KEYS: WorkspacePresetKey[] = ['independent', 'team', 'complete'];
const CLIENT_OPTIONS = [
  'client.income',
  'client.guarantors',
  'client.collateral',
  'client.attachments',
  'client.gender',
  'client.preferredChannel',
] as const;
const CLIENT_I18N: Record<(typeof CLIENT_OPTIONS)[number], string> = {
  'client.income': 'income',
  'client.guarantors': 'guarantors',
  'client.collateral': 'collateral',
  'client.attachments': 'attachments',
  'client.gender': 'gender',
  'client.preferredChannel': 'preferredChannel',
};

const draftOf = (w: Workspace): Draft => ({
  hiddenModules: [...w.hiddenModules],
  options: { ...w.options },
});

/** Una fila «etiqueta + explicación + interruptor». El interruptor es un checkbox con rol `switch`: se opera con teclado y lector de pantalla. */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-[44px] items-center gap-4 border-t border-k-border py-3 first:border-t-0 ${disabled ? 'opacity-70' : 'cursor-pointer'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-k-text">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[13px] leading-snug text-k-text-2">{hint}</span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-k-navy"
      />
    </label>
  );
}

/**
 * Cuenta › Espacio de trabajo (F15 · P4): qué ve esta organización. Solo quita (R1); no toca permisos, planes ni datos.
 *
 * El formulario trabaja sobre un borrador y guarda UN documento con el `rev` que leyó: si otra persona guardó antes, el servidor
 * responde 409 y la pantalla pide recargar en vez de pisar. Las salvaguardas (una sola persona para ocultar Equipo o Actividad, una
 * oficina para Organización, sin rutas en curso) las aplica el servidor; aquí se anticipan con lo que ya sabe `usage`.
 */
export function WorkspaceEditor({ account }: { account: AccountInfo }) {
  const t = useTranslations('account.workspace');
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
  const preset = presetOf(draft);
  const shownMenu = resolveWorkspace({ ...base, ...draft }).visibleNavKeys();

  /** Lo que el servidor no dejaría ocultar hoy, anticipado: solo se bloquea lo que ahora se ve (volver a mostrar nunca se bloquea). */
  const blockedBy = (key: WorkspaceModuleKey): 'members' | 'offices' | null => {
    if (base.hiddenModules.includes(key)) return null;
    if ((key === 'team' || key === 'activity') && members > 1) return 'members';
    if (key === 'organization' && offices > 1) return 'offices';
    return null;
  };

  const isShown = (key: WorkspaceOptionKey) => draft.options[key] !== false;
  const setOption = (key: WorkspaceOptionKey, value: boolean | string | string[] | undefined) => {
    const options = { ...draft.options };
    if (value === undefined) delete options[key];
    else options[key] = value;
    setDraft({ ...draft, options });
  };
  const setShown = (key: WorkspaceOptionKey, shown: boolean) =>
    setOption(key, shown ? undefined : false);
  const moduleShown = (key: WorkspaceModuleKey) => !draft.hiddenModules.includes(key);
  const setModule = (key: WorkspaceModuleKey, shown: boolean) => {
    const rest = draft.hiddenModules.filter((k) => k !== key);
    setDraft({
      ...draft,
      hiddenModules: shown ? rest : HIDEABLE_MODULES.filter((k) => k === key || rest.includes(k)),
    });
  };

  const allowedFrequencies = (draft.options['credit.frequencies'] as string[] | undefined) ?? [
    ...OFFERED_FREQUENCIES,
  ];
  const toggleFrequency = (frequency: string, on: boolean) => {
    const next = OFFERED_FREQUENCIES.filter((f) =>
      f === frequency ? on : allowedFrequencies.includes(f),
    );
    if (next.length === 0) return; // siempre al menos una (S-4)
    setOption('credit.frequencies', next.length === OFFERED_FREQUENCIES.length ? undefined : next);
  };

  function applyPreset(key: WorkspacePresetKey) {
    const p = WORKSPACE_PRESETS[key];
    // Lo que el servidor no dejaría ocultar hoy se deja visible: el preset no puede pedir un guardado que va a rebotar.
    const hiddenModules = p.hiddenModules.filter((m) => blockedBy(m) === null);
    setDraft({ hiddenModules, options: { ...p.options } });
    setError(null);
  }

  async function save() {
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<AccountInfo>(
      '/api/account/me',
      { workspace: { version: 1, rev: base.rev, ...draft } },
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

  const locked = WORKSPACE_MODULES.filter((m) => m.core);

  return (
    <div className="space-y-5">
      <p className="max-w-[720px] text-[14px] leading-relaxed text-k-text-2">{t('intro')}</p>

      <Section title={t('presets.title')} inner="p-4">
        <div className="flex flex-wrap gap-3">
          {PRESET_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={preset === key}
              onClick={() => applyPreset(key)}
              className={`min-h-[44px] flex-1 basis-[220px] rounded-xl border px-4 py-3 text-left ${
                preset === key
                  ? 'border-k-navy bg-k-highlight'
                  : 'border-k-border bg-white hover:bg-k-bg'
              }`}
            >
              <span className="block text-[15px] font-semibold text-k-navy">
                {t(`presets.${key}.title`)}
              </span>
              <span className="mt-1 block text-[13px] leading-snug text-k-text-2">
                {t(`presets.${key}.text`)}
              </span>
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <p className="mt-3 text-[13px] text-k-text-2">{t('presets.custom')}</p>
        )}
      </Section>

      <Section title={t('modules.title')} inner="p-5">
        <p className="mb-2 text-[13px] text-k-text-2">{t('modules.text')}</p>
        {HIDEABLE_MODULES.map((key) => {
          const why = blockedBy(key);
          return (
            <SwitchRow
              key={key}
              label={tNav(key)}
              hint={
                why
                  ? t(`blocked.${why}`, { count: why === 'members' ? members : offices })
                  : t(`modules.hints.${key}`)
              }
              checked={moduleShown(key)}
              disabled={why !== null}
              onChange={(shown) => setModule(key, shown)}
            />
          );
        })}
        <div className="mt-3 border-t border-k-border pt-4">
          <p className="mb-2 text-[13px] font-semibold text-k-text">{t('locked.title')}</p>
          <ul className="flex flex-wrap gap-2">
            {locked.map((m) => (
              <li key={m.key} className="rounded-full bg-k-bg px-3 py-1 text-[13px] text-k-text-2">
                {tNav(m.key as WorkspaceNavKey)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-k-text-2">{t('locked.text')}</p>
        </div>
      </Section>

      <Section title={t('credit.title')} inner="p-5">
        <p className="mb-2 text-[13px] text-k-text-2">{t('credit.text')}</p>
        <SwitchRow
          label={t('credit.fixed.label')}
          hint={t('credit.fixed.hint')}
          checked={draft.options['credit.definition'] === 'agreed_installment'}
          onChange={(on) => setOption('credit.definition', on ? 'agreed_installment' : undefined)}
        />
        <SwitchRow
          label={t('credit.advanced.label')}
          hint={t('credit.advanced.hint')}
          checked={isShown('credit.advanced')}
          onChange={(on) => setShown('credit.advanced', on)}
        />
        <SwitchRow
          label={t('credit.arrears.label')}
          hint={t('credit.arrears.hint')}
          checked={isShown('credit.arrearsMethod')}
          onChange={(on) => setShown('credit.arrearsMethod', on)}
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

      <Section title={t('client.title')} inner="p-5">
        <p className="mb-2 text-[13px] text-k-text-2">{t('client.text')}</p>
        {CLIENT_OPTIONS.map((key) => (
          <SwitchRow
            key={key}
            label={t(`client.${CLIENT_I18N[key]}.label`)}
            hint={t(`client.${CLIENT_I18N[key]}.hint`)}
            checked={isShown(key)}
            onChange={(on) => setShown(key, on)}
          />
        ))}
        <p className="mt-3 rounded-lg bg-k-highlight px-4 py-3 text-[13px] leading-relaxed text-k-navy">
          {t('client.keepNote')}
        </p>
      </Section>

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
          onClick={() => applyPreset('complete')}
          disabled={saving || (presetOf(draft) === 'complete' && !dirty)}
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
