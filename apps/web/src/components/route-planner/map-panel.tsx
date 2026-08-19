'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RADIUS_KM } from '@/lib/plan';
import { PointsMap, type MapPoint } from './points-map';

export interface PlanArea {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/** Una parada del recorrido, para el panel de orden. */
export interface OrderItem {
  id: string;
  name: string;
  hint?: string;
  /** Ya se gestionó: no se mueve ni se saca. La jornada que pasó no se reescribe. */
  locked?: boolean;
}

/**
 * El mapa de una ruta **con sus controles**: buscar por área, ver el recorrido en orden y agrandar.
 *
 * 🔴 Vive en `components/` porque lo usan **las dos pantallas que arman una ruta**: la que la crea y
 * la que la edita. Son el mismo trabajo —elegir puertas y ponerlas en orden mirando dónde quedan—, y
 * con dos copias una de las dos se queda vieja el día que se toque un detalle.
 *
 * Lo que **no** sabe: qué es una parada, cómo se guarda ni de dónde salen los deudores. Recibe
 * puntos y una lista ordenada, y avisa hacia arriba lo que la persona hizo.
 */
export function MapPanel({
  points,
  order,
  area,
  onArea,
  onPointClick,
  onMove,
  onRemove,
  counter,
  actions,
  initialOrderOpen = false,
  height = 220,
}: {
  points: MapPoint[];
  /** El recorrido, en orden. Vacío = no hay nada que ordenar y el panel no se ofrece. */
  order: OrderItem[];
  area: PlanArea | null;
  onArea: (area: PlanArea | null) => void;
  onPointClick?: (id: string) => void;
  onMove?: (id: string, delta: number) => void;
  onRemove?: (id: string) => void;
  /** Qué dice la línea de arriba: cuántos hay en el mapa, o en el área. Lo arma cada pantalla. */
  counter: string;
  /** Botones propios de la pantalla —«Editar», «Listo»—, a la derecha de los del mapa. */
  actions?: React.ReactNode;
  /** Abrir el recorrido de entrada: al editar una ruta ya armada, se vino a acomodarlo. */
  initialOrderOpen?: boolean;
  /**
   * Alto del mapa chico. Lo pide la ficha de la ruta: ahí el mapa **reemplaza** al de siempre al
   * entrar a editar, y con dos altos distintos la página pegaba un salto a cada clic.
   */
  height?: number;
}) {
  const t = useTranslations('panel.routes.planning');
  const [bigMap, setBigMap] = useState(false);
  /** Armando de cero arranca cerrado: el mapa vale más ancho mientras se elige, y ordenar viene después. */
  const [showOrder, setShowOrder] = useState(initialOrderOpen);

  /** «500 m» o «2 km»: media unidad no se dice en decimales cuando hay una unidad más chica. */
  const radioLabel = (km: number) => (km < 1 ? t('areaMeters', { m: km * 1000 }) : t('areaKm', { km }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-k-text-2">{counter}</p>

        <div className="flex flex-wrap items-center gap-2">
          {/*
           * 🔴 **Buscar por área.** Enciende un círculo arrastrable y la lista se acota a lo que cae
           * adentro. Filtra en el navegador sobre lo ya cargado, así que moverlo es instantáneo.
           */}
          <button
            type="button"
            onClick={() => {
              if (area) return onArea(null);
              const primero = points[0];
              if (primero) onArea({ latitude: primero.latitude, longitude: primero.longitude, radiusKm: 1 });
            }}
            aria-pressed={area != null}
            className={`h-8 rounded-lg border px-3 text-[13px] font-medium ${
              area
                ? 'border-k-periwinkle bg-k-highlight text-k-periwinkle'
                : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
            }`}
          >
            {area ? t('areaOff') : t('areaOn')}
          </button>

          {area && (
            <label className="flex items-center gap-1.5 text-[13px] text-k-text-2">
              {t('areaRadius')}
              <select
                value={area.radiusKm}
                onChange={(e) => onArea({ ...area, radiusKm: Number(e.target.value) })}
                className="h-8 rounded-lg border border-k-border bg-white px-2 text-[13px] text-k-text outline-none focus:border-k-periwinkle"
              >
                {RADIUS_KM.map((km) => (
                  <option key={km} value={km}>
                    {radioLabel(km)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Ordenar es una tarea del mapa —se acomoda mirando dónde queda cada puerta—, así que su
              interruptor está donde está la vista. */}
          {order.length > 0 && onMove && (
            <button
              type="button"
              onClick={() => setShowOrder((v) => !v)}
              aria-pressed={showOrder}
              className={`h-8 rounded-lg border px-3 text-[13px] font-medium ${
                showOrder ? 'border-k-navy bg-k-navy text-white' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
              }`}
            >
              {showOrder ? t('hideOrder') : t('showOrder', { n: order.length })}
            </button>
          )}

          <button
            type="button"
            onClick={() => setBigMap((v) => !v)}
            aria-expanded={bigMap}
            className="h-8 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            {bigMap ? t('mapSmall') : t('mapBig')}
          </button>

          {actions}
        </div>
      </div>

      {/*
       * 🔴 **El recorrido a la izquierda y el mapa a la derecha, a la misma altura.** Ordenar mirando
       * sólo una lista de nombres es adivinar: lo que dice si el orden sirve es el mapa, y hay que
       * verlo **mientras** se mueve cada parada. Por eso conviven, y no se turnan.
       *
       * La columna no fija su alto: en una fila flex se estira hasta el del mapa sola.
       */}
      <div className="flex flex-col items-stretch gap-3 lg:flex-row">
        {showOrder && order.length > 0 && onMove && (
          <div className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-k-border bg-white lg:w-80">
            <p className="border-b border-k-border bg-k-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
              {t('routeOrder', { n: order.length })}
            </p>
            <ol className="max-h-64 min-h-0 flex-1 divide-y divide-k-border overflow-y-auto lg:max-h-none">
              {order.map((o, i) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-k-navy text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-k-text">{o.name}</span>
                    {o.hint && <span className="block truncate text-[11px] text-k-muted">{o.hint}</span>}
                  </span>
                  {/* La parada gestionada no ofrece botones: es una explicación, no un control
                      apagado — un ✕ en gris invita a insistir. */}
                  {o.locked ? (
                    <span className="shrink-0 text-[11px] text-k-muted">{t('lockedStop')}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1">
                      <OrderButton onClick={() => onMove(o.id, -1)} disabled={i === 0} label={t('moveUp')}>
                        ↑
                      </OrderButton>
                      <OrderButton onClick={() => onMove(o.id, 1)} disabled={i === order.length - 1} label={t('moveDown')}>
                        ↓
                      </OrderButton>
                      {onRemove && (
                        <OrderButton onClick={() => onRemove(o.id)} label={t('removeStop')}>
                          ✕
                        </OrderButton>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {points.length > 0 || area ? (
            <PointsMap
              points={points}
              // Agrandar tiene que notarse: sobre un mapa que ya arranca alto, 520 casi no cambia nada.
              height={bigMap ? Math.max(520, height + 200) : height}
              // El radio escrito viaja al mapa: la etiqueta del borde y el select dicen lo mismo.
              circle={area ? { ...area, label: radioLabel(area.radiusKm) } : undefined}
              // Al soltar el círculo, no en cada frame: filtrar cien filas sesenta veces por segundo
              // es lo único que puede volver esto lento.
              onCircleMove={(centro) => onArea(area ? { ...area, ...centro } : null)}
              onPointClick={onPointClick}
            />
          ) : (
            <p className="rounded-2xl border border-k-border bg-white px-4 py-3 text-[13px] text-k-text-2">
              {t('mapNoPoints')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Mover o quitar una parada. Chico, pero con nombre: la flecha sola no dice qué hace. */
function OrderButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-lg border border-k-border text-[12px] text-k-text-2 hover:bg-k-bg disabled:opacity-30"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
