'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CreditDefinition,
  HIDEABLE_MODULES,
  WORKSPACE_MODULES,
  emptyWorkspace,
  recommendSetup,
  resolveWorkspace,
  type AccountInfo,
  type WorkspaceModuleKey,
  type WorkspaceNavKey,
  type WorkspaceOptionKey,
  type WorkspacePresetKey,
} from '@kobrax/shared';
import { sendJson } from '@/lib/client';
import {
  SKIPPABLE_STEPS,
  SKIP_BODY,
  WIZARD_STEPS,
  blockedModules,
  changesFromComplete,
  creditDefinitionOf,
  draftOf,
  failureOf,
  isModuleShown,
  isOptionShown,
  presetDraft,
  saveBody,
  setAdvancedCredit,
  setCreditDefinition,
  setModuleShown,
  setOptionShown,
  setTeamWork,
  type Draft,
  type SaveFailure,
  type WizardStep,
} from '@/lib/onboarding-wizard';
import { Button, Switch } from '@/components/ui';
import { startTour } from '@/components/tour';

const PRESET_ORDER: WorkspacePresetKey[] = ['independent', 'team', 'complete'];
const CLIENT_SECTIONS: WorkspaceOptionKey[] = [
  'client.income',
  'client.guarantors',
  'client.collateral',
  'client.attachments',
  'client.gender',
  'client.preferredChannel',
];
const DEFINITIONS = [
  CreditDefinition.AGREED_INSTALLMENT,
  CreditDefinition.AGREED_TOTAL,
  CreditDefinition.CALCULATED,
] as const;

/** Una fila «texto + interruptor» con su descripción. */
function Row({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-k-border bg-white px-4 py-3">
      <div className="min-w-0">
        <p id={id} className="text-[14px] font-medium text-k-text">
          {label}
        </p>
        {hint && <p className="text-[13px] text-k-text-2">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} aria-labelledby={id} />
    </div>
  );
}

/**
 * Asistente de configuración (F15 · P7, D-11): 8 pasos, en pantalla completa, para quien administra una cuenta nueva.
 *
 * - **Nada se escribe hasta el paso 7**: el borrador vive en memoria y se guarda en UNA llamada (`workspace` + `onboarding` con
 *   `rev`). Cerrar a la mitad no deja una configuración a medias.
 * - Cerrar con la X (o Esc) equivale a «Hacerlo después»: la cuenta queda como estaba y el asistente no vuelve solo.
 * - «Usar la configuración recomendada y terminar» está en cada paso. Nunca bloquea el uso de la aplicación.
 * - No cambia permisos, planes ni datos: solo qué se muestra (ocultar no es autorizar).
 */
/** Mantiene el Tab dentro del diálogo: el panel de atrás no es alcanzable mientras el asistente está abierto. */
function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
  const root = e.currentTarget;
  const focusable = [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled])',
    ),
  ];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  const atStart = active === first || active === root || active?.id === 'onboarding-title';
  if (e.shiftKey && atStart) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export function OnboardingWizard({
  account,
  onClose,
}: {
  account: AccountInfo;
  onClose?: () => void;
}) {
  const t = useTranslations('onboarding');
  const tourT = useTranslations('tour');
  const nav = useTranslations('panel.nav');
  const router = useRouter();
  const base = account.workspace ?? emptyWorkspace();
  const blocked = useMemo(() => blockedModules(account.usage), [account.usage]);
  const recommendation = useMemo(
    () => recommendSetup({ planCode: account.planCode }),
    [account.planCode],
  );
  const reasonKey = recommendation.reason.replace('onboarding.recommend.', '');

  const [step, setStep] = useState<WizardStep>('welcome');
  const [draft, setDraft] = useState<Draft>(() => draftOf(base));
  // El punto de partida que la persona tocó en el paso 1 (null = no tocó ninguno): el atajo «recomendada» respeta su elección.
  const [picked, setPicked] = useState<WorkspacePresetKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const index = WIZARD_STEPS.indexOf(step);
  const counted = WIZARD_STEPS.length; // «Paso n de 8»

  // El foco va al título de cada paso: quien navega con teclado o lector de pantalla se entera del cambio.
  useEffect(() => titleRef.current?.focus(), [step]);

  const go = (to: WizardStep) => {
    setFailure(null);
    setStep(to);
  };
  const next = () => go(WIZARD_STEPS[Math.min(index + 1, counted - 1)]!);
  const back = () => go(WIZARD_STEPS[Math.max(index - 1, 0)]!);

  async function finish(body: object, to: WizardStep | null) {
    setSaving(true);
    setFailure(null);
    const res = await sendJson<AccountInfo>('/api/account/me', body, 'PATCH');
    setSaving(false);
    if (!res.ok) return setFailure(failureOf(res.data));
    if (to) setStep(to);
    else await leave();
  }

  /** Sale del asistente y vuelve a pedir la sesión: el layout ya no lo monta (estado `done`/`skipped`). */
  async function leave(thenTour = false) {
    // Quien configuró la cuenta ya conoce el espacio: no hace falta darle además la tarjeta de bienvenida. Se espera el
    // guardado antes de refrescar: si no, el panel podría leer el estado viejo y mostrársela igual.
    if (!onClose) await sendJson('/api/users/me/guides', { welcomeSeen: true }, 'PATCH');
    onClose?.();
    router.refresh();
    if (thenTour) startTour();
  }

  // Abierto desde Cuenta (`onClose`) cerrar no resuelve nada; montado por el panel, «después» marca el asistente como omitido.
  const later = () => (onClose ? onClose() : finish(SKIP_BODY, null));
  const applyRecommended = () =>
    finish(saveBody(base, presetDraft(picked ?? recommendation.preset, blocked)), 'done');
  const confirm = () => finish(saveBody(base, draft), 'done');

  const diff = changesFromComplete(draft);
  const shownKeys = resolveWorkspace({
    ...base,
    hiddenModules: draft.hiddenModules as WorkspaceModuleKey[],
  }).visibleNavKeys();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-k-bg"
      onKeyDown={(e) => {
        // Esc solo sale en el primer paso, donde todavía no hay nada elegido: más adelante descartaría el borrador sin avisar.
        if (e.key === 'Escape' && !saving && step === 'welcome') void later();
        if (e.key === 'Tab') trapFocus(e);
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-k-border bg-white px-5 py-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-k-muted">
            {t('title')}
          </p>
          <p className="text-[13px] text-k-text-2" aria-live="polite">
            {t('progress', { n: index + 1, total: counted })}
          </p>
        </div>
        {step !== 'done' && (
          <button
            type="button"
            onClick={() => void later()}
            disabled={saving}
            aria-label={t('later')}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            {t('later')} ✕
          </button>
        )}
      </header>

      <div className="h-1 bg-k-light-bg" aria-hidden>
        <div
          className="h-1 bg-k-periwinkle transition-all"
          style={{ width: `${((index + 1) / counted) * 100}%` }}
        />
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
        <h1
          id="onboarding-title"
          ref={titleRef}
          tabIndex={-1}
          className="mb-1 text-[22px] font-semibold text-k-navy outline-none"
        >
          {t(`${step}.title`)}
        </h1>
        <p className="mb-6 text-[14px] text-k-text-2">{t(`${step}.intro`)}</p>

        {failure && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-k-danger bg-k-danger-bg px-4 py-3 text-[13px] text-k-danger"
          >
            {t(`errors.${failure}`)}
            {failure === 'conflict' && (
              <button
                type="button"
                onClick={() => router.refresh()}
                className="ml-2 font-medium underline"
              >
                {t('errors.reload')}
              </button>
            )}
          </div>
        )}

        {step === 'welcome' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-k-periwinkle bg-k-highlight px-4 py-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-k-purple">
                {t('welcome.recommended')}
              </p>
              <p className="text-[16px] font-semibold text-k-navy">
                {t(`presets.${recommendation.preset}.name`)}
              </p>
              <p className="text-[13px] text-k-text-2">{t(`welcome.reason.${reasonKey}`)}</p>
            </div>
            <p className="text-[13px] text-k-text-2">{t('welcome.reassure')}</p>
            <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={t('welcome.pick')}>
              {PRESET_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPicked(p);
                    setDraft(presetDraft(p, blocked));
                  }}
                  aria-pressed={picked === p}
                  className={`rounded-xl border px-3 py-3 text-left hover:border-k-periwinkle ${picked === p ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-white'}`}
                >
                  <span className="block text-[14px] font-medium text-k-text">
                    {t(`presets.${p}.name`)}
                  </span>
                  <span className="block text-[12px] text-k-text-2">{t(`presets.${p}.desc`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'menu' && (
          <div className="space-y-2">
            <p className="text-[13px] text-k-text-2">{t('menu.always')}</p>
            {HIDEABLE_MODULES.map((m) => (
              <Row
                key={m}
                id={`menu-${m}`}
                label={nav(m as WorkspaceNavKey)}
                hint={blocked.has(m) ? t('menu.blocked') : t(`menu.desc.${m}`)}
                checked={isModuleShown(draft, m)}
                disabled={blocked.has(m)}
                onChange={(v) =>
                  setDraft(
                    m === 'team'
                      ? setTeamWork(draft, v, blocked)
                      : setModuleShown(draft, m, v, blocked),
                  )
                }
              />
            ))}
          </div>
        )}

        {step === 'how' && (
          <div className="space-y-2">
            <Row
              id="q-visits"
              label={t('how.visits')}
              hint={t('how.visitsHint')}
              checked={isModuleShown(draft, 'routes')}
              onChange={(v) => setDraft(setModuleShown(draft, 'routes', v, blocked))}
            />
            <Row
              id="q-file"
              label={t('how.file')}
              hint={t('how.fileHint')}
              checked={isModuleShown(draft, 'import')}
              onChange={(v) => setDraft(setModuleShown(draft, 'import', v, blocked))}
            />
            <Row
              id="q-team"
              label={t('how.team')}
              hint={blocked.has('team') ? t('menu.blocked') : t('how.teamHint')}
              checked={isModuleShown(draft, 'team')}
              disabled={blocked.has('team')}
              onChange={(v) => setDraft(setTeamWork(draft, v, blocked))}
            />
            <Row
              id="q-offices"
              label={t('how.offices')}
              hint={blocked.has('organization') ? t('menu.blocked') : t('how.officesHint')}
              checked={isModuleShown(draft, 'organization')}
              disabled={blocked.has('organization')}
              onChange={(v) => setDraft(setModuleShown(draft, 'organization', v, blocked))}
            />
            <Row
              id="q-reports"
              label={t('how.reports')}
              hint={t('how.reportsHint')}
              checked={isModuleShown(draft, 'export')}
              onChange={(v) => setDraft(setModuleShown(draft, 'export', v, blocked))}
            />
          </div>
        )}

        {step === 'clients' && (
          <div className="space-y-2">
            {CLIENT_SECTIONS.map((k) => (
              <Row
                key={k}
                id={`client-${k}`}
                label={t(`clients.sections.${k.split('.')[1]}`)}
                checked={isOptionShown(draft, k)}
                onChange={(v) => setDraft(setOptionShown(draft, k, v))}
              />
            ))}
            <p className="text-[12px] text-k-muted">{t('clients.note')}</p>
          </div>
        )}

        {step === 'credits' && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label={t('credits.title')} className="space-y-2">
              {[...DEFINITIONS, null].map((d) => {
                const value = d as string | null;
                const checked = creditDefinitionOf(draft) === value;
                const key = value ?? 'choose';
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setDraft(setCreditDefinition(draft, value))}
                    className={`block w-full rounded-xl border px-4 py-3 text-left ${checked ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-white'}`}
                  >
                    <span className="block text-[14px] font-medium text-k-text">
                      {t(`credits.definitions.${key}.name`)}
                    </span>
                    <span className="block text-[13px] text-k-text-2">
                      {t(`credits.definitions.${key}.desc`)}
                    </span>
                  </button>
                );
              })}
            </div>
            <Row
              id="credit-advanced"
              label={t('credits.advanced')}
              hint={t('credits.advancedHint')}
              checked={isOptionShown(draft, 'credit.advanced')}
              onChange={(v) => setDraft(setAdvancedCredit(draft, v))}
            />
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <section className="rounded-xl border border-k-border bg-white px-4 py-3">
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-k-muted">
                {t('preview.menu')}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {WORKSPACE_MODULES.filter((m) => shownKeys.includes(m.key)).map((m) => (
                  <li
                    key={m.key}
                    className="rounded-full bg-k-light-bg px-3 py-1 text-[13px] text-k-navy"
                  >
                    {nav(m.key as WorkspaceNavKey)}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl border border-k-border bg-white px-4 py-3">
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-k-muted">
                {t('preview.hidden')}
              </h2>
              {diff.modules.length + diff.options.length === 0 && !diff.definition ? (
                <p className="text-[13px] text-k-text-2">{t('preview.none')}</p>
              ) : (
                <ul className="space-y-1 text-[13px] text-k-text">
                  {diff.modules.map((m) => (
                    <li key={m}>— {nav(m as WorkspaceNavKey)}</li>
                  ))}
                  {diff.options.map((o) => (
                    <li key={o}>— {t(`preview.options.${o.replace('.', '_')}`)}</li>
                  ))}
                  {diff.definition && (
                    <li>
                      —{' '}
                      {t('preview.definition', {
                        name: t(`credits.definitions.${diff.definition}.name`),
                      })}
                    </li>
                  )}
                </ul>
              )}
            </section>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-3">
            <p className="text-[14px] text-k-text">
              {t('confirm.summary', {
                modules: diff.modules.length,
                options: diff.options.length + (diff.definition ? 1 : 0),
              })}
            </p>
            <p className="rounded-xl border border-k-success bg-k-success-bg px-4 py-3 text-[13px] text-k-text">
              {t('confirm.guarantee')}
            </p>
          </div>
        )}

        {step === 'done' && <p className="text-[14px] text-k-text">{t('done.text')}</p>}
      </main>

      <footer className="sticky bottom-0 border-t border-k-border bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
          {step === 'done' ? (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" className="!w-auto" onClick={() => void leave()}>
                {t('done.enter')}
              </Button>
              <Button variant="cta" className="!w-auto" onClick={() => void leave(true)}>
                {tourT('wizardCta')}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {index > 0 && (
                  <Button variant="ghost" className="!w-auto" onClick={back} disabled={saving}>
                    {t('back')}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => void applyRecommended()}
                  disabled={saving}
                  className="text-[13px] font-medium text-k-periwinkle underline disabled:opacity-50"
                >
                  {t('useRecommended')}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {SKIPPABLE_STEPS.includes(step) && (
                  <Button variant="ghost" className="!w-auto" onClick={next} disabled={saving}>
                    {t('skipStep')}
                  </Button>
                )}
                {step === 'confirm' ? (
                  <Button
                    variant="cta"
                    className="!w-auto"
                    loading={saving}
                    onClick={() => void confirm()}
                  >
                    {t('save')}
                  </Button>
                ) : (
                  <Button variant="cta" className="!w-auto" onClick={next} disabled={saving}>
                    {t('next')}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
