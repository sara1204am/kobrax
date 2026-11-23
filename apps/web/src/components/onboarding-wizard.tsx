'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CreditDefinition,
  WORKSPACE_MODULES,
  emptyWorkspace,
  resolveWorkspace,
  type AccountInfo,
  type WorkspaceModuleKey,
  type WorkspaceNavKey,
  type WorkspaceOptionKey,
} from '@kobrax/shared';
import { sendJson } from '@/lib/client';
import {
  COUNTED_STEPS,
  WIZARD_STEPS,
  applyPlanGatesTo,
  blockedModules,
  changesFromComplete,
  creditDefinitionOf,
  draftOf,
  failureOf,
  gatedModules,
  isModuleShown,
  isOptionShown,
  isUntouched,
  saveBody,
  setAdvancedCredit,
  setCreditDefinition,
  setModuleShown,
  setOptionShown,
  setTeamWork,
  skipBody,
  startDraft,
  type Draft,
  type SaveFailure,
  type WizardStep,
} from '@/lib/onboarding-wizard';
import { Section } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { ChoiceCard, SwitchRow } from '@/components/workspace-fields';
import { startTour } from '@/components/tour';

const DEFINITIONS = [
  CreditDefinition.AGREED_INSTALLMENT,
  CreditDefinition.AGREED_TOTAL,
  CreditDefinition.CALCULATED,
] as const;

/** Lo que casi siempre se pide de un cliente, y los datos que solo se piden si le sirven a la operación. */
const CLIENT_CORE: WorkspaceOptionKey[] = [
  'client.income',
  'client.guarantors',
  'client.collateral',
  'client.attachments',
];
const CLIENT_OPTIONAL: WorkspaceOptionKey[] = ['client.preferredChannel', 'client.gender'];
const clientKey = (k: WorkspaceOptionKey) => k.split('.')[1]!;

/** Las herramientas que se suman o se quitan sin depender de cuántas personas hay: nunca bloqueadas por el plan. */
const TOOLS: WorkspaceModuleKey[] = ['routes', 'import', 'export'];

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

/**
 * Asistente de configuración (F15 · D-11, rediseñado): cuatro decisiones y una bienvenida, en pantalla completa.
 *
 * 1. **Herramientas** — qué módulos opcionales se ven. Sin preguntar la modalidad: ya salió del plan elegido al registrarse
 *    (`recommendSetup`), y lo que el plan no puede usar (Equipo con un solo asiento, Oficinas con una sola oficina) ni se ofrece.
 * 2. **Clientes** — qué secciones y datos lleva la ficha.
 * 3. **Créditos** — cómo se definen al crearlos.
 * 4. **Resumen** — lo que quedó, con «Cambiar» por sección; un solo guardado.
 *
 * - **Nada se escribe hasta guardar**: el borrador vive en memoria (volver atrás conserva todo) y se guarda en UNA llamada
 *   (`workspace` + `onboarding` con `rev`). Cerrar a la mitad no deja nada a medias.
 * - Es el MISMO modelo que Cuenta › Espacio de trabajo: los dos usan `SwitchRow`, los topes del plan y las mismas salvaguardas.
 * - Si la cuenta ya tenía una configuración (se vuelve a abrir desde Cuenta), arranca desde ella y nunca ofrece «lo recomendado».
 * - No cambia permisos, planes ni datos: solo qué se muestra (ocultar no es autorizar).
 */
export function OnboardingWizard({
  account,
  onClose,
}: {
  account: AccountInfo;
  onClose?: () => void;
}) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('account.workspace.client');
  const tourT = useTranslations('tour');
  const nav = useTranslations('panel.nav');
  const plans = useTranslations('plans.names');
  const router = useRouter();
  const base = account.workspace ?? emptyWorkspace();
  const blocked = useMemo(() => blockedModules(account.usage), [account.usage]);
  const gated = useMemo(() => gatedModules(account.limits, blocked), [account.limits, blocked]);
  // Primera vez: se arranca de lo recomendado para el plan. Con algo ya guardado, de eso: no se pisa.
  const firstRun = !onClose && isUntouched(base);
  const planName = plans.has(account.planCode) ? plans(account.planCode) : account.planCode;
  const startsFrom = () => startDraft(account.planCode, blocked, gated);

  const [step, setStep] = useState<WizardStep>('tools');
  const [draft, setDraft] = useState<Draft>(() =>
    firstRun ? startsFrom() : applyPlanGatesTo(draftOf(base), gated),
  );
  const [saving, setSaving] = useState(false);
  /** Qué botón del cierre se pulsó: queda con spinner y todos bloqueados hasta que el panel cambie de pantalla. */
  const [leaving, setLeaving] = useState<'enter' | 'tour' | 'client' | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const index = WIZARD_STEPS.indexOf(step);
  const counted = COUNTED_STEPS.length;
  const hasTeam = !gated.has('team');
  const hasOffices = !gated.has('organization');

  // El foco va al título de cada paso: quien navega con teclado o lector de pantalla se entera del cambio.
  useEffect(() => titleRef.current?.focus(), [step]);

  const go = (to: WizardStep) => {
    setFailure(null);
    setStep(to);
  };
  const next = () => go(WIZARD_STEPS[Math.min(index + 1, WIZARD_STEPS.length - 1)]!);
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
  async function leave(after?: 'client' | 'tour') {
    if (leaving) return; // doble clic
    setLeaving(after ?? 'enter');
    // Quien configuró la cuenta ya conoce el espacio: no hace falta darle además la tarjeta de bienvenida. Se espera el
    // guardado antes de refrescar: si no, el panel podría leer el estado viejo y mostrársela igual.
    if (!onClose) await sendJson('/api/users/me/guides', { welcomeSeen: true }, 'PATCH');
    onClose?.();
    // Primero se navega y después se refresca: en Next 14 un `refresh()` seguido de `push()` cancela la navegación
    // (el clic en «Registrar mi primer cliente» no hacía nada). El refresh ya re-renderiza el layout en la ruta nueva.
    if (after === 'client') router.push('/cartera'); // sigue cargando: la pantalla cambia sola al llegar
    router.refresh();
    if (after === 'tour') startTour();
    if (after !== 'client') setLeaving(null);
  }

  // Abierto desde Cuenta (`onClose`) cerrar no resuelve nada; montado por el panel, «después» marca el asistente como omitido.
  const later = () => (onClose ? onClose() : finish(skipBody(base, gated), null));
  const applyRecommended = () => finish(saveBody(base, startsFrom(), gated), 'done');
  const confirm = () => finish(saveBody(base, draft, gated), 'done');

  const diff = changesFromComplete(draft);
  const shownKeys = resolveWorkspace({
    ...base,
    hiddenModules: draft.hiddenModules as WorkspaceModuleKey[],
  }).visibleNavKeys();
  const hiddenClientKeys = [...CLIENT_CORE, ...CLIENT_OPTIONAL].filter(
    (k) => !isOptionShown(draft, k),
  );
  const shownClientKeys = [...CLIENT_CORE, ...CLIENT_OPTIONAL].filter((k) =>
    isOptionShown(draft, k),
  );
  const definition = creditDefinitionOf(draft);

  const moduleRow = (m: WorkspaceModuleKey, hint: string) => (
    <SwitchRow
      key={m}
      id={`tool-${m}`}
      label={t(`tools.items.${m}.label`)}
      hint={blocked.has(m) ? t('tools.inUse') : hint}
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-k-bg"
      onKeyDown={(e) => {
        // Esc solo sale en el primer paso, donde todavía no hay nada elegido: más adelante descartaría el borrador sin avisar.
        if (e.key === 'Escape' && !saving && step === 'tools') void later();
        if (e.key === 'Tab') trapFocus(e);
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-k-border bg-white px-5 py-3">
        <div>
          <p className="text-k-xs font-semibold uppercase tracking-wide text-k-muted">
            {t('title')}
          </p>
          {step !== 'done' && (
            <p className="text-k-sm text-k-text-2" aria-live="polite">
              {t('progress', { n: index + 1, total: counted })}
            </p>
          )}
        </div>
        {step !== 'done' && (
          <button
            type="button"
            onClick={() => void later()}
            disabled={saving}
            className="min-h-[44px] rounded-lg px-3 text-k-sm font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-50"
          >
            {onClose ? t('close') : t('later')}
          </button>
        )}
      </header>

      <div className="h-1 bg-k-light-bg" aria-hidden>
        <div
          className="h-1 bg-k-periwinkle transition-all"
          style={{ width: `${(Math.min(index + 1, counted) / counted) * 100}%` }}
        />
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-5 py-8">
        <div>
          <h1
            id="onboarding-title"
            ref={titleRef}
            tabIndex={-1}
            className="mb-1 text-k-3xl font-semibold text-k-navy outline-none"
          >
            {t(`${step}.title`)}
          </h1>
          <p className="text-k-base text-k-text-2">
            {step === 'tools'
              ? t('tools.intro', { plan: planName })
              : t(`${step}.intro`, { plan: planName })}
          </p>
        </div>

        {failure && (
          <div className="space-y-2">
            <ErrorBanner message={t(`errors.${failure}`)} />
            {failure === 'conflict' && (
              <Button
                type="button"
                variant="ghost"
                className="!h-10 !w-auto px-4 !text-k-sm"
                onClick={() => router.refresh()}
              >
                {t('errors.reload')}
              </Button>
            )}
          </div>
        )}

        {step === 'tools' && (
          <>
            <Section title={t('tools.tools')} inner="px-5 py-1">
              {TOOLS.map((m) => moduleRow(m, t(`tools.items.${m}.hint`)))}
            </Section>
            {hasTeam && (
              <Section title={t('tools.team')} inner="px-5 py-1">
                {moduleRow('team', t('tools.items.team.hint'))}
                {hasOffices && moduleRow('organization', t('tools.items.organization.hint'))}
              </Section>
            )}
            <p className="text-k-sm text-k-text-2">{t('tools.always')}</p>
          </>
        )}

        {step === 'clients' && (
          <>
            <Section title={t('clients.core')} inner="px-5 py-1">
              {CLIENT_CORE.map(clientRow)}
            </Section>
            <Section title={t('clients.optional')} inner="px-5 py-1">
              {CLIENT_OPTIONAL.map(clientRow)}
            </Section>
            <p className="text-k-sm text-k-text-2">{t('clients.note')}</p>
          </>
        )}

        {step === 'credits' && (
          <>
            <Section title={t('credits.definition')} inner="p-4">
              <div role="radiogroup" aria-label={t('credits.definition')} className="space-y-2">
                {[...DEFINITIONS, null].map((d) => {
                  const value = d as string | null;
                  const key = value ?? 'choose';
                  return (
                    <ChoiceCard
                      key={key}
                      name={t(`credits.definitions.${key}.name`)}
                      description={t(`credits.definitions.${key}.desc`)}
                      checked={definition === value}
                      onSelect={() => setDraft(setCreditDefinition(draft, value))}
                    />
                  );
                })}
              </div>
            </Section>
            <Section title={t('credits.more')} inner="px-5 py-1">
              <SwitchRow
                id="credit-advanced"
                label={t('credits.advanced')}
                hint={t('credits.advancedHint')}
                checked={isOptionShown(draft, 'credit.advanced')}
                onChange={(v) => setDraft(setAdvancedCredit(draft, v))}
              />
            </Section>
          </>
        )}

        {step === 'summary' && (
          <>
            <Section
              title={t('summary.menu')}
              inner="p-4"
              action={
                <Button
                  variant="ghost"
                  className="!h-9 !w-auto px-3 !text-k-sm"
                  onClick={() => go('tools')}
                >
                  {t('summary.change')}
                </Button>
              }
            >
              <ul className="flex flex-wrap gap-2">
                {WORKSPACE_MODULES.filter((m) => shownKeys.includes(m.key)).map((m) => (
                  <li
                    key={m.key}
                    className="rounded-full bg-k-light-bg px-3 py-1 text-k-sm text-k-navy"
                  >
                    {nav(m.key as WorkspaceNavKey)}
                  </li>
                ))}
              </ul>
              {diff.modules.length > 0 && (
                <p className="mt-3 text-k-sm text-k-text-2">
                  {t('summary.hiddenModules', {
                    list: diff.modules.map((m) => nav(m as WorkspaceNavKey)).join(', '),
                  })}
                </p>
              )}
            </Section>

            <Section
              title={t('summary.clients')}
              inner="p-4"
              action={
                <Button
                  variant="ghost"
                  className="!h-9 !w-auto px-3 !text-k-sm"
                  onClick={() => go('clients')}
                >
                  {t('summary.change')}
                </Button>
              }
            >
              <p className="text-k-base text-k-text">
                {shownClientKeys.length > 0
                  ? t('summary.clientsShown', {
                      list: shownClientKeys.map((k) => tc(`${clientKey(k)}.label`)).join(', '),
                    })
                  : t('summary.clientsNone')}
              </p>
              {hiddenClientKeys.length > 0 && (
                <p className="mt-1 text-k-sm text-k-text-2">
                  {t('summary.clientsHidden', {
                    list: hiddenClientKeys.map((k) => tc(`${clientKey(k)}.label`)).join(', '),
                  })}
                </p>
              )}
            </Section>

            <Section
              title={t('summary.credits')}
              inner="p-4"
              action={
                <Button
                  variant="ghost"
                  className="!h-9 !w-auto px-3 !text-k-sm"
                  onClick={() => go('credits')}
                >
                  {t('summary.change')}
                </Button>
              }
            >
              <p className="text-k-base text-k-text">
                {definition
                  ? t('summary.creditsFixed', { name: t(`credits.definitions.${definition}.name`) })
                  : t('summary.creditsChoose')}
              </p>
              <p className="mt-1 text-k-sm text-k-text-2">
                {isOptionShown(draft, 'credit.advanced')
                  ? t('summary.advancedOn')
                  : t('summary.advancedOff')}
              </p>
            </Section>

            <p className="rounded-xl border border-k-success bg-k-success-bg px-4 py-3 text-k-sm text-k-text">
              {t('summary.guarantee')}
            </p>
          </>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <p className="text-k-base text-k-text">{t('done.menu', { n: shownKeys.length })}</p>
            <p className="text-k-sm text-k-text-2">{t('done.change')}</p>
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-k-border bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
          {step === 'done' ? (
            <div className="ml-auto flex flex-wrap gap-2">
              {onClose ? (
                <Button variant="primary" className="!w-auto px-6" onClick={() => void leave()}>
                  {t('done.close')}
                </Button>
              ) : (
                <>
                  <Button variant="ghost" className="!w-auto px-4" onClick={() => void leave()} loading={leaving === 'enter'} disabled={leaving !== null}>
                    {t('done.enter')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="!w-auto px-4"
                    onClick={() => void leave('tour')}
                    loading={leaving === 'tour'}
                    disabled={leaving !== null}
                  >
                    {tourT('wizardCta')}
                  </Button>
                  <Button
                    variant="primary"
                    className="!w-auto pl-6 pr-12"
                    onClick={() => void leave('client')}
                    loading={leaving === 'client'}
                    disabled={leaving !== null}
                  >
                    {t('done.firstClient')}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {index > 0 && (
                  <Button variant="ghost" className="!w-auto px-4" onClick={back} disabled={saving}>
                    {t('back')}
                  </Button>
                )}
                {firstRun && step !== 'summary' && (
                  <button
                    type="button"
                    onClick={() => void applyRecommended()}
                    disabled={saving}
                    className="min-h-[44px] text-k-sm font-medium text-k-periwinkle underline disabled:opacity-50"
                  >
                    {t('useRecommended')}
                  </button>
                )}
              </div>
              {step === 'summary' ? (
                <Button
                  variant="primary"
                  className="!w-auto pl-6 pr-12"
                  loading={saving}
                  onClick={() => void confirm()}
                >
                  {t('save')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="!w-auto pl-6 pr-12"
                  onClick={next}
                  disabled={saving}
                >
                  {t('next')}
                </Button>
              )}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
