'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { FirstStep, WorkspaceNavKey } from '@kobrax/shared';
import { sendJson } from '@/lib/client';
import { startTour } from '@/components/tour';

/** Las dos pantallas de aterrizaje: Inicio y, para quien no ve Inicio, la Agenda. */
const LANDING = ['/dashboard', '/agenda'];

export interface WelcomeInfo {
  orgName: string;
  /** Clave del rol (`COLLECTOR`…) o su nombre si es personalizado. */
  role: string;
  modules: WorkspaceNavKey[];
}

/**
 * Las tarjetas de F15 · P8: la bienvenida del primer ingreso y los «primeros pasos». Se cierran al instante; lo que se guarda
 * (en segundo plano y sin bloquear) es solo que se cerraron. Si el guardado falla, la tarjeta puede volver en otra visita:
 * es un recordatorio, no una pérdida.
 */
export function OnboardingCardsView({
  welcome,
  steps,
  closeStepsNow = false,
}: {
  welcome: WelcomeInfo | null;
  steps: FirstStep[] | null;
  /** Todas las tareas ya están hechas: se da por cerrada la tarjeta (se guarda una vez) para no volver a consultar. */
  closeStepsNow?: boolean;
}) {
  const t = useTranslations('onboarding');
  const nav = useTranslations('panel.nav');
  const tourT = useTranslations('tour');
  const roles = useTranslations('roles.roleNames');
  const pathname = usePathname();
  const router = useRouter();
  const arrived = useRef(false);
  const [showWelcome, setShowWelcome] = useState(welcome !== null);
  const [showSteps, setShowSteps] = useState(steps !== null);

  // Se guarda una sola vez, al completarse: así las próximas cargas ya no consultan nada.
  useEffect(() => {
    if (closeStepsNow) void sendJson('/api/users/me/guides', { firstStepsClosed: true }, 'PATCH');
  }, [closeStepsNow]);

  // El layout no se vuelve a pintar al navegar: al regresar a una pantalla de aterrizaje con los pasos abiertos se pide el
  // estado de nuevo, para que lo que la persona hizo entre tanto se vea marcado.
  const onLanding = LANDING.includes(pathname);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    if (onLanding && steps !== null && showSteps) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!onLanding || (!(welcome && showWelcome) && !(steps && showSteps))) return null;

  const close = (patch: { welcomeSeen?: boolean; firstStepsClosed?: boolean }) => {
    void sendJson('/api/users/me/guides', patch, 'PATCH');
  };

  return (
    <div className="mb-5 space-y-3">
      {welcome && showWelcome && (
        <section
          aria-labelledby="welcome-card-title"
          className="rounded-xl border border-k-periwinkle bg-k-highlight px-4 py-4"
        >
          <h2 id="welcome-card-title" className="text-[16px] font-semibold text-k-navy">
            {t('welcomeCard.title', { org: welcome.orgName })}
          </h2>
          <p className="mt-1 text-[13px] text-k-text">
            {t('welcomeCard.role', {
              role: roles.has(welcome.role) ? roles(welcome.role) : welcome.role,
            })}
          </p>
          {welcome.modules.length > 0 && (
            <>
              <p className="mt-2 text-[13px] text-k-text-2">{t('welcomeCard.can')}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {welcome.modules.map((m) => (
                  <li key={m} className="rounded-full bg-white px-3 py-1 text-[13px] text-k-navy">
                    {nav(m)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 text-[13px] text-k-text-2">{t('welcomeCard.help')}</p>
          <button
            type="button"
            onClick={() => {
              setShowWelcome(false);
              close({ welcomeSeen: true });
            }}
            className="mt-3 rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-k-navy hover:bg-k-light-bg"
          >
            {t('welcomeCard.ok')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowWelcome(false);
              close({ welcomeSeen: true });
              startTour();
            }}
            className="ml-2 mt-3 rounded-lg bg-k-navy px-3 py-2 text-[13px] font-medium text-white hover:bg-k-navy/90"
          >
            {tourT('welcomeCta')}
          </button>
        </section>
      )}

      {steps && showSteps && (
        <section
          aria-labelledby="first-steps-title"
          className="rounded-xl border border-k-border bg-white px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="first-steps-title" className="text-[16px] font-semibold text-k-navy">
                {t('firstSteps.title')}
              </h2>
              <p className="text-[13px] text-k-text-2">{t('firstSteps.intro')}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowSteps(false);
                close({ firstStepsClosed: true });
              }}
              className="shrink-0 rounded-lg px-2 py-1 text-[13px] text-k-text-2 hover:bg-k-bg"
            >
              {t('firstSteps.close')}
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {steps.map((s) => (
              <li key={s.key} className="flex items-center gap-3 text-[14px]">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[12px] ${s.done ? 'bg-k-success text-white' : 'border border-k-border text-transparent'}`}
                >
                  ✓
                </span>
                {s.done ? (
                  <span className="text-k-text-2 line-through">
                    {t(`firstSteps.items.${s.key}`)}
                  </span>
                ) : (
                  <Link href={s.href} className="font-medium text-k-periwinkle hover:underline">
                    {t(`firstSteps.items.${s.key}`)}
                  </Link>
                )}
                <span className="sr-only">
                  {s.done ? t('firstSteps.done') : t('firstSteps.pending')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
