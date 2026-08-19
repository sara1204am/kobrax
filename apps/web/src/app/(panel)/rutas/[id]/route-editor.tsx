'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { RouteStopStatus, type CaseListItem, type RouteStopItem } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { RouteMap } from '@/components/route-map';
import { AvailableList } from '@/components/route-planner/available-list';
import { MapPanel, type PlanArea } from '@/components/route-planner/map-panel';
import { FilterPanel } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { sendJson, postJson } from '@/lib/client';
import { money, time } from '@/lib/format';
import { AVAILABLE_LIMIT, withinRadius } from '@/lib/plan';
import { STOP_STATUS_TONE } from '@/lib/routes';
import { planFilterDefs, PLAN_FILTER_KEYS } from '../planificar/plan-filters';

/**
 * La ruta armada: **el mapa, sus paradas y —cuando se enciende— la edición**.
 *
 * 🔴 Editar acá es **el mismo trabajo que armarla**: elegir puertas mirando dónde quedan y ponerlas
 * en orden. Por eso usa los mismos componentes que la pantalla de crear (`MapPanel`, `AvailableList`,
 * `FilterPanel`) y no una segunda versión: con dos, una se queda vieja el día que se toque un detalle.
 *
 * 🔴 **Sólo se toca lo que sigue pendiente.** Una parada visitada o salteada es historia de la
 * jornada —hay una visita con hora, GPS y a veces una foto colgando de ella—: moverla cambiaría el
 * orden de algo que ya pasó y quitarla borraría la prueba. La guarda de verdad es del servidor
 * (`ROUTE_STOP_DONE`); esconder controles es cortesía.
 *
 * 🔴 **El modo edición vive en la URL** (`?editar=1`), y no en un `useState`: la mora que se puede
 * sumar la trae el servidor, así que entrar a editar es pedirle esa lista. Un booleano local no
 * podría traerla.
 *
 * 🔴 **Cada acción va sola al servidor y se recarga.** Reordenar mueve la lista entera del lado de la
 * API —el número de parada es único por ruta—, así que guardar un orden armado en el navegador
 * exigiría replicar esa lógica acá y mantener las dos iguales para siempre.
 */
/**
 * El alto de los DOS mapas de esta ficha. Uno reemplaza al otro al entrar y salir de la edición: con
 * altos distintos, todo lo que está abajo saltaba a cada clic.
 */
const MAP_HEIGHT = 420;

export function RouteEditor({
  routeId,
  stops,
  visits,
  line,
  editing,
  available,
  total,
  filtered,
}: {
  routeId: string;
  stops: RouteStopItem[];
  visits: { latitude: number; longitude: number }[];
  /** El recorrido por las calles. Vacío si el motor de ruteo no contestó: el mapa se dibuja igual. */
  line: { latitude: number; longitude: number }[];
  editing: boolean;
  /** La mora que se puede sumar. Sólo se pide cuando se está editando. */
  available: CaseListItem[];
  total: number;
  filtered: boolean;
}) {
  const t = useTranslations('panel.routes');
  const tPlan = useTranslations('panel.routes.planning');
  const tFilters = useTranslations('panel.routes.planning.filters');
  const tCases = useTranslations('panel.cases');
  const tTable = useTranslations('panel.table');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [panelOpen, setPanelOpen] = useState(filtered);
  const [area, setArea] = useState<PlanArea | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendientes = stops.filter((s) => s.status === RouteStopStatus.PENDING).length;

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setError(null);
    router.push(`${pathname}?${next}`);
  }

  /** Salir de la edición: se vuelve a la vista de siempre y los filtros se van con ella. */
  const salir = () => go(Object.fromEntries([...PLAN_FILTER_KEYS, 'editar', 'dir'].map((k) => [k, null])));

  async function run(key: string, fn: () => Promise<{ ok: boolean; data: { error?: { message?: string } } }>) {
    setBusy(key);
    setError(null);
    const { ok, data } = await fn();
    setBusy(null);
    // El mensaje del servidor es el que sabe por qué: la parada ya se gestionó, la ruta no es tuya.
    if (!ok) return setError(data.error?.message ?? t('edit.error'));
    router.refresh();
  }

  const move = (stopId: string, delta: number) => {
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) return;
    void run(stopId, () =>
      sendJson(`/api/routes/${routeId}/stops/${stopId}`, { sequenceOrder: stop.sequenceOrder + delta }, 'PATCH'),
    );
  };

  const remove = (stopId: string) =>
    void run(stopId, () => sendJson(`/api/routes/${routeId}/stops/${stopId}`, null, 'DELETE'));

  /**
   * Sumar un deudor a la ruta. Va con **cliente y caso**: el cliente es lo que la parada necesita
   * para tener dirección y punto, y el caso es contra qué se cobra cuando el cobrador llegue.
   */
  const add = (caseId: string) => {
    const caso = available.find((c) => c.id === caseId);
    if (!caso) return;
    void run(caseId, () => postJson(`/api/routes/${routeId}/stops`, { clientId: caso.clientId, caseId }));
  };

  /*
   * Un clic en el mapa: si el punto es una parada, se saca; si es mora disponible, se suma. Un solo
   * camino con la lista y el panel de orden — con dos, un día el mapa y la tabla dejan de coincidir.
   */
  const clickPunto = (id: string) => (stops.some((s) => s.id === id) ? remove(id) : add(id));

  /** Las filas de abajo: primero el área —si está puesta—, y el orden lo resuelve la lista. */
  const filas = useMemo(
    () => (area ? withinRadius(available, area, area.radiusKm) : available),
    [available, area],
  );

  /*
   * Los pines. **Las paradas siempre**, numeradas: son la ruta. Y con área puesta, además, la mora
   * disponible que cae adentro — que es lo que se está por sumar.
   */
  const puntos = useMemo(() => {
    const deParadas = stops.flatMap((s) =>
      s.latitude != null && s.longitude != null
        ? [{
            id: s.id,
            latitude: s.latitude,
            longitude: s.longitude,
            label: s.clientName ?? undefined,
            detail: s.address ?? undefined,
            picked: true,
            order: s.sequenceOrder,
          }]
        : [],
    );
    if (!area) return deParadas;

    const disponibles = filas.flatMap((c) => {
      const loc = c.locations?.[0];
      return loc
        ? [{
            id: c.id,
            latitude: loc.latitude,
            longitude: loc.longitude,
            label: c.clientName ?? undefined,
            detail: [money(c.amount, c.currency ?? 'BOB'), c.daysPastDue ? tPlan('days', { n: c.daysPastDue }) : null, c.zone ?? null]
              .filter(Boolean)
              .join(' · '),
            picked: false,
          }]
        : [];
    });
    return [...disponibles, ...deParadas];
  }, [stops, area, filas, tPlan]);

  const orden = useMemo(
    () =>
      stops.map((s) => ({
        id: s.id,
        name: s.clientName ?? '—',
        hint: s.address ?? undefined,
        locked: s.status !== RouteStopStatus.PENDING,
      })),
    [stops],
  );

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-xl border border-k-danger bg-k-danger-bg px-4 py-3 text-[13px] text-k-text">
          {error}
        </p>
      )}

      {editing ? (
        <>
          <MapPanel
            points={puntos}
            order={orden}
            area={area}
            onArea={setArea}
            onPointClick={clickPunto}
            onMove={move}
            onRemove={remove}
            // Entrando a editar, el recorrido ya abierto: se vino a acomodarlo, no a buscarlo.
            initialOrderOpen
            // El mismo alto que el mapa de siempre: acá uno reemplaza al otro, y con altos distintos
            // la página pegaba un salto a cada clic en «Editar».
            height={MAP_HEIGHT}
            counter={
              area ? tPlan('mapInArea', { n: puntos.length, km: area.radiusKm }) : t('edit.mapCount', { n: puntos.length })
            }
            actions={
              <button
                type="button"
                onClick={salir}
                className="h-8 rounded-lg border border-k-navy bg-k-navy px-3 text-[13px] font-medium text-white hover:bg-k-slate"
              >
                {t('edit.done')}
              </button>
            }
          />

          <p className="rounded-xl border border-k-border bg-k-bg px-4 py-2.5 text-[13px] text-k-text-2">
            {t('edit.hint')}
          </p>

          {/* Abajo, para sumar: la misma lista con los mismos filtros que arma la ruta la primera vez. */}
          <div className="flex flex-col gap-5 lg:flex-row">
            {panelOpen && (
              <FilterPanel
                defs={planFilterDefs(tFilters, tCases, t)}
                params={params}
                go={go}
                onClose={() => setPanelOpen(false)}
                onClear={() => go(Object.fromEntries(PLAN_FILTER_KEYS.map((k) => [k, null])))}
              />
            )}

            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPanelOpen((v) => !v)}
                  aria-expanded={panelOpen}
                  className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-4 text-[14px] font-medium ${
                    filtered
                      ? 'border-k-periwinkle bg-k-highlight text-k-periwinkle'
                      : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
                  }`}
                >
                  <span aria-hidden>⚟</span>
                  {tTable('appliedFilters')}
                </button>
                <span className="min-w-[220px] flex-1">
                  <SearchBox wide flush label={tPlan('filters.search')} placeholder={tPlan('filters.search')} />
                </span>
              </div>

              <section className="rounded-2xl border border-k-border bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[16px] font-semibold text-k-navy">{t('edit.addTitle')}</h2>
                  {/* Cuántos hay de verdad y cuántos se pueden mirar: la lista tiene techo y se dice. */}
                  <p className="text-[13px] text-k-text-2">
                    {total > AVAILABLE_LIMIT
                      ? tPlan('foundCapped', { n: total, shown: available.length })
                      : tPlan('found', { n: total })}
                  </p>
                </div>

                {/* Sin `picked`: lo que entra a la ruta desaparece de acá y aparece en el recorrido —
                    la API no vuelve a ofrecer un caso que ya es parada de una ruta de ese día. */}
                <AvailableList
                  rows={filas}
                  picked={[]}
                  onToggle={add}
                  emptyTitle={filtered ? tPlan('noResults') : tPlan('noAvailable')}
                  emptyText={filtered ? tPlan('noResultsText') : tPlan('noAvailableText')}
                  remoteSort={params.get('sort')}
                  remoteDir={params.get('dir') === 'asc' ? 'asc' : 'desc'}
                  onSortRemote={(key) =>
                    go({ sort: key, dir: params.get('sort') === key && params.get('dir') === 'desc' ? 'asc' : 'desc' })
                  }
                />
              </section>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* El botón arriba del mapa, igual que al armarla: se edita mirando dónde queda cada puerta. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[18px] font-semibold text-k-navy">{t('detail.stops')}</h2>
            {/* Sin ninguna pendiente no hay nada que editar: la jornada ya pasó entera. */}
            {pendientes > 0 && (
              <button
                type="button"
                onClick={() => go({ editar: '1' })}
                className="h-9 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
              >
                {t('edit.start')}
              </button>
            )}
          </div>

          <RouteMap
            stops={stops.map((s) => ({
              id: s.id,
              sequenceOrder: s.sequenceOrder,
              latitude: s.latitude,
              longitude: s.longitude,
              label: s.clientName,
            }))}
            visits={visits}
            line={line}
            height={MAP_HEIGHT}
          />
          {/*
            🔴 Se mira la GEOMETRÍA, no el status: cuando el motor de ruteo está caído la API degrada
            con 200 y una geometría vacía, así que preguntar por el status dejaba el aviso sin
            dibujarse nunca — justo el «mapa con rectas y sin explicación» que se quería evitar.
          */}
          {line.length === 0 && <p className="text-[13px] text-k-text-2">{t('detail.noPreview')}</p>}

          <ol className="space-y-2">
            {stops.map((stop) => (
              <li
                key={stop.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-k-border bg-white px-5 py-3.5 ${
                  busy === stop.id ? 'opacity-50' : ''
                }`}
              >
                {/* La hora si ya se visitó, y si no el número: el orden planificado deja de importar
                    apenas la jornada arranca. */}
                <span className="w-12 shrink-0 text-[14px] font-semibold tabular-nums text-k-navy">
                  {stop.visitedAt ? time(stop.visitedAt, locale) : stop.sequenceOrder}
                </span>

                <a href={`/rutas/${routeId}/parada/${stop.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate text-[15px] font-medium text-k-text">{stop.clientName ?? '—'}</span>
                  <span className="block truncate text-[13px] text-k-text-2">{stop.address ?? '—'}</span>
                </a>

                {/* Cómo terminó pesa más que en qué estado quedó la parada: es lo que se vino a mirar. */}
                {stop.lastOutcome ? (
                  <Badge tone="neutral">{t(`outcome.${stop.lastOutcome}`)}</Badge>
                ) : (
                  <Badge tone={STOP_STATUS_TONE[stop.status]}>{t(`stopStatus.${stop.status}`)}</Badge>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
