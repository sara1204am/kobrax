'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type CaseListItem, type Member, type RouteItem } from '@kobrax/shared';
import { Card, InfoTip } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { FilterPanel } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { AvailableList } from '@/components/route-planner/available-list';
import { MapPanel, type PlanArea } from '@/components/route-planner/map-panel';
import { postJson } from '@/lib/client';
import { money } from '@/lib/format';
import { AVAILABLE_LIMIT, withinRadius } from '@/lib/plan';
import type { PlanRow } from '@/app/api/routes/plan/route';
import { planFilterDefs, PLAN_FILTER_KEYS } from './plan-filters';

/**
 * Armarle la ruta a **un cobrador**: se elige a quién, se filtra la mora que se puede asignar, se
 * marca lo que va, se ordena y se confirma. Después, el siguiente.
 *
 * 🔴 **La selección no viaja en la URL** (los filtros sí). Marcar clientes es un borrador de trabajo,
 * no una vista que alguien quiera compartir por link; y meterla en la URL haría que cada tilde
 * navegara y recargara la lista entera.
 *
 * 🔴 **Cambiar de cobrador o de filtro borra lo marcado**, por el mismo motivo que en la tabla del
 * panel: si sobreviviera, el contador diría «6 elegidas» sin seis filas a la vista, y se confirmaría
 * una ruta con gente que la persona no está mirando.
 *
 * El mapa, el panel de orden y la lista son **los mismos componentes que usa la edición de una ruta
 * ya creada**: es el mismo trabajo, y con dos copias una se queda vieja.
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
}: {
  day: string;
  today: string;
  collectors: Member[];
  collectorId: string;
  available: CaseListItem[];
  /** Cuántos hay en total con esos filtros; la lista trae hasta `AVAILABLE_LIMIT`. */
  total: number;
  routes: RouteItem[];
  minStops: number;
  filtered: boolean;
}) {
  const t = useTranslations('panel.routes.planning');
  const tFilters = useTranslations('panel.routes.planning.filters');
  const tCases = useTranslations('panel.cases');
  const tRoutes = useTranslations('panel.routes');
  const tTable = useTranslations('panel.table');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const filters = planFilterDefs(tFilters, tCases, tRoutes);
  // El panel abre solo si ya hay un filtro puesto: si no, uno activo quedaría escondido y la lista
  // saldría corta sin que nada lo explique. Mismo criterio que el `DataTable`.
  const [panelOpen, setPanelOpen] = useState(filtered);
  const [picked, setPicked] = useState<string[]>([]);
  const [area, setArea] = useState<PlanArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /** Quién ya tiene su ruta armada ese día, y con cuántas paradas. */
  const byCollector = new Map(routes.map((r) => [r.collectorId, r]));
  const actual = collectors.find((c) => c.userId === collectorId);
  const suRuta = byCollector.get(collectorId);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setPicked([]);
    setDone(null);
    setError(null);
    router.push(`${pathname}?${next}`);
  }

  /**
   * Marcar o desmarcar. **Un solo camino**, lo toque la casilla de la lista o su punto en el mapa:
   * con dos, un día uno de los dos se olvida de algo y la lista y el mapa dejan de coincidir.
   */
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /**
   * Mover una parada. 🔴 **El orden de `picked` ES el orden de la ruta**: viaja así a la API, que lo
   * respeta en vez de reordenar por prioridad. Mover acá es mover la jornada del cobrador.
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

  async function confirmar() {
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson<{ rows: PlanRow[] }>('/api/routes/plan', {
      plannedDate: day,
      assignments: [{ collectorId, caseIds: picked }],
    });
    setBusy(false);
    if (!ok) return setError(data.error?.message ?? t('error'));

    const row = data.rows[0];
    if (row?.error) return setError(row.error);
    setDone(t('routeDone', { name: actual ? memberName(actual) : '', n: picked.length }));
    setPicked([]);
    // La ruta recién creada tiene que aparecer en el progreso y su mora salir de la lista.
    router.refresh();
  }

  const pendientes = collectors.filter((c) => !byCollector.has(c.userId));
  const siguiente = pendientes.find((c) => c.userId !== collectorId);
  const corto = picked.length > 0 && picked.length < minStops;

  /** Las filas: primero el área —si está puesta—, y el orden lo resuelve la lista. */
  const filas = useMemo(
    () => (area ? withinRadius(available, area, area.radiusKm) : available),
    [available, area],
  );

  /*
   * Los pines. **Con área puesta**, los que se pueden elegir ahí adentro: es lo que se está
   * buscando. **Sin área**, sólo lo marcado — que es la ruta que se arma.
   */
  const puntos = useMemo(
    () =>
      (area ? filas : available.filter((c) => picked.includes(c.id))).flatMap((c) => {
        const loc = c.locations?.[0];
        const orden = picked.indexOf(c.id);
        return loc
          ? [{
              id: c.id,
              latitude: loc.latitude,
              longitude: loc.longitude,
              label: c.clientName ?? undefined,
              detail: [money(c.amount, c.currency ?? 'BOB'), c.daysPastDue ? t('days', { n: c.daysPastDue }) : null, c.zone ?? null]
                .filter(Boolean)
                .join(' · '),
              picked: orden >= 0,
              order: orden >= 0 ? orden + 1 : undefined,
            }]
          : [];
      }),
    [area, filas, available, picked, t],
  );

  const orden = useMemo(
    () =>
      picked.map((id) => {
        const c = available.find((x) => x.id === id);
        return { id, name: c?.clientName ?? '—', hint: c?.zone ?? undefined };
      }),
    [picked, available],
  );

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      {done && (
        <p role="status" className="rounded-xl border border-k-success bg-k-success-bg px-4 py-3 text-[14px] text-k-text">
          {done}
        </p>
      )}

      {/* Fecha y progreso del equipo: qué día se está armando y a quién le falta. */}
      <Card>
        {/*
         * Los dos campos en una fila, **con la misma medida**: son las dos decisiones de arriba —qué
         * día y hasta dónde— y con anchos distintos se leen como si uno importara más. El rótulo
         * tiene alto propio para que los dos campos empiecen a la misma altura, tenga o no el `?`.
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
            <input
              id="minStops"
              type="number"
              min={1}
              max={50}
              value={minStops}
              onChange={(e) => go({ minStops: e.target.value })}
              className={`${INPUT} w-full`}
            />
          </div>
        </div>

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
                  {ruta && (
                    <span className={yo ? 'text-white/80' : 'text-k-text-2'}>{t('stopsShort', { n: ruta.totalCases })}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* El mapa está desde el principio, no recién al marcar: buscar por área es CÓMO se elige. */}
      {!suRuta && available.some((c) => c.locations?.[0]) && (
        <MapPanel
          points={puntos}
          order={orden}
          area={area}
          onArea={setArea}
          onPointClick={toggle}
          onMove={move}
          onRemove={toggle}
          counter={
            area
              ? t('mapInArea', { n: puntos.length, km: area.radiusKm })
              : picked.length > 0
                ? t('mapPoints', { n: puntos.length, total: picked.length })
                : t('mapEmpty')
          }
        />
      )}

      {/* Ya tiene ruta: no se le arma otra (la base tampoco deja). Se ofrece ir a verla o seguir. */}
      {suRuta ? (
        <Card>
          <h2 className="text-[16px] font-semibold text-k-navy">
            {t('alreadyPlanned', { name: actual ? memberName(actual) : '', n: suRuta.totalCases })}
          </h2>
          <p className="mt-1 text-[14px] text-k-text-2">{t('alreadyPlannedHint')}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* 🔴 El camino a esa ruta, acá mismo: hacerle buscar el día y la persona de nuevo es
                mandarlo a rehacer a mano lo que la pantalla ya sabe. */}
            <a
              href={`/rutas/${suRuta.id}`}
              className="inline-flex h-12 items-center rounded-xl bg-k-navy px-5 text-[15px] font-semibold text-white hover:bg-k-slate"
            >
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
      ) : (
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
                  filtered
                    ? 'border-k-periwinkle bg-k-highlight text-k-periwinkle'
                    : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
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
                  <h2 className="text-[16px] font-semibold text-k-navy">
                    {t('assigning', { name: actual ? memberName(actual) : '' })}
                  </h2>
                  {/* Cuántos hay de verdad, y cuántos se pueden mirar: la lista tiene techo y se dice. */}
                  <p className="mt-0.5 text-[13px] text-k-text-2">
                    {total > AVAILABLE_LIMIT
                      ? t('foundCapped', { n: total, shown: available.length })
                      : t('found', { n: total })}
                  </p>
                </div>
                <p className="text-[14px] font-medium tabular-nums text-k-text">
                  {t('picked', { n: picked.length, min: minStops })}
                </p>
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
                onSortRemote={(key) =>
                  go({ sort: key, dir: params.get('sort') === key && params.get('dir') === 'desc' ? 'asc' : 'desc' })
                }
              />

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="sm:w-64">
                  <Button onClick={() => void confirmar()} loading={busy} disabled={picked.length === 0}>
                    {t('confirmRoute', { n: picked.length })}
                  </Button>
                </span>
                {/* Avisa, no bloquea: el mínimo es una expectativa del negocio, no una regla del sistema. */}
                {corto && <span className="text-[13px] text-k-warning-text">{t('belowMin', { min: minStops })}</span>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

const INPUT =
  'h-11 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
