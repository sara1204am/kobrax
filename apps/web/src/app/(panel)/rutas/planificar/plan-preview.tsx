'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { postJson } from '@/lib/client';
import { addMinutes, clockConflicts } from '@/lib/plan';
import { MapPanel, type OrderItem } from '@/components/route-planner/map-panel';
import type { MapPoint } from '@/components/route-planner/points-map';

/** Una parada del recorrido que se va a publicar, con lo que la vista previa necesita de ella. */
export interface PreviewStop {
  /** El crédito. */
  id: string;
  name: string;
  /** Dónde se visita: «Domicilio · Calle 12». */
  place: string;
  latitude: number;
  longitude: number;
  /** La hora fija de su visita agendada, si la tiene. */
  scheduledTime?: string;
  /** Tiene una visita agendada ese día (con o sin hora): es un compromiso, no sólo una parada. */
  planned?: boolean;
  /** La foto principal de la dirección, chica sobre el pin. */
  photoUrl?: string;
}

interface PreviewData {
  geometry: { latitude: number; longitude: number }[];
  distanceKm?: number;
  minutes?: number;
  stops: { id: string; sequenceOrder: number; etaMinutes?: number; scheduledTime?: string }[];
  suggestion?: { order: string[]; savedKm: number; savedMinutes: number };
}

const duration = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

/**
 * **La vista previa antes de publicar** (F4/12): cuántas visitas, cuántos kilómetros, cuánto tarda, a qué hora empieza y
 * termina, y a qué hora se llegaría a cada parada.
 *
 * La calcula la API **sin guardar nada** (`POST /routes/plan-preview`): revisar no crea una ruta a medias que el cobrador
 * vería. Si el recorrido da vueltas de más ofrece **«Optimizar orden»**, que cambia el orden **solo si la persona lo
 * confirma** — y respeta las paradas con hora fija. Las que llegarían tarde a su hora fija se marcan: es una restricción
 * dura y el choque se muestra siempre.
 *
 * Sin motor de ruteo se dice y no se inventa una distancia: la ruta se puede publicar igual.
 */
export function PlanPreview({
  stops,
  start,
  onStart,
  onApplyOrder,
  extraVisits,
}: {
  stops: PreviewStop[];
  /** Hora de salida, `HH:mm`. */
  start: string;
  onStart: (v: string) => void;
  /** Aplicar el orden sugerido: ids de crédito en el orden nuevo. */
  onApplyOrder: (ids: string[]) => void;
  /** Visitas agendadas que se suman solas al final y no están en el mapa (su crédito no está entre los candidatos). */
  extraVisits: number;
}) {
  const t = useTranslations('panel.routes.planning.preview');
  const tPlan = useTranslations('panel.routes.planning');
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // El mismo recorrido, el mismo cálculo: cambiar solo la hora de salida no vuelve a pedirle nada a la API.
  const signature = useMemo(() => stops.map((s) => `${s.id}:${s.latitude}:${s.longitude}:${s.scheduledTime ?? ''}`).join('|'), [stops]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void postJson<PreviewData>('/api/routes/plan-preview', {
      points: stops.map((s) => ({ id: s.id, latitude: s.latitude, longitude: s.longitude, ...(s.scheduledTime ? { scheduledTime: s.scheduledTime } : {}) })),
    }).then(({ ok, data: body }) => {
      if (cancelled) return;
      setLoading(false);
      if (!ok) return setError((body as { error?: { message?: string } }).error?.message ?? t('error'));
      setData(body);
    });
    return () => {
      cancelled = true;
    };
    // `stops` entra por su firma: un arreglo nuevo con lo mismo no es otro recorrido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const conflicts = useMemo(() => new Set(clockConflicts(data?.stops ?? [], start)), [data, start]);
  const etaOf = (id: string) => data?.stops.find((s) => s.id === id)?.etaMinutes;
  const last = data?.minutes != null ? addMinutes(start, data.minutes) : undefined;

  const stat = 'rounded-xl border border-k-border bg-white px-4 py-3';

  const points: MapPoint[] = stops.map((s, i) => ({
    id: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    label: s.name,
    detail: s.place,
    picked: true,
    order: i + 1,
    photoUrl: s.photoUrl,
    tone: s.planned || s.scheduledTime ? 'scheduled' : 'pending',
    badges: [
      ...(s.scheduledTime ? [{ label: tPlan('fixedAt', { time: s.scheduledTime }), tone: 'info' as const }] : []),
      ...(s.planned ? [{ label: tPlan('scheduledTag'), tone: 'warning' as const }] : []),
      ...(conflicts.has(s.id) ? [{ label: t('late'), tone: 'danger' as const }] : []),
    ],
  }));

  const items: OrderItem[] = stops.map((s, i) => {
    const eta = etaOf(s.id);
    return {
      id: s.id,
      name: s.name,
      hint: s.place,
      photos: s.photoUrl ? [s.photoUrl] : undefined,
      meta: eta != null ? addMinutes(start, eta) : undefined,
      tone: s.planned || s.scheduledTime ? 'scheduled' : 'pending',
      badges: points[i]!.badges,
    };
  });

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className={stat}>
          <dd className="text-[22px] font-semibold tabular-nums text-k-navy">{stops.length + extraVisits}</dd>
          <dt className="text-[12px] text-k-text-2">{t('visits')}</dt>
        </div>
        <div className={stat}>
          <dd className="text-[22px] font-semibold tabular-nums text-k-navy">{data?.distanceKm != null ? `${data.distanceKm} km` : '—'}</dd>
          <dt className="text-[12px] text-k-text-2">{t('distance')}</dt>
        </div>
        <div className={stat}>
          <dd className="text-[22px] font-semibold tabular-nums text-k-navy">{data?.minutes != null ? duration(data.minutes) : '—'}</dd>
          <dt className="text-[12px] text-k-text-2">{t('duration')}</dt>
        </div>
        <div className={stat}>
          <dt className="text-[12px] text-k-text-2">
            <label htmlFor="plan-start">{t('start')}</label>
          </dt>
          <dd>
            <input
              id="plan-start"
              type="time"
              value={start}
              onChange={(e) => onStart(e.target.value)}
              className="mt-1 h-9 rounded-lg border border-k-border bg-white px-2 text-[16px] font-semibold tabular-nums text-k-navy outline-none focus:border-k-periwinkle"
            />
          </dd>
        </div>
        <div className={stat}>
          <dd className="text-[22px] font-semibold tabular-nums text-k-navy">{last ?? '—'}</dd>
          <dt className="text-[12px] text-k-text-2">{t('end')}</dt>
        </div>
      </dl>

      {loading && <p className="text-[14px] text-k-text-2">{t('loading')}</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-k-danger bg-k-danger-bg px-3 py-2 text-[13px] text-k-text">
          {error}
        </p>
      )}
      {!loading && data && data.distanceKm == null && <p className="text-[13px] text-k-text-2">{t('noEngine')}</p>}

      {data?.suggestion && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3">
          <p className="text-[14px] text-k-text">{t('suggest', { km: data.suggestion.savedKm, min: data.suggestion.savedMinutes })}</p>
          <button
            type="button"
            onClick={() => onApplyOrder(data.suggestion!.order)}
            className="h-9 rounded-lg border border-k-navy bg-white px-4 text-[13px] font-semibold text-k-navy hover:bg-k-bg"
          >
            {t('applyOrder')}
          </button>
        </div>
      )}

      {conflicts.size > 0 && (
        <p role="alert" className="rounded-xl border border-k-danger bg-k-danger-bg px-4 py-3 text-[13px] text-k-text">
          {t('conflicts', { n: conflicts.size })}
        </p>
      )}

      {extraVisits > 0 && <p className="text-[13px] text-k-text-2">{t('extraVisits', { n: extraVisits })}</p>}

      {/*
        🔴 **El mismo mapa y la misma lista que la ficha y la edición** (F4/12): el recorrido a la izquierda sobre las
        calles, y a la derecha cada parada con su llegada estimada. El pin dice el estado (con aro, si tiene visita
        agendada); lo que se lee en las etiquetas —hora fija, visita agendada, llega tarde— es otra cosa y va aparte.
      */}
      {stops.length > 0 && (
        <MapPanel
          points={points}
          order={items}
          area={null}
          onArea={() => undefined}
          noArea
          alwaysShowList
          listTitle={t('listTitle', { n: stops.length })}
          line={data?.geometry}
          height={380}
          counter={t('mapCount', { n: stops.length })}
        />
      )}
    </div>
  );
}
