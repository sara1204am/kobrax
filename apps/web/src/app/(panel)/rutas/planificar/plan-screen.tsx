'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type CaseListItem, type Member, type RouteItem } from '@kobrax/shared';
import { Badge, Card, EmptyState, InfoTip } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { postJson } from '@/lib/client';
import { money } from '@/lib/format';
import { AVAILABLE_LIMIT } from '@/lib/plan';
import { FilterPanel } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { PointsMap } from './points-map';
import type { PlanRow } from '@/app/api/routes/plan/route';
import { planFilterDefs, PLAN_FILTER_KEYS } from './plan-filters';

/**
 * Armarle la ruta a **un cobrador**: se elige a quién, se filtra la mora que se puede asignar, se
 * marca lo que va, y se confirma. Después, el siguiente.
 *
 * 🔴 **La selección no viaja en la URL** (los filtros sí). Marcar clientes es un borrador de trabajo,
 * no una vista que alguien quiera compartir por link; y meterla en la URL haría que cada tilde
 * navegara y recargara la lista entera.
 *
 * 🔴 **Cambiar de cobrador o de filtro borra lo marcado**, por el mismo motivo que en la tabla del
 * panel: si sobreviviera, el contador diría «6 asignadas» sin seis filas a la vista, y se
 * confirmaría una ruta con gente que la persona no está mirando.
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
  const [bigMap, setBigMap] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
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

  /*
   * En el mapa van **los marcados**, no toda la lista: lo que se quiere ver es la ruta que se está
   * armando —si queda junta o si manda a alguien de una punta a la otra—, y cien pines de mora que
   * no se eligió tapan justamente eso.
   *
   * Un punto por deudor, el de su **primera ubicación**, que es la principal: dibujar también las de
   * sus garantes multiplicaría los pines. Quien no tiene ninguna cargada no aparece, y por eso el
   * rótulo dice cuántos de cuántos.
   */
  const puntos = available.flatMap((c) => {
    if (!picked.includes(c.id)) return [];
    const loc = c.locations?.[0];
    return loc ? [{ id: c.id, latitude: loc.latitude, longitude: loc.longitude, label: c.clientName ?? undefined }] : [];
  });

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
        <div className="flex flex-wrap items-end gap-5">
          <label className="block space-y-2">
            <span className="text-[14px] font-medium text-k-text">{t('date')}</span>
            <input
              type="date"
              value={day}
              min={today}
              onChange={(e) => e.target.value && go({ date: e.target.value })}
              className={INPUT}
            />
          </label>

          <div className="space-y-2">
            {/* La aclaración va detrás del `?`, no debajo del campo: un renglón gris abajo desalinea
                la fila entera y ocupa lugar todos los días para explicar algo que se lee una vez. */}
            <span className="flex items-center gap-1.5 text-[14px] font-medium text-k-text">
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
              className={`${INPUT} w-24`}
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

      {/*
       * 🔴 **El mapa entre las personas y la lista, y chico.** Dónde queda lo que se está armando es
       * una pregunta que se hace mientras se elige, así que va en el camino y no al final. Chico
       * porque lo que se opera es la lista; se agranda cuando de verdad hay que mirar el mapa.
       *
       * Aparece **al primer marcado**: sin ninguno no hay ruta que mirar, y un mapa vacío ocupa
       * lugar sin decir nada.
       */}
      {!suRuta && picked.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            {/* Cuántos de los marcados se pueden dibujar: quien no tiene ubicación cargada no
                aparece, y eso no puede ser invisible — es media ruta que no se ve. */}
            <p className="text-[13px] text-k-text-2">{t('mapPoints', { n: puntos.length, total: picked.length })}</p>
            <button
              type="button"
              onClick={() => setBigMap((v) => !v)}
              aria-expanded={bigMap}
              className="h-8 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
            >
              {bigMap ? t('mapSmall') : t('mapBig')}
            </button>
          </div>
          {puntos.length > 0 ? (
            <PointsMap points={puntos} height={bigMap ? 520 : 220} />
          ) : (
            <p className="rounded-2xl border border-k-border bg-white px-4 py-3 text-[13px] text-k-text-2">
              {t('mapNoPoints')}
            </p>
          )}
        </div>
      )}

      {/* Ya tiene ruta: no se le arma otra (la base tampoco deja). Se ofrece seguir con el siguiente. */}
      {suRuta ? (
        <Card>
          <h2 className="text-[16px] font-semibold text-k-navy">
            {t('alreadyPlanned', { name: actual ? memberName(actual) : '', n: suRuta.totalCases })}
          </h2>
          <p className="mt-1 text-[14px] text-k-text-2">{t('alreadyPlannedHint')}</p>
          {siguiente && (
            <div className="mt-4 sm:w-72">
              <Button onClick={() => go({ collectorId: siguiente.userId })}>
                {t('next', { name: memberName(siguiente) })}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        /*
         * 🔴 **Los filtros van a la izquierda, en el mismo panel que el resto del panel.** Es el
         * `FilterPanel` de las tablas: un sexto lugar donde los filtros vivieran distinto obligaría
         * a aprender esta pantalla de nuevo.
         */
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
            <div className="flex flex-wrap items-center gap-3">
              {/* El botón, del mismo lado que el panel que abre. */}
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-expanded={panelOpen}
                className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium ${
                  filtered
                    ? 'border-k-periwinkle bg-k-highlight text-k-periwinkle'
                    : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
                }`}
              >
                <span aria-hidden>⚟</span>
                {tTable('appliedFilters')}
              </button>
              <SearchBox wide label={t('filters.search')} placeholder={t('filters.search')} />
            </div>

            <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold text-k-navy">
                  {t('assigning', { name: actual ? memberName(actual) : '' })}
                </h2>
                {/* Cuántos hay de verdad, y cuántos se pueden mirar: la lista tiene techo y se dice. */}
                <p className="mt-0.5 text-[13px] text-k-text-2">
                  {total > AVAILABLE_LIMIT ? t('foundCapped', { n: total, shown: available.length }) : t('found', { n: total })}
                </p>
              </div>
              <p className="text-[14px] font-medium tabular-nums text-k-text">
                {t('picked', { n: picked.length, min: minStops })}
              </p>
            </div>

            {available.length === 0 ? (
              <EmptyState
                title={filtered ? t('noResults') : t('noAvailable')}
                text={filtered ? t('noResultsText') : t('noAvailableText')}
              />
            ) : (
              /*
               * 🔴 **Veinte filas y de ahí, scroll adentro de la lista.** Con cien deudores la
               * página se hacía interminable y el botón de armar la ruta quedaba abajo de todo: se
               * marcaba a ciegas y había que bajar hasta el final para confirmar. Con el alto
               * acotado, el contador y el botón quedan siempre a la vista.
               *
               * El tope también mira la ventana (`70vh`): en una laptop chica, 20 filas fijas serían
               * más alto que la pantalla y el scroll de adentro no serviría de nada.
               */
              <ul className="max-h-[min(55rem,70vh)] divide-y divide-k-border overflow-y-auto rounded-xl border border-k-border">
                {available.map((c) => {
                  const marcado = picked.includes(c.id);
                  const ajeno = c.assigneeId != null && c.assigneeId !== collectorId;
                  return (
                    <li key={c.id}>
                      <label className={`flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-k-bg ${marcado ? 'bg-k-highlight' : ''}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-k-purple"
                          checked={marcado}
                          onChange={(e) =>
                            setPicked((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)))
                          }
                        />
                        <span className="min-w-[180px] flex-1 text-[14px] font-medium text-k-text">
                          {c.clientName ?? '—'}
                        </span>
                        <span className="w-28 text-right text-[14px] tabular-nums text-k-text">
                          {money(c.amount, c.currency ?? 'BOB')}
                        </span>
                        <span className="w-24 text-right text-[13px] tabular-nums text-k-danger">
                          {c.daysPastDue ? t('days', { n: c.daysPastDue }) : '—'}
                        </span>
                        <span className="w-28 truncate text-[13px] text-k-text-2">{c.zone ?? '—'}</span>
                        {/*
                         * 🔴 Se dice cuándo la parada es AYUDA a otro. Sin esto, una ruta llena de
                         * clientes ajenos se lee como si le hubieran sacado la cartera a alguien —
                         * y no: el dueño del caso no cambia, sólo esta jornada la cubre otro.
                         */}
                        {ajeno && <Badge tone="warning">{t('help')}</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

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
