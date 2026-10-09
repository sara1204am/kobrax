'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { RADIUS_KM } from '@/lib/plan';
import { BADGE_CLASS, PointsMap, type MapPoint, type PinTone, type PointBadge } from './points-map';

export interface PlanArea {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/** Una parada del recorrido, para el panel de la derecha. */
export interface OrderItem {
  id: string;
  name: string;
  hint?: string;
  /** Ya se gestionó: no se mueve ni se saca. La jornada que pasó no se reescribe. */
  locked?: boolean;
  /** Etiquetas de tinte claro: estado, hora fija, fuente. El color pleno es del pin, no de ellas. */
  badges?: PointBadge[];
  /** Una línea corta a la derecha del nombre: la hora o la llegada estimada. */
  meta?: string;
  /** El estado: pinta el número igual que su pin en el mapa. */
  tone?: PinTone;
  /** Si hay, el nombre es un enlace (a la parada). */
  href?: string;
  /** Acciones propias de la pantalla: «Ver», «Registrar», WhatsApp. */
  trailing?: ReactNode;
}

/** El número de la fila, del mismo color que su pin: la lista y el mapa tienen que decir lo mismo. */
const NUMBER_CLASS: Partial<Record<PinTone, string>> = {
  done: 'bg-k-success',
  next: 'bg-k-purple',
  skipped: 'bg-k-muted',
};

/**
 * El mapa de una ruta **con sus controles y su lista de paradas a la derecha**: buscar por área, ver el recorrido en
 * orden y agrandar.
 *
 * 🔴 Vive en `components/` porque lo usan **todas las pantallas de una ruta**: armarla, ver su vista previa, mirarla
 * y editarla. Son el mismo trabajo —elegir puertas y ponerlas en orden mirando dónde quedan—, y con copias una se queda
 * vieja el día que se toque un detalle (y las pantallas dejan de parecerse).
 *
 * Lo que **no** sabe: qué es una parada, cómo se guarda ni de dónde salen los deudores. Recibe puntos y una lista
 * ordenada, y avisa hacia arriba lo que la persona hizo. Pasar el cursor por una fila resalta su pin y al revés.
 */
export function MapPanel({
  points,
  order,
  area,
  onArea,
  onPointClick,
  onMove,
  onReorder,
  onRemove,
  counter,
  actions,
  initialOrderOpen = false,
  alwaysShowList = false,
  listTitle,
  listWide = false,
  side,
  line,
  height = 220,
  noArea = false,
}: {
  points: MapPoint[];
  /** El recorrido, en orden. Vacío = no hay nada que mostrar y el panel no se ofrece. */
  order: OrderItem[];
  area: PlanArea | null;
  onArea: (area: PlanArea | null) => void;
  onPointClick?: (id: string) => void;
  onMove?: (id: string, delta: number) => void;
  /** Arrastrar una parada a otro lugar del recorrido (F4/12). Sin esto, el orden se cambia solo con las flechas. */
  onReorder?: (id: string, toIndex: number) => void;
  onRemove?: (id: string) => void;
  /** Qué dice la línea de arriba: cuántos hay en el mapa, o en el área. Lo arma cada pantalla. */
  counter: string;
  /** Botones propios de la pantalla —«Editar», «Listo»—, a la derecha de los del mapa. */
  actions?: ReactNode;
  /** Abrir el recorrido de entrada: al editar una ruta ya armada, se vino a acomodarlo. */
  initialOrderOpen?: boolean;
  /** La lista siempre a la vista, sin interruptor: la ficha de la ruta es eso, el mapa y sus paradas. */
  alwaysShowList?: boolean;
  /** El encabezado de la lista; por defecto «Recorrido (N)». */
  listTitle?: string;
  /** Más ancha: las filas de la ficha llevan estado, hora y acciones. */
  listWide?: boolean;
  /** Lo que va **debajo** de la lista, en la misma columna (las sugerencias cercanas). */
  side?: ReactNode;
  /** El camino real por las calles, si el motor de ruteo lo dio. */
  line?: { latitude: number; longitude: number }[];
  /**
   * Alto del mapa chico. Lo piden las pantallas donde el mapa **reemplaza** a otro al cambiar de modo: con dos altos
   * distintos la página pegaba un salto a cada clic.
   */
  height?: number;
  /** Sin búsqueda por área (la ficha en modo lectura no arma nada). */
  noArea?: boolean;
}) {
  const t = useTranslations('panel.routes.planning');
  const [bigMap, setBigMap] = useState(false);
  /** Armando de cero arranca cerrado: el mapa vale más ancho mientras se elige, y ordenar viene después. */
  const [showOrder, setShowOrder] = useState(initialOrderOpen);
  /** La parada bajo el cursor, venga de la fila o del pin. */
  const [hover, setHover] = useState<string | null>(null);

  // Si lo resaltado desaparece con el cursor encima (se quitó la parada), `mouseleave` nunca llega: se suelta acá.
  useEffect(() => {
    if (hover && !points.some((p) => p.id === hover) && !order.some((o) => o.id === hover)) setHover(null);
  }, [hover, points, order]);

  /** «500 m» o «2 km»: media unidad no se dice en decimales cuando hay una unidad más chica. */
  const radioLabel = (km: number) => (km < 1 ? t('areaMeters', { m: km * 1000 }) : t('areaKm', { km }));
  const mapHeight = bigMap ? Math.max(520, height + 200) : height;
  const listOpen = order.length > 0 && (alwaysShowList || (showOrder && !!onMove));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-k-text-2">{counter}</p>

        <div className="flex flex-wrap items-center gap-2">
          {/*
           * 🔴 **Buscar por área.** Enciende un círculo arrastrable y la lista se acota a lo que cae
           * adentro. Filtra en el navegador sobre lo ya cargado, así que moverlo es instantáneo.
           */}
          {!noArea && (
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
          )}

          {area && !noArea && (
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
          {order.length > 0 && onMove && !alwaysShowList && (
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
       * 🔴 **El mapa a la izquierda y el recorrido a la derecha, a la misma altura.** Ordenar mirando
       * sólo una lista de nombres es adivinar: lo que dice si el orden sirve es el mapa, y hay que
       * verlo **mientras** se mueve cada parada. Por eso conviven, y no se turnan.
       *
       * Es la misma disposición en armar, vista previa, ficha y edición: quien aprende una, sabe las demás.
       */}
      <div className="flex flex-col items-stretch gap-3 lg:flex-row-reverse" style={{ ['--map-h' as string]: `${mapHeight}px` }}>
        {(listOpen || side) && (
          <div className={`flex w-full shrink-0 flex-col gap-3 ${listWide ? 'lg:w-[26rem]' : 'lg:w-80'}`}>
            {listOpen && (
              <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-k-border bg-white lg:h-[var(--map-h)]">
                <p className="border-b border-k-border bg-k-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
                  {listTitle ?? t('routeOrder', { n: order.length })}
                </p>
                <ol className="max-h-72 min-h-0 flex-1 divide-y divide-k-border overflow-y-auto lg:max-h-none">
                  {order.map((o, i) => (
                    <li
                      key={o.id}
                      // Arrastrar y soltar: solo las paradas que se pueden mover (una gestionada es la jornada que ya pasó).
                      draggable={!!onReorder && !o.locked}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', o.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (onReorder && !o.locked) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData('text/plain');
                        if (id && id !== o.id && !o.locked) onReorder?.(id, i);
                      }}
                      onMouseEnter={() => setHover(o.id)}
                      onMouseLeave={() => setHover(null)}
                      className={`flex items-start gap-2 px-3 py-2.5 text-[13px] ${hover === o.id ? 'bg-k-highlight' : ''} ${
                        onReorder && !o.locked ? 'cursor-grab active:cursor-grabbing' : ''
                      }`}
                    >
                      {onReorder && !o.locked && (
                        <span aria-hidden className="mt-1 shrink-0 select-none text-[14px] leading-none text-k-muted">
                          ⠿
                        </span>
                      )}
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
                          (o.tone && NUMBER_CLASS[o.tone]) ?? 'bg-k-navy'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        {o.href ? (
                          <Link href={o.href} className="block truncate font-medium text-k-text hover:underline">
                            {o.name}
                          </Link>
                        ) : (
                          <span className="block truncate text-k-text">{o.name}</span>
                        )}
                        {o.hint && <span className="block truncate text-[12px] text-k-text-2">{o.hint}</span>}
                        {o.badges && o.badges.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {o.badges.map((b, bi) => (
                              <span key={`${bi}-${b.label}`} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_CLASS[b.tone]}`}>
                                {b.label}
                              </span>
                            ))}
                          </span>
                        )}
                        {o.trailing && <span className="mt-1.5 flex flex-wrap items-center gap-1.5">{o.trailing}</span>}
                      </span>
                      {o.meta && <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-k-text-2">{o.meta}</span>}
                      {/* La parada gestionada no ofrece botones: es una explicación, no un control
                          apagado — un ✕ en gris invita a insistir. */}
                      {onMove &&
                        (o.locked ? (
                          <span className="shrink-0 pt-0.5 text-[11px] text-k-muted">{t('lockedStop')}</span>
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
                        ))}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {side}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {points.length > 0 || area ? (
            <PointsMap
              points={points}
              // Agrandar tiene que notarse: sobre un mapa que ya arranca alto, 520 casi no cambia nada.
              height={mapHeight}
              line={line}
              focusId={hover}
              onPointHover={setHover}
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
  children: ReactNode;
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
