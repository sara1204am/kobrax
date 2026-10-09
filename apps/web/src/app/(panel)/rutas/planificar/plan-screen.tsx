'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, type Member, type RouteItem } from '@kobrax/shared';
import { Card, InfoTip } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { FilterPanel } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { AvailableList } from '@/components/route-planner/available-list';
import { MapPanel, type PlanArea } from '@/components/route-planner/map-panel';
import { candidatePins, describeLocation, parsePinId } from '@/components/route-planner/candidate-pins';
import type { MapPoint } from '@/components/route-planner/points-map';
import { postJson } from '@/lib/client';
import { dayDate, money } from '@/lib/format';
import { AVAILABLE_LIMIT, defaultLocation, shiftDays, withinRadius, type AvailableCredit } from '@/lib/plan';
import type { PlanRow } from '@/app/api/routes/plan/route';
import { planFilterDefs, PLAN_FILTER_KEYS } from './plan-filters';
import { PlanLocationDialog, type ChosenLocation } from './plan-location-dialog';
import { PlanPreview, type PreviewStop } from './plan-preview';

/** Una visita agendada para ese día y ese cobrador: entra sola a la ruta, así que se muestra y se cuenta. */
export interface PlannedVisit {
  id: string;
  creditId: string;
  clientName?: string;
  creditCode?: string;
  /** `HH:mm` si es de hora fija. */
  time?: string;
  priority?: string;
}

const STEPS = ['date', 'clients', 'order', 'preview'] as const;
type Step = (typeof STEPS)[number];

/**
 * Armarle la ruta a **un cobrador**, **en cuatro pasos** (F4/12):
 *
 *  1. **Fecha y cobrador** — qué día, a quién, y qué visitas agendadas tiene ya ese día (entran solas a la ruta).
 *  2. **Clientes y ubicaciones** — los candidatos con sus filtros, y **a qué ubicación se va** con cada uno (domicilio, trabajo,
 *     garante…). Una parada sin punto en el mapa no se publica: se resuelve ahí mismo.
 *  3. **Mapa y orden** — el recorrido sobre el mapa, arrastrando para ordenar.
 *  4. **Vista previa** — kilómetros, duración, hora de llegada a cada parada y, si da vueltas de más, el orden sugerido.
 *     Recién ahí se **publica** (y al cobrador le llega el aviso).
 *
 * 🔴 **La selección no viaja en la URL** (los filtros sí). Marcar clientes es un borrador de trabajo, no una vista que
 * alguien quiera compartir por link; y meterla en la URL haría que cada tilde navegara y recargara la lista entera.
 *
 * 🔴 **Cambiar de cobrador o de fecha vuelve a empezar** —con las visitas agendadas de esa persona ya marcadas—: si lo
 * elegido sobreviviera, el contador diría «6 elegidas» sin seis filas a la vista, y se publicaría una ruta con gente que la
 * persona no está mirando.
 *
 * El mapa, el panel de orden y la lista son **los mismos componentes que usa la edición de una ruta ya creada**: es el
 * mismo trabajo, y con dos copias una se queda vieja.
 */
export function PlanScreen({
  day,
  today,
  collectors,
  collectorId,
  available,
  total,
  routes,
  minStops,
  filtered,
  categories,
  visits,
}: {
  day: string;
  today: string;
  collectors: Member[];
  collectorId: string;
  /** Créditos en mora que se pueden asignar (`id` = creditId). */
  available: AvailableCredit[];
  /** Cuántos hay en total con esos filtros; la lista trae hasta `AVAILABLE_LIMIT`. */
  total: number;
  routes: RouteItem[];
  minStops: number;
  filtered: boolean;
  /** Las categorías de mora de la cuenta, para el filtro. */
  categories: { code: string; name: string }[];
  /** Las visitas agendadas de ESE cobrador para ESE día. */
  visits: PlannedVisit[];
}) {
  const t = useTranslations('panel.routes.planning');
  const tFilters = useTranslations('panel.routes.planning.filters');
  const tOutcome = useTranslations('panel.routes.outcome');
  const tTable = useTranslations('panel.table');
  const tType = useTranslations('portfolio.locationType');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();

  /*
   * 🔴 **Si ya vienen el día y el cobrador, el paso 1 sobra**: llegaron desde el tablero de Rutas, donde ya se eligieron.
   * Se decide una sola vez, al abrir —`go()` también los pone en la URL—, y «Cambiar» lo reabre sin que el efecto de abajo
   * lo devuelva a clientes en cuanto la persona toque otro cobrador.
   */
  // Sólo cuenta si el cobrador existe: con un id inventado la página cae en el primer cobrador y el banner mentiría.
  const withContext = useRef(params.has('date') && collectors.some((c) => c.userId === params.get('collectorId')));
  const reopened = useRef(false);
  const firstStep = (): Step => (withContext.current && !reopened.current ? 'clients' : 'date');

  const filters = planFilterDefs(tFilters, categories, tOutcome);
  // El panel abre solo si ya hay un filtro puesto: si no, uno activo quedaría escondido y la lista
  // saldría corta sin que nada lo explique. Mismo criterio que el `DataTable`.
  const [panelOpen, setPanelOpen] = useState(filtered);
  const [step, setStep] = useState<Step>(firstStep);
  const [picked, setPicked] = useState<string[]>([]);
  const [area, setArea] = useState<PlanArea | null>(null);
  /** La ubicación que se eligió para cada crédito, si no es la predeterminada. */
  const [chosen, setChosen] = useState<Record<string, ChosenLocation>>({});
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  const [start, setStart] = useState('08:30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const byId = useMemo(() => new Map(available.map((c) => [c.id, c])), [available]);
  /** Quién ya tiene su ruta armada ese día, y con cuántas paradas. */
  const byCollector = new Map(routes.map((r) => [r.collectorId, r]));
  const actual = collectors.find((c) => c.userId === collectorId);
  const suRuta = byCollector.get(collectorId);
  const plannedIds = useMemo(() => new Set(visits.map((v) => v.creditId)), [visits]);
  const visitTime = useMemo(() => new Map(visits.filter((v) => v.time).map((v) => [v.creditId, v.time!])), [visits]);

  /*
   * Al cambiar de cobrador o de día se arranca de cero, **con sus visitas agendadas ya marcadas** (las que se pueden dibujar):
   * son compromisos con día y entran a la ruta de todos modos; marcarlas es mostrarlo, y deja ordenarlas.
   */
  const visitsKey = visits.map((v) => v.creditId).join('|');
  useEffect(() => {
    setPicked(visits.map((v) => v.creditId).filter((id) => byId.has(id)));
    setChosen({});
    setStep(firstStep());
    setDone(null);
    setError(null);
    // `available` cambia con los filtros y no debe volver a marcar nada: solo cobrador y día reinician.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectorId, day, visitsKey]);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setError(null);
    router.push(`${pathname}?${next}`);
  }

  /** Marcar o desmarcar. **Un solo camino**, lo toque la casilla de la lista o su punto en el mapa. */
  const toggle = (id: string) => {
    // Al desmarcar se olvida la ubicación elegida: si vuelve a marcarse, entra con la predeterminada y no con la de antes.
    if (picked.includes(id)) {
      setChosen((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    }
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /**
   * Mover una parada. 🔴 **El orden de `picked` ES el orden de la ruta**: viaja así a la API, que lo respeta en vez de
   * reordenar por prioridad. Mover acá es mover la jornada del cobrador.
   */
  function move(id: string, delta: number) {
    setPicked((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  /** Arrastrar una parada a otro lugar del recorrido. */
  function reorder(id: string, toIndex: number) {
    setPicked((prev) => {
      const from = prev.indexOf(id);
      if (from < 0 || from === toIndex) return prev;
      const next = prev.filter((x) => x !== id);
      next.splice(toIndex, 0, id);
      return next;
    });
  }

  /** La ubicación con la que va cada parada: la que se eligió, o la predeterminada del cliente (su domicilio). */
  function placeOf(creditId: string): { id?: string; label: string; latitude?: number; longitude?: number } {
    const picked = chosen[creditId];
    if (picked) return picked;
    const c = byId.get(creditId);
    const loc = defaultLocation(c?.locations);
    if (!loc) return { label: '' };
    return { id: loc.id, label: describeLocation(loc, (type) => tType(type as 'HOME')), latitude: loc.latitude, longitude: loc.longitude };
  }
  const hasPoint = (id: string) => {
    const p = placeOf(id);
    return p.latitude != null && p.longitude != null;
  };
  /** Las elegidas a las que todavía les falta un punto en el mapa: sin él no hay recorrido ni hora de llegada. */
  const missing = picked.filter((id) => !hasPoint(id));

  async function confirmar() {
    setBusy(true);
    setError(null);
    const locations = Object.fromEntries(picked.flatMap((id) => {
      const p = placeOf(id);
      return p.id ? [[id, p.id] as const] : [];
    }));
    const { ok, data } = await postJson<{ rows: PlanRow[] }>('/api/routes/plan', {
      plannedDate: day,
      assignments: [{ collectorId, creditIds: picked, locations }],
      // Sin punto en el mapa no se publica (decisión 6): la API lo exige y dice cuáles faltan.
      requirePoints: true,
    });
    setBusy(false);
    if (!ok) return setError(data.error?.message ?? t('error'));

    const row = data.rows[0];
    if (row?.error) return setError(row.error);
    setDone(t('routeDone', { name: actual ? memberName(actual) : '', n: picked.length }));
    setPicked([]);
    setStep(firstStep());
    // La ruta recién creada tiene que aparecer en el progreso y su mora salir de la lista.
    router.refresh();
  }

  const pendientes = collectors.filter((c) => !byCollector.has(c.userId));
  const siguiente = pendientes.find((c) => c.userId !== collectorId);
  const corto = picked.length > 0 && picked.length < minStops;
  const extraVisits = visits.filter((v) => !byId.has(v.creditId) && !picked.includes(v.creditId)).length;

  /** Las filas: primero el área —si está puesta—, y el orden lo resuelve la lista. */
  const filas = useMemo(() => (area ? withinRadius(available, area, area.radiusKm) : available), [available, area]);

  /*
   * Los pines del mapa. **Con área puesta**, los que se pueden elegir ahí adentro: es lo que se está buscando. **Sin área**,
   * sólo lo marcado — que es la ruta que se arma — con el número de su lugar en el recorrido y en SU ubicación elegida.
   */
  const puntos = useMemo<MapPoint[]>(() => {
    const pickedPins = picked.flatMap((id, i) => {
      const c = byId.get(id);
      const p = placeOf(id);
      if (!c || p.latitude == null || p.longitude == null) return [];
      const fixed = visitTime.get(id);
      const planned = plannedIds.has(id);
      return [{
        id,
        latitude: p.latitude,
        longitude: p.longitude,
        label: c.clientName ?? undefined,
        detail: p.label || undefined,
        picked: true,
        order: i + 1,
        tone: planned || fixed ? ('scheduled' as const) : ('pending' as const),
        badges: [
          ...(fixed ? [{ label: t('fixedAt', { time: fixed }), tone: 'info' as const }] : []),
          ...(planned ? [{ label: t('scheduledTag'), tone: 'warning' as const }] : []),
        ],
      }];
    });
    if (!area) return pickedPins;
    // Con área puesta, **cada ubicación** de lo que se puede elegir ahí adentro: es lo que se está buscando.
    const around = candidatePins(filas, {
      skip: new Set(picked),
      typeLabel: (type) => tType(type as 'HOME'),
      detail: (c) => [money(c.amount, c.currency ?? 'BOB'), c.daysPastDue ? t('days', { n: c.daysPastDue }) : null, c.zone ?? null].filter(Boolean).join(' · '),
    });
    return [...around, ...pickedPins];
    // `placeOf` lee `chosen` y `byId`: están en las dependencias de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, filas, picked, chosen, byId, t, plannedIds, visitTime]);

  /** Un pin de candidato lo elige **con su ubicación**; uno ya elegido lo saca. */
  function pickPin(pin: string) {
    const { creditId, locationId } = parsePinId(pin);
    if (picked.includes(creditId)) return toggle(creditId);
    toggle(creditId);
    const loc = locationId ? byId.get(creditId)?.locations?.find((l) => l.id === locationId) : undefined;
    if (loc?.id) {
      setChosen((prev) => ({
        ...prev,
        [creditId]: { id: loc.id!, label: describeLocation(loc, (type) => tType(type as 'HOME')), latitude: loc.latitude, longitude: loc.longitude },
      }));
    }
  }

  const orden = useMemo(
    () =>
      picked.map((id) => {
        const c = byId.get(id);
        const time = visitTime.get(id);
        return {
          id,
          name: c?.clientName ?? '—',
          hint: placeOf(id).label || c?.zone || undefined,
          tone: plannedIds.has(id) || time ? ('scheduled' as const) : ('pending' as const),
          badges: [
            ...(time ? [{ label: t('fixedAt', { time }), tone: 'info' as const }] : []),
            ...(plannedIds.has(id) ? [{ label: t('scheduledTag'), tone: 'warning' as const }] : []),
          ],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, byId, chosen, visitTime, plannedIds, t],
  );

  const previewStops: PreviewStop[] = picked.flatMap((id) => {
    const c = byId.get(id);
    const p = placeOf(id);
    return c && p.latitude != null && p.longitude != null
      ? [{ id, name: c.clientName ?? '—', place: p.label || '—', latitude: p.latitude, longitude: p.longitude, scheduledTime: visitTime.get(id), planned: plannedIds.has(id) }]
      : [];
  });

  const dialogCredit = dialogFor ? byId.get(dialogFor) : undefined;
  const stepIndex = STEPS.indexOf(step);
  const daysAhead = Array.from({ length: 7 }, (_, i) => shiftDays(today, i));

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      {done && (
        <p role="status" className="rounded-xl border border-k-success bg-k-success-bg px-4 py-3 text-[14px] text-k-text">
          {done}
        </p>
      )}

      {/* Llegó con día y cobrador elegidos: se dice para quién es y se ofrece cambiarlo, sin repetir el paso 1. */}
      {!suRuta && withContext.current && !reopened.current && step !== 'date' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-k-border bg-white px-4 py-3">
          <p className="text-[14px] font-medium text-k-navy">
            {t('context.planningFor', { name: actual ? memberName(actual) : '', date: dayDate(day, locale) })}
          </p>
          <button
            type="button"
            onClick={() => {
              reopened.current = true;
              setStep('date');
            }}
            className="h-9 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            {t('context.change')}
          </button>
        </div>
      )}

      {/* Los cuatro pasos: dónde está la persona y cuánto falta. El número va igual al lado del nombre. */}
      {!suRuta && (
        <ol aria-label={t('steps.label')} className="flex flex-wrap items-center gap-2">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={s === step ? 'step' : undefined} className="flex items-center gap-2">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold ${
                  s === step ? 'bg-k-navy text-white' : i < stepIndex ? 'bg-k-success-bg text-k-success' : 'bg-k-bg text-k-text-2'
                }`}
              >
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span className={`text-[14px] ${s === step ? 'font-semibold text-k-navy' : 'text-k-text-2'}`}>{t(`steps.${s}`)}</span>
              {i < STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-k-border" />}
            </li>
          ))}
        </ol>
      )}

      {/* Ya tiene ruta: no se le arma otra (la base tampoco deja). Se ofrece ir a verla o seguir. */}
      {suRuta ? (
        <>
          <Card>
            {renderDateAndCollectors()}
          </Card>
          <Card>
            <h2 className="text-[16px] font-semibold text-k-navy">{t('alreadyPlanned', { name: actual ? memberName(actual) : '', n: suRuta.totalCases })}</h2>
            <p className="mt-1 text-[14px] text-k-text-2">{t('alreadyPlannedHint')}</p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {/* 🔴 El camino a esa ruta, acá mismo: hacerle buscar el día y la persona de nuevo es
                  mandarlo a rehacer a mano lo que la pantalla ya sabe. */}
              <a href={`/rutas/${suRuta.id}`} className="inline-flex h-12 items-center rounded-xl bg-k-navy px-5 text-[15px] font-semibold text-white hover:bg-k-slate">
                {t('goToRoute')}
              </a>
              {siguiente && (
                <span className="sm:w-64">
                  <Button variant="ghost" onClick={() => go({ collectorId: siguiente.userId })}>
                    {t('next', { name: memberName(siguiente) })}
                  </Button>
                </span>
              )}
            </div>
          </Card>
        </>
      ) : (
        <>
          {step === 'date' && (
            <>
              <Card>{renderDateAndCollectors()}</Card>
              <Card>
                <h2 className="text-[16px] font-semibold text-k-navy">{t('visits.title', { n: visits.length })}</h2>
                {visits.length === 0 ? (
                  <p className="mt-2 text-[14px] text-k-text-2">{t('visits.none')}</p>
                ) : (
                  <>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-[14px]">
                        <thead>
                          <tr className="border-b border-k-border text-[12px] font-medium text-k-text-2">
                            {(['time', 'client', 'credit', 'priority'] as const).map((c) => (
                              <th key={c} scope="col" className="px-3 py-2 font-medium">
                                {t(`visits.cols.${c}`)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-k-border">
                          {[...visits]
                            .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
                            .map((v) => (
                              <tr key={v.id}>
                                <td className="px-3 py-2 tabular-nums text-k-navy">{v.time ?? '—'}</td>
                                <td className="px-3 py-2 text-k-text">{v.clientName ?? '—'}</td>
                                <td className="px-3 py-2 text-k-text-2">{v.creditCode ?? '—'}</td>
                                <td className="px-3 py-2 text-k-text-2">{v.priority ?? '—'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 flex items-center gap-2 rounded-lg bg-k-info-bg px-3 py-2 text-[13px] text-k-slate">
                      <span aria-hidden>ⓘ</span>
                      {t('visits.auto')}
                    </p>
                  </>
                )}
              </Card>
            </>
          )}

          {step === 'clients' && (
            <div className="flex flex-col gap-5 lg:flex-row">
              {panelOpen && (
                <FilterPanel
                  defs={filters}
                  params={params}
                  go={go}
                  onClose={() => setPanelOpen(false)}
                  onClear={() => go(Object.fromEntries(PLAN_FILTER_KEYS.map((k) => [k, null])))}
                />
              )}

              <div className="min-w-0 flex-1 space-y-4">
                {/* Los dos, la misma altura: comparten fila, y con el botón más bajo que la caja la
                    línea se ve desprolija justo en lo primero que se toca. */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPanelOpen((v) => !v)}
                    aria-expanded={panelOpen}
                    className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-4 text-[14px] font-medium ${
                      filtered ? 'border-k-periwinkle bg-k-highlight text-k-periwinkle' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
                    }`}
                  >
                    <span aria-hidden>⚟</span>
                    {tTable('appliedFilters')}
                  </button>
                  <span className="min-w-[220px] flex-1">
                    <SearchBox wide flush label={t('filters.search')} placeholder={t('filters.search')} />
                  </span>
                </div>

                <Card>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-[16px] font-semibold text-k-navy">{t('assigning', { name: actual ? memberName(actual) : '' })}</h2>
                      {/* Cuántos hay de verdad, y cuántos se pueden mirar: la lista tiene techo y se dice. */}
                      <p className="mt-0.5 text-[13px] text-k-text-2">
                        {total > AVAILABLE_LIMIT ? t('foundCapped', { n: total, shown: available.length }) : t('found', { n: total })}
                      </p>
                    </div>
                    <p className="text-[14px] font-medium tabular-nums text-k-text">{t('picked', { n: picked.length, min: minStops })}</p>
                  </div>

                  <AvailableList
                    rows={filas}
                    picked={picked}
                    onToggle={toggle}
                    collectorId={collectorId}
                    emptyTitle={filtered ? t('noResults') : t('noAvailable')}
                    emptyText={filtered ? t('noResultsText') : t('noAvailableText')}
                    remoteSort={params.get('sort')}
                    remoteDir={params.get('dir') === 'asc' ? 'asc' : 'desc'}
                    onSortRemote={(key) => go({ sort: key, dir: params.get('sort') === key && params.get('dir') === 'desc' ? 'asc' : 'desc' })}
                  />
                </Card>
              </div>

              {/* A cuál de las ubicaciones de cada elegido se va. Lo que no tiene punto se marca y se resuelve acá. */}
              <aside aria-label={t('chosen.title', { n: picked.length })} className="w-full shrink-0 lg:w-80">
                <div className="rounded-2xl border border-k-border bg-white p-4 shadow-k-card lg:sticky lg:top-4">
                  <h2 className="text-[15px] font-semibold text-k-navy">{t('chosen.title', { n: picked.length })}</h2>
                  {picked.length === 0 ? (
                    <p className="mt-2 text-[13px] text-k-text-2">{t('chosen.empty')}</p>
                  ) : (
                    <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
                      {picked.map((id) => {
                        const c = byId.get(id);
                        const p = placeOf(id);
                        const ok = p.latitude != null && p.longitude != null;
                        return (
                          <li key={id} className={`rounded-xl border px-3 py-2.5 ${ok ? 'border-k-border' : 'border-k-warning bg-k-warning-bg'}`}>
                            <p className="truncate text-[14px] font-medium text-k-text">{c?.clientName ?? '—'}</p>
                            <p className={`mt-0.5 text-[12px] ${ok ? 'text-k-text-2' : 'text-k-warning-text'}`}>{ok ? p.label || t('chosen.noLabel') : t('chosen.noPoint')}</p>
                            <button type="button" onClick={() => setDialogFor(id)} className="mt-1.5 text-[12px] font-medium text-k-periwinkle hover:underline">
                              {ok ? t('chosen.change') : t('chosen.add')}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </aside>
            </div>
          )}

          {step === 'order' && (
            <>
              <MapPanel
                points={puntos}
                order={orden}
                area={area}
                onArea={setArea}
                onPointClick={pickPin}
                onMove={move}
                onReorder={reorder}
                onRemove={toggle}
                initialOrderOpen
                height={420}
                counter={area ? t('mapInArea', { n: puntos.length, km: area.radiusKm }) : t('mapPoints', { n: puntos.length, total: picked.length })}
              />
              <p className="rounded-xl border border-k-border bg-k-bg px-4 py-2.5 text-[13px] text-k-text-2">{t('orderHint')}</p>
            </>
          )}

          {step === 'preview' && (
            <PlanPreview stops={previewStops} start={start} onStart={setStart} onApplyOrder={(ids) => setPicked(ids)} extraVisits={extraVisits} />
          )}

          {/* La barra de abajo: atrás, adelante, y recién en el último paso, publicar. */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = STEPS[stepIndex - 1]!;
                      // Volver al paso 1 es reabrirlo: sin esto, cambiar de cobrador ahí lo devolvía a clientes al instante.
                      if (target === 'date') reopened.current = true;
                      setStep(target);
                    }}
                    className="h-11 rounded-xl border border-k-border bg-white px-5 text-[14px] font-medium text-k-text-2 hover:bg-k-bg"
                  >
                    {step === 'preview' ? t('backToEdit') : t('back')}
                  </button>
                )}
                {/* Avisa, no bloquea: el mínimo es una expectativa del negocio, no una regla del sistema. */}
                {corto && step !== 'date' && <span className="text-[13px] text-k-warning-text">{t('belowMin', { min: minStops })}</span>}
                {missing.length > 0 && (step === 'clients' || step === 'order') && (
                  <span role="alert" className="text-[13px] text-k-danger">
                    {t('missingPoints', { n: missing.length })}
                  </span>
                )}
              </div>
              <div>
                {step !== 'preview' ? (
                  <span className="block sm:w-56">
                    <Button
                      onClick={() => setStep(STEPS[stepIndex + 1]!)}
                      disabled={step !== 'date' && (picked.length === 0 || missing.length > 0)}
                    >
                      {t('nextStep')}
                    </Button>
                  </span>
                ) : (
                  <span className="block sm:w-72">
                    <Button onClick={() => void confirmar()} loading={busy} disabled={picked.length === 0 || missing.length > 0}>
                      {t('publish', { n: picked.length })}
                    </Button>
                  </span>
                )}
              </div>
            </div>
          </Card>
        </>
      )}

      {dialogCredit && (
        <PlanLocationDialog
          open
          onClose={() => setDialogFor(null)}
          clientId={dialogCredit.clientId}
          clientName={dialogCredit.clientName}
          chosenId={chosen[dialogCredit.id]?.id ?? placeOf(dialogCredit.id).id}
          onChoose={(loc) => setChosen((prev) => ({ ...prev, [dialogCredit.id]: loc }))}
        />
      )}
    </div>
  );

  /**
   * Fecha, mínimo de paradas y cobradores: el primer paso. Es una función que DEVUELVE JSX y no un componente: comparte todo
   * el estado de la pantalla, y un componente definido acá adentro se volvería a montar en cada render.
   */
  function renderDateAndCollectors() {
    return (
      <>
        {/*
         * Los dos campos en una fila, **con la misma medida**: son las dos decisiones de arriba —qué día y hasta dónde— y con
         * anchos distintos se leen como si uno importara más. El rótulo tiene alto propio para que los dos campos empiecen a
         * la misma altura, tenga o no el `?`.
         */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-52">
            <label htmlFor="planDate" className="mb-2 flex h-5 items-center text-[14px] font-medium text-k-text">
              {t('date')}
            </label>
            <input
              id="planDate"
              type="date"
              value={day}
              min={today}
              onChange={(e) => e.target.value && go({ date: e.target.value })}
              className={`${INPUT} w-full`}
            />
          </div>

          <div className="w-full sm:w-52">
            <span className="mb-2 flex h-5 items-center gap-1.5 text-[14px] font-medium text-k-text">
              <label htmlFor="minStops">{t('minStops')}</label>
              <InfoTip label={t('minStops')}>{t('minStopsHint')}</InfoTip>
            </span>
            <input id="minStops" type="number" min={1} max={50} value={minStops} onChange={(e) => go({ minStops: e.target.value })} className={`${INPUT} w-full`} />
          </div>
        </div>

        {/* Varios días: la próxima semana a un toque. Cada día es una ruta aparte por cobrador. */}
        <ul aria-label={t('dayChips.label')} className="mt-4 flex flex-wrap gap-2">
          {daysAhead.map((d, i) => (
            <li key={d}>
              <button
                type="button"
                onClick={() => go({ date: d })}
                aria-pressed={d === day}
                className={`h-9 rounded-lg border px-3 text-[13px] ${d === day ? 'border-k-navy bg-k-navy text-white' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'}`}
              >
                {i === 0 ? t('dayChips.today') : i === 1 ? t('dayChips.tomorrow') : d.slice(8, 10) + '/' + d.slice(5, 7)}
              </button>
            </li>
          ))}
        </ul>

        <ul className="mt-5 flex flex-wrap gap-2">
          {collectors.map((c) => {
            const ruta = byCollector.get(c.userId);
            const yo = c.userId === collectorId;
            return (
              <li key={c.userId}>
                <button
                  type="button"
                  onClick={() => go({ collectorId: c.userId })}
                  aria-current={yo ? 'true' : undefined}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${
                    yo ? 'border-k-navy bg-k-navy text-white' : 'border-k-border bg-white text-k-text hover:bg-k-bg'
                  }`}
                >
                  {/* 🔴 El estado se dice, no se pinta: quien no distingue colores tiene que poder
                      saber a quién le falta ruta. El tilde y el número lo dicen solos. */}
                  <span aria-hidden>{ruta ? '✓' : yo ? '●' : '○'}</span>
                  {memberName(c)}
                  {ruta && <span className={yo ? 'text-white/80' : 'text-k-text-2'}>{t('stopsShort', { n: ruta.totalCases })}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  }
}

const INPUT =
  'h-11 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
