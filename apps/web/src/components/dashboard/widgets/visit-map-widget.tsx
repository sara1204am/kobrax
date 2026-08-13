'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { VisitMapPoint } from '@kobrax/shared';

/**
 * Las paradas del día en el mapa.
 *
 * 🔴 **`maplibre-gl` se carga aparte y sólo si esta pantalla se abre**: son 250 kB, y `/dashboard`
 * es el aterrizaje de TODO el mundo. Importado derecho, cada persona que entra al panel los baja
 * aunque nunca mire el mapa. `ssr: false` porque la librería toca `window` al construirse.
 *
 * Reusa el `RouteMap` de W6 —el mismo que ya dibuja `/rutas/[id]`— con dos cambios chicos: los
 * pines se pintan por estado y **no se unen con una línea**, porque acá conviven once rutas
 * distintas y unirlas dibujaría un recorrido que nadie hizo.
 */
const RouteMap = dynamic(() => import('@/components/route-map').then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full animate-pulse rounded-2xl bg-k-light-bg" />,
});

export function VisitMapWidget({ points }: { points: VisitMapPoint[] }) {
  const t = useTranslations('panel.dashboard');
  if (points.length === 0) return <p className="text-[13px] text-k-text-2">{t('noVisits')}</p>;

  const done = points.filter((p) => p.status === 'VISITED').length;

  return (
    <>
      <RouteMap
        height={300}
        connect={false}
        stops={points.map((p) => ({
          id: p.stopId,
          sequenceOrder: p.sequenceOrder,
          latitude: p.latitude,
          longitude: p.longitude,
          tone: p.status === 'VISITED' ? 'done' : 'pending',
        }))}
      />
      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-k-text-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-k-success" aria-hidden />
          {t('map.done', { n: done })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-k-muted" aria-hidden />
          {t('map.pending', { n: points.length - done })}
        </span>
      </div>
    </>
  );
}
