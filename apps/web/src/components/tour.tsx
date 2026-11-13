'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  GUIDE_CATALOG_VERSION,
  guideSteps,
  parseGuideState,
  tourResumeIndex,
  type GuideState,
  type TourStep,
  type WorkspaceNavKey,
} from '@kobrax/shared';
import { sendJson } from '@/lib/client';

/** Eventos del navegador: desacoplan el motor de quien lo lanza (asistente, bienvenida) y del cajón del menú. */
export const TOUR_START_EVENT = 'kobrax:tour-start';
export const TOUR_MENU_EVENT = 'kobrax:tour-menu';

export function startTour(): void {
  window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: { resume: false } }));
}

interface TourApi {
  /** Empieza desde el primer paso, o desde donde se quedó si `resume`. */
  start: (resume?: boolean) => void;
  /** Paso desde el que se puede retomar, o `null`. Se actualiza al abrir el menú de ayuda (`refresh`). */
  resumeAt: number | null;
  refresh: () => void;
}

const NOOP: TourApi = { start: () => undefined, resumeAt: null, refresh: () => undefined };
const TourContext = createContext<TourApi>(NOOP);
export const useTour = (): TourApi => useContext(TourContext);

/** El primer elemento con esa ancla que realmente se ve (el menú y el idioma existen dos veces: escritorio y celular). */
function findAnchor(target: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const PAD = 6;
const CARD_W = 340;

/**
 * Motor del recorrido con spotlight (F15 · P9, D-18): oscurece la pantalla, enfoca el elemento real y muestra una tarjeta
 * con Atrás / Siguiente / Omitir. Los pasos salen de `guideSteps` (plan ∧ permiso ∧ workspace); el progreso se guarda en
 * el servidor por persona y organización, sin bloquear nunca la pantalla.
 *
 * - Va dentro de un `<dialog>` modal: foco atrapado y `Esc` salen gratis. `Esc` deja el recorrido a medias (se puede retomar);
 *   «Omitir recorrido» lo da por omitido.
 * - En pantallas chicas el menú es un cajón: para enfocar un ítem se abre por el evento `kobrax:tour-menu`.
 * - Si un elemento no está a la vista (p. ej. el idioma dentro del menú del celular), la tarjeta sale centrada sin recuadro.
 */
export function TourProvider({
  visibleNavKeys,
  multipleAccounts,
  children,
}: {
  visibleNavKeys: readonly WorkspaceNavKey[];
  multipleAccounts: boolean;
  children: ReactNode;
}) {
  const steps = useMemo(
    () => guideSteps({ visibleNavKeys, multipleAccounts }),
    [visibleNavKeys, multipleAccounts],
  );
  const [index, setIndex] = useState<number | null>(null);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const stateRef = useRef<GuideState | null>(null);

  const save = useCallback((tour: Partial<GuideState['tour']>) => {
    void sendJson('/api/users/me/guides', { tour }, 'PATCH');
  }, []);

  const refresh = useCallback(() => {
    void fetch('/api/users/me/guides')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: unknown } | null) => {
        if (!json) return;
        const st = parseGuideState(json.data);
        stateRef.current = st;
        setResumeAt(tourResumeIndex(st.tour, steps.length));
      })
      .catch(() => undefined);
  }, [steps.length]);

  const open = useCallback(
    (from: number) => {
      if (steps.length === 0) return;
      setIndex(from);
      save({ status: 'inProgress', step: from, catalogVersion: GUIDE_CATALOG_VERSION });
    },
    [steps.length, save],
  );

  const start = useCallback(
    (resume = false) => {
      if (!resume || resumeAt === null) return open(0);
      open(resumeAt);
    },
    [open, resumeAt],
  );

  useEffect(() => {
    const onStart = (e: Event) => {
      const wantsResume = (e as CustomEvent<{ resume?: boolean }>).detail?.resume === true;
      start(wantsResume);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [start]);

  const go = (to: number) => {
    if (to < 0) return;
    if (to >= steps.length) {
      save({ status: 'done', step: 0, catalogVersion: GUIDE_CATALOG_VERSION });
      setResumeAt(null);
      return setIndex(null);
    }
    setIndex(to);
    save({ status: 'inProgress', step: to, catalogVersion: GUIDE_CATALOG_VERSION });
  };

  const skip = () => {
    save({ status: 'skipped', step: 0, catalogVersion: GUIDE_CATALOG_VERSION });
    setResumeAt(null);
    setIndex(null);
  };

  // `Esc`/cerrar: queda a medias y «Seguir donde lo dejé» lo retoma.
  const leave = () => {
    if (index !== null && index > 0) setResumeAt(index);
    setIndex(null);
  };

  const api = useMemo<TourApi>(() => ({ start, resumeAt, refresh }), [start, resumeAt, refresh]);

  return (
    <TourContext.Provider value={api}>
      {children}
      {index !== null && steps[index] && (
        <SpotlightTour
          steps={steps}
          index={Math.min(index, steps.length - 1)}
          onGo={go}
          onSkip={skip}
          onLeave={leave}
        />
      )}
    </TourContext.Provider>
  );
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function SpotlightTour({
  steps,
  index,
  onGo,
  onSkip,
  onLeave,
}: {
  steps: TourStep[];
  index: number;
  onGo: (to: number) => void;
  onSkip: () => void;
  onLeave: () => void;
}) {
  const t = useTranslations();
  const step = steps[index]!;
  const dialog = useRef<HTMLDialogElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const menuOpenedByTour = useRef(false);
  const [box, setBox] = useState<Box | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const last = index === steps.length - 1;

  const setMenu = useCallback((openIt: boolean) => {
    window.dispatchEvent(new CustomEvent(TOUR_MENU_EVENT, { detail: { open: openIt } }));
  }, []);

  // El `<dialog>` modal: se abre al montar y se vuelve a subir al tope si el cajón del menú se abre después que él.
  const raise = useCallback(() => {
    const d = dialog.current;
    if (!d) return;
    if (d.open) d.close();
    d.showModal();
    nextBtn.current?.focus();
  }, []);

  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Al terminar o salir, el cajón que abrió el recorrido se cierra.
  useEffect(
    () => () => {
      if (menuOpenedByTour.current) setMenu(false);
    },
    [setMenu],
  );

  // Cada paso: encontrar el elemento (abriendo el cajón del menú si hace falta), llevarlo a la vista y medirlo.
  useEffect(() => {
    let cancelled = false;
    const measure = () => {
      const el = findAnchor(step.target);
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else setBox(null);
      setVw(window.innerWidth);
      return el;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const el = findAnchor(step.target);
    if (!el && step.kind === 'nav' && !menuOpenedByTour.current) {
      menuOpenedByTour.current = true;
      setMenu(true);
      timer = setTimeout(() => {
        if (cancelled) return;
        raise();
        measure();
      }, 80);
    } else {
      if (step.kind === 'topbar' && menuOpenedByTour.current) {
        menuOpenedByTour.current = false;
        setMenu(false);
        timer = setTimeout(() => !cancelled && measure(), 80);
      }
      measure();
    }
    nextBtn.current?.focus();

    const onResize = () => !cancelled && measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [step, setMenu, raise]);

  // Tarjeta: junto al elemento si cabe; en celular, como hoja inferior.
  const small = vw < 640;
  let cardStyle: React.CSSProperties;
  if (small) cardStyle = { left: 12, right: 12, bottom: 12 };
  else if (!box)
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_W };
  else {
    const rightRoom = vw - (box.left + box.width) - 16;
    const left =
      rightRoom >= CARD_W + 8 && box.left < 300
        ? box.left + box.width + 16 + PAD
        : Math.max(12, Math.min(vw - CARD_W - 12, box.left));
    const side = rightRoom >= CARD_W + 8 && box.left < 300;
    const top = side
      ? Math.max(12, Math.min(window.innerHeight - 300, box.top))
      : box.top + box.height + 12 + PAD > window.innerHeight - 300
        ? Math.max(12, box.top - 12 - 260)
        : box.top + box.height + 12 + PAD;
    cardStyle = { top, left, width: CARD_W };
  }

  const title = t(`${step.textKey}.title`);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="tour-title"
      aria-describedby="tour-desc"
      onCancel={(e) => {
        e.preventDefault();
        onLeave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onGo(index + 1);
        else if (e.key === 'ArrowLeft') onGo(index - 1);
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"
    >
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-white motion-safe:transition-all motion-safe:duration-200"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62)',
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 bg-k-navy/60" />
      )}

      <div
        className="fixed rounded-xl border border-k-border bg-white p-4 shadow-k-card"
        style={cardStyle}
      >
        <p
          className="text-[12px] font-medium uppercase tracking-wide text-k-muted"
          aria-live="polite"
        >
          {t('tour.progress', { current: index + 1, total: steps.length })}
        </p>
        <h2 id="tour-title" className="mt-1 text-[16px] font-semibold text-k-navy">
          {title}
        </h2>
        <div id="tour-desc" className="mt-1 space-y-1 text-[13px] text-k-text">
          <p className="font-medium">{t(`${step.textKey}.what`)}</p>
          <p className="text-k-text-2">{t(`${step.textKey}.does`)}</p>
          <p className="text-k-text-2">
            <span className="font-medium text-k-text">{t('tour.startWith')}</span>{' '}
            {t(`${step.textKey}.startWith`)}
          </p>
          {!box && <p className="text-[12px] text-k-muted">{t('tour.noAnchor')}</p>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-2 py-2 text-[13px] text-k-text-2 hover:bg-k-bg"
          >
            {t('tour.skip')}
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => onGo(index - 1)}
                className="min-h-[40px] rounded-lg border border-k-border px-3 text-[13px] font-medium text-k-navy hover:bg-k-bg"
              >
                {t('tour.back')}
              </button>
            )}
            <button
              ref={nextBtn}
              type="button"
              onClick={() => onGo(index + 1)}
              className="min-h-[40px] rounded-lg bg-k-navy px-4 text-[13px] font-medium text-white hover:bg-k-navy/90"
            >
              {last ? t('tour.finish') : t('tour.next')}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
