'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/panel-ui';
import type { ConfigProgress } from '@/lib/import';

/**
 * El viaje completo del import, y en qué tramo está parada la persona.
 *
 * «Revisar» e «Importar» **no son de esta pantalla**: son la vista previa y la confirmación de
 * `/import`. Se dibujan igual porque el trabajo de acá recién sirve allá — sin ellos, configurar
 * parece el final del camino y no la mitad.
 */
const STEPS = ['file', 'config', 'review', 'import'] as const;

export function Stepper({ current }: { current: number }) {
  const t = useTranslations('panel.import.setup.steps');

  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <li key={step} className="flex min-w-0 shrink-0 items-center gap-1">
            <span className="flex items-center gap-2 px-1">
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                  done
                    ? 'bg-k-success text-white'
                    : here
                      ? 'bg-k-navy text-white'
                      : 'border border-k-border bg-white text-k-muted'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={`whitespace-nowrap text-[13px] ${here ? 'font-semibold text-k-navy' : 'text-k-text-2'}`}
              >
                {/* El paso actual se anuncia, no se deduce del color. */}
                {here && <span className="sr-only">{t('here')} </span>}
                {t(step)}
              </span>
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className="h-px w-6 shrink-0 bg-k-border sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

export type SaveState = 'idle' | 'saving' | 'saved';

/**
 * Que todo se guarde solo hay que **decirlo**, no celebrarlo quince veces.
 *
 * Antes cada control disparaba su propio toast: configurar de cero eran 10–15 avisos apilados
 * tapando la pantalla para confirmar algo que nunca falla. Acá es una línea que cambia de estado y
 * se queda quieta. El `aria-live` la deja anunciarse una sola vez, sin robar el foco.
 */
export function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations('panel.import.setup');
  return (
    <p aria-live="polite" className="text-[13px] text-k-text-2">
      {state === 'saving' ? (
        t('saving')
      ) : state === 'saved' ? (
        <span className="text-k-success">✓ {t('savedAll')}</span>
      ) : (
        ''
      )}
    </p>
  );
}

/** El anillo de progreso. Decoración: los números están al lado, en texto. */
function Donut({ ready, total }: { ready: number; total: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const filled = total > 0 ? (ready / total) * circumference : 0;

  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg aria-hidden viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8" className="stroke-k-light-bg" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="stroke-k-periwinkle transition-all"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[16px] font-semibold tabular-nums text-k-navy">
        {ready}/{total}
      </span>
    </div>
  );
}

/**
 * Cuánto falta para poder importar, de un vistazo.
 *
 * Es lo que la pantalla no decía nunca: `setupStep()` ya existía en `shared` y lo usaban el móvil y
 * la pantalla de correr, pero no ésta — justo donde la persona está tratando de completarlo, y
 * sólo se enteraba de que faltaba algo después de irse.
 */
export function StatusCard({ progress }: { progress: ConfigProgress }) {
  const t = useTranslations('panel.import.columns');
  const { ready, review, missing, total, blocking } = progress;

  const message = blocking.length
    ? t('statusBlocking', { n: blocking.length })
    : missing > 0
      ? t('statusOptional', { n: missing })
      : review > 0
        ? t('statusReview')
        : t('statusDone');

  return (
    <Card>
      <p className="text-[14px] font-medium text-k-text">{t('status')}</p>
      <div className="mt-4 flex items-center gap-4">
        <Donut ready={ready} total={total} />
        <ul className="min-w-0 space-y-1.5 text-[13px]">
          <Line tone="success" label={t('statusReadyCount', { n: ready })} />
          {review > 0 && <Line tone="warning" label={t('statusReviewCount', { n: review })} />}
          {missing > 0 && (
            <Line tone={blocking.length ? 'danger' : 'neutral'} label={t('statusMissingCount', { n: missing })} />
          )}
        </ul>
      </div>
      <p
        className={`mt-4 rounded-xl px-4 py-3 text-[13px] ${
          blocking.length
            ? 'bg-k-danger-bg text-k-danger'
            : total === ready
              ? 'bg-k-success-bg text-k-success'
              : 'bg-k-highlight text-k-text'
        }`}
      >
        {message}
      </p>
    </Card>
  );
}

const DOTS = {
  success: 'bg-k-success',
  warning: 'bg-k-warning',
  danger: 'bg-k-danger',
  neutral: 'bg-k-muted',
} as const;

function Line({ tone, label }: { tone: keyof typeof DOTS; label: string }) {
  return (
    <li className="flex items-center gap-2 text-k-text-2">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOTS[tone]}`} />
      {label}
    </li>
  );
}

export interface SummaryRow {
  label: string;
  value: string;
  /** `false` pinta el valor como pendiente. El texto ya lo dice; el color sólo acompaña. */
  ok?: boolean;
}

/**
 * Las cinco respuestas que la persona quiere sin desplazarse: qué archivo, de quién es, cómo está
 * organizado, cuántas columnas van y si la mora está confirmada.
 *
 * El `sticky` lo pone quien lo usa: en desktop queda pegado al costado, y en pantallas angostas la
 * columna se apila sola — sin `overflow` horizontal, porque los valores cortan por palabra.
 */
export function Summary({ rows, children }: { rows: SummaryRow[]; children?: ReactNode }) {
  const t = useTranslations('panel.import.setup');

  return (
    <section aria-label={t('summary')} className="rounded-2xl border border-k-border bg-white p-5">
      <p className="text-[14px] font-medium text-k-text">{t('summary')}</p>
      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{row.label}</dt>
            <dd
              className={`mt-0.5 break-words text-[13px] ${
                row.ok === false ? 'text-k-muted' : 'font-medium text-k-text'
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {children && <div className="mt-5 space-y-3 border-t border-k-border pt-5">{children}</div>}
    </section>
  );
}
