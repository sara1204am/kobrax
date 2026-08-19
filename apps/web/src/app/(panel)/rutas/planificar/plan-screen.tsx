'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type CaseListItem, type Member, type RouteItem } from '@kobrax/shared';
import { Badge, Card, EmptyState, InfoTip } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { postJson } from '@/lib/client';
import { money } from '@/lib/format';
import { AVAILABLE_LIMIT, RADIUS_KM, sortAvailable, withinRadius, type LocalSort } from '@/lib/plan';
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
  /**
   * Si se ve el panel del recorrido, al lado del mapa.
   *
   * Arranca cerrado a propósito: el mapa vale más ancho mientras se elige, y ordenar viene después.
   * El botón lleva el número de paradas, así que no hay que abrirlo para saber cuántas van.
   */
  const [showOrder, setShowOrder] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  /**
   * El orden de las columnas que **el servidor no sabe ordenar** (nombre, zona, ubicación).
   *
   * 🔴 Acá ordenar en el navegador es correcto, y en las tablas del panel no lo era: **esta lista no
   * pagina**. Lo que llegó es lo que se ve y lo que se puede elegir, así que acomodarlo no esconde
   * nada. El techo —cuántas trajo de cuántas hay— ya está escrito arriba de la lista.
   *
   * Saldo y mora **no** pasan por acá: ésas el servidor las sabe ordenar, y mandárselas ordena
   * sobre el total en vez de sobre las cien que vinieron.
   */
  const [localSort, setLocalSort] = useState<{ key: LocalSort; dir: 'asc' | 'desc' } | null>(null);
  /**
   * La búsqueda por área: un círculo sobre el mapa que deja en la lista sólo lo que cae adentro.
   *
   * 🔴 **Filtra en el navegador, sobre lo que ya está cargado.** Es lo que la vuelve instantánea:
   * arrastrar el círculo no pide nada al servidor. El precio está declarado arriba de la lista —son
   * las cien que vinieron, no toda la mora—, y por eso conviene acotar antes con los filtros y
   * después dibujar el área.
   */
  const [area, setArea] = useState<{ latitude: number; longitude: number; radiusKm: number } | null>(null);
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
   * Las filas: primero el área —si está puesta—, después el orden. Sin orden local, el que trajo el
   * servidor.
   *
   * Quien no tiene el dato va **al final en los dos sentidos**: un cliente sin zona no es «la zona
   * que va primero alfabéticamente», es uno del que no se sabe dónde está.
   */
  const filas = useMemo(() => {
    const base = area ? withinRadius(available, area, area.radiusKm) : available;
    return localSort ? sortAvailable(base, localSort.key, localSort.dir) : base;
  }, [available, area, localSort]);

  /*
   * Los pines. **Con área puesta**, los que se pueden elegir ahí adentro: es lo que se está
   * buscando. **Sin área**, sólo lo marcado — que es la ruta que se arma; cien pines de mora que no
   * se eligió taparían justamente eso.
   *
   * Un punto por deudor, el de su **primera ubicación**, que es la principal: dibujar también las de
   * sus garantes multiplicaría los pines. Quien no tiene ninguna cargada no aparece, y por eso el
   * rótulo dice cuántos de cuántos.
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
              // Lo que decide si vale la pena ir, en el globo: no hay que volver a la lista a buscarlo.
              detail: [
                money(c.amount, c.currency ?? 'BOB'),
                c.daysPastDue ? t('days', { n: c.daysPastDue }) : null,
                c.zone ?? null,
              ]
                .filter(Boolean)
                .join(' · '),
              picked: orden >= 0,
              // El número de parada: la posición en la que se eligió, que es la que va a viajar.
              order: orden >= 0 ? orden + 1 : undefined,
            }]
          : [];
      }),
    [area, filas, available, picked],
  );

  /**
   * Marcar o desmarcar un deudor. **Un solo camino**, lo toque la casilla de la lista o su punto en
   * el mapa: con dos, un día uno de los dos se olvida de algo y la lista y el mapa dejan de coincidir.
   */
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /**
   * Mover una parada en el recorrido.
   *
   * 🔴 **El orden de `picked` ES el orden de la ruta**: viaja así a la API, que desde ahora lo
   * respeta en vez de reordenar por prioridad. Por eso mover acá es mover la jornada del cobrador,
   * no acomodar una lista en pantalla.
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

  /** Toca una columna que el servidor sabe ordenar: el orden lo resuelve él, sobre TODA la mora. */
  function sortRemote(key: 'balance' | 'daysPastDue') {
    const dir = params.get('sort') === key && params.get('dir') === 'desc' ? 'asc' : 'desc';
    setLocalSort(null);
    go({ sort: key, dir });
  }

  /** Toca una que no: se acomoda lo que se está viendo, sin volver a pedir nada. */
  function sortLocal(key: LocalSort) {
    setLocalSort((prev) => ({ key, dir: prev?.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  }

  const remoteSort = params.get('sort');
  const remoteDir = params.get('dir') === 'asc' ? 'asc' : 'desc';

  /** «500 m» o «2 km»: media unidad no se dice en decimales cuando hay una unidad más chica. */
  const radioLabel = (km: number) => (km < 1 ? t('areaMeters', { m: km * 1000 }) : t('areaKm', { km }));

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
            {/* La aclaración va detrás del `?`, no debajo del campo: un renglón gris abajo desalinea
                la fila entera y ocupa lugar todos los días para explicar algo que se lee una vez. */}
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

      {/*
       * 🔴 **El mapa entre las personas y la lista, y chico.** Dónde queda lo que se está armando es
       * una pregunta que se hace mientras se elige, así que va en el camino y no al final. Chico
       * porque lo que se opera es la lista; se agranda cuando de verdad hay que mirar el mapa.
       *
       * Aparece **al primer marcado**: sin ninguno no hay ruta que mirar, y un mapa vacío ocupa
       * lugar sin decir nada.
       */}
      {/*
       * 🔴 El bloque está desde el principio, **no recién cuando hay algo marcado**: buscar por área
       * es justamente cómo se elige, así que su botón no puede aparecer después de haber elegido.
       * Sólo desaparece si nadie de la lista tiene ubicación cargada — ahí no hay nada que dibujar.
       */}
      {!suRuta && available.some((c) => c.locations?.[0]) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-k-text-2">
              {/* Cuántos se pueden dibujar de los que corresponden: quien no tiene ubicación no
                  aparece, y eso no puede ser invisible — es media ruta que no se ve. */}
              {area
                ? t('mapInArea', { n: puntos.length, km: area.radiusKm })
                : picked.length > 0
                  ? t('mapPoints', { n: puntos.length, total: picked.length })
                  : t('mapEmpty')}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {/*
               * 🔴 **Buscar por área.** Se enciende con el botón y aparece un círculo arrastrable en
               * el centro del mapa; la lista se acota a lo que cae adentro. Filtra en el navegador
               * sobre lo ya cargado, así que mover el círculo es instantáneo — y por eso también
               * conviene acotar antes con los filtros: son las cien que vinieron, no toda la mora.
               */}
              <button
                type="button"
                onClick={() => {
                  if (area) return setArea(null);
                  const conPunto = available.find((c) => c.locations?.[0]);
                  const loc = conPunto?.locations?.[0];
                  if (loc) setArea({ latitude: loc.latitude, longitude: loc.longitude, radiusKm: 1 });
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
                    onChange={(e) => setArea({ ...area, radiusKm: Number(e.target.value) })}
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

              {/*
               * 🔴 **El recorrido se muestra y se esconde acá**, al lado de los otros dos: ordenar
               * es una tarea del mapa —se acomoda mirando dónde queda cada puerta—, así que su
               * interruptor tiene que estar donde está la vista, no al pie de la pantalla.
               */}
              {picked.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowOrder((v) => !v)}
                  aria-pressed={showOrder}
                  className={`h-8 rounded-lg border px-3 text-[13px] font-medium ${
                    showOrder
                      ? 'border-k-navy bg-k-navy text-white'
                      : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
                  }`}
                >
                  {showOrder ? t('hideOrder') : t('showOrder', { n: picked.length })}
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
            </div>
          </div>

          {/*
           * 🔴 **El recorrido a la izquierda y el mapa a la derecha, a la misma altura.** Ordenar
           * mirando sólo una lista de nombres es adivinar: lo que dice si el orden sirve es el mapa,
           * y hay que verlo **mientras** se mueve cada parada. Por eso conviven, y no se turnan.
           *
           * La lista no fija su alto: en una fila flex se estira hasta el del mapa sola, y así
           * agrandar el mapa la agranda con él sin una línea más.
           */}
          <div className="flex flex-col items-stretch gap-3 lg:flex-row">
            {showOrder && picked.length > 0 && (
              <div className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-k-border bg-white lg:w-80">
                <p className="border-b border-k-border bg-k-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
                  {t('routeOrder', { n: picked.length })}
                </p>
                {/* El scroll vive acá adentro: la columna ya tiene el alto del mapa. */}
                <ol className="max-h-64 min-h-0 flex-1 divide-y divide-k-border overflow-y-auto lg:max-h-none">
                  {picked.map((id, i) => {
                    const c = available.find((x) => x.id === id);
                    return (
                      <li key={id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-k-navy text-[11px] font-semibold text-white">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-k-text">{c?.clientName ?? '—'}</span>
                          <span className="block truncate text-[11px] text-k-muted">{c?.zone ?? ''}</span>
                        </span>
                        {/* Con flechas y no arrastrando: arrastrar no existe para quien navega con
                            teclado, y acá el orden es el dato, no un adorno. */}
                        <span className="flex shrink-0 items-center gap-1">
                          <OrderButton onClick={() => move(id, -1)} disabled={i === 0} label={t('moveUp')}>
                            ↑
                          </OrderButton>
                          <OrderButton onClick={() => move(id, 1)} disabled={i === picked.length - 1} label={t('moveDown')}>
                            ↓
                          </OrderButton>
                          <OrderButton onClick={() => toggle(id)} label={t('removeStop')}>
                            ✕
                          </OrderButton>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* El mapa se dibuja cuando hay algo que mostrar: los marcados, o el área con lo que caiga
                adentro. Vacío sería un recuadro de tiles sin una sola respuesta. */}
            <div className="min-w-0 flex-1">
              {puntos.length > 0 || area ? (
                <PointsMap
                  points={puntos}
                  height={bigMap ? 520 : 220}
                  // El radio escrito viaja al mapa: la etiqueta del borde y el select dicen lo mismo.
                  circle={area ? { ...area, label: radioLabel(area.radiusKm) } : undefined}
                  // Al soltar el círculo, no en cada frame: filtrar cien filas sesenta veces por
                  // segundo es lo único que puede volver esto lento.
                  onCircleMove={(centro) => setArea((prev) => (prev ? { ...prev, ...centro } : prev))}
                  // Tocar un punto es lo mismo que tildar su fila: una sola verdad, la del estado.
                  onPointClick={toggle}
                />
              ) : (
                picked.length > 0 && (
                  <p className="rounded-2xl border border-k-border bg-white px-4 py-3 text-[13px] text-k-text-2">
                    {t('mapNoPoints')}
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ya tiene ruta: no se le arma otra (la base tampoco deja). Se ofrece seguir con el siguiente. */}
      {suRuta ? (
        <Card>
          <h2 className="text-[16px] font-semibold text-k-navy">
            {t('alreadyPlanned', { name: actual ? memberName(actual) : '', n: suRuta.totalCases })}
          </h2>
          <p className="mt-1 text-[14px] text-k-text-2">{t('alreadyPlannedHint')}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* 🔴 El camino a esa ruta, acá mismo: decirle a alguien «entrá desde el historial» y
                hacerle buscar el día y la persona de nuevo es mandarlo a rehacer a mano lo que la
                pantalla ya sabe. */}
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
            {/* Los dos, **la misma altura**: comparten fila, y con el botón más bajo que la caja la
                línea se ve desprolija justo en lo primero que se toca. `flush` le saca a la caja el
                margen que trae para cuando va encima de una tabla. */}
            <div className="flex flex-wrap items-center gap-3">
              {/* El botón, del mismo lado que el panel que abre. */}
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
              <div className="overflow-hidden rounded-xl border border-k-border">
                {/* Con seis datos por fila, sin rótulos hay que adivinar cuál es cuál. Los anchos son
                    los mismos que abajo: si se cambia uno, se cambian los dos. */}
                <div className="flex items-center gap-x-4 border-b border-k-border bg-k-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
                  <span className="w-4" aria-hidden />
                  <Th className="min-w-[180px] flex-1" onClick={() => sortLocal('client')} active={localSort?.key === 'client'} dir={localSort?.dir}>
                    {t('cols.client')}
                  </Th>
                  {/* Saldo y mora las ordena el SERVIDOR: sobre toda la mora, no sobre las que vinieron. */}
                  <Th className="w-28 justify-end" onClick={() => sortRemote('balance')} active={!localSort && remoteSort === 'balance'} dir={remoteDir}>
                    {t('cols.balance')}
                  </Th>
                  <Th className="w-24 justify-end" onClick={() => sortRemote('daysPastDue')} active={!localSort && remoteSort === 'daysPastDue'} dir={remoteDir}>
                    {t('cols.dpd')}
                  </Th>
                  <Th className="w-28" onClick={() => sortLocal('zone')} active={localSort?.key === 'zone'} dir={localSort?.dir}>
                    {t('cols.zone')}
                  </Th>
                  <Th className="w-40" onClick={() => sortLocal('coords')} active={localSort?.key === 'coords'} dir={localSort?.dir}>
                    {t('cols.coords')}
                  </Th>
                </div>

                <ul className="max-h-[min(55rem,70vh)] divide-y divide-k-border overflow-y-auto">
                  {filas.map((c) => {
                    const marcado = picked.includes(c.id);
                    const ajeno = c.assigneeId != null && c.assigneeId !== collectorId;
                    // La primera es la principal: la misma que va al mapa, para que la fila y el pin
                    // hablen del mismo lugar.
                    const loc = c.locations?.[0];
                    return (
                      <li key={c.id}>
                        <label className={`flex cursor-pointer items-center gap-x-4 px-4 py-3 hover:bg-k-bg ${marcado ? 'bg-k-highlight' : ''}`}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-k-purple"
                            checked={marcado}
                            onChange={() => toggle(c.id)}
                          />
                          <span className="min-w-[180px] flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-medium text-k-text">{c.clientName ?? '—'}</span>
                              {/*
                               * 🔴 Se dice cuándo la parada es AYUDA a otro. Sin esto, una ruta llena
                               * de clientes ajenos se lee como si le hubieran sacado la cartera a
                               * alguien — y no: el dueño del caso no cambia, sólo esta jornada la
                               * cubre otro.
                               */}
                              {ajeno && <Badge tone="warning">{t('help')}</Badge>}
                            </span>
                            {/* La dirección, debajo del nombre: es lo que se lee para saber si vale
                                la pena ir, y en una columna propia se cortaría en tres palabras. */}
                            <span className="block truncate text-[12px] text-k-muted">{loc?.address ?? t('noAddress')}</span>
                          </span>
                          <span className="w-28 shrink-0 text-right text-[14px] tabular-nums text-k-text">
                            {money(c.amount, c.currency ?? 'BOB')}
                          </span>
                          <span className="w-24 shrink-0 text-right text-[13px] tabular-nums text-k-danger">
                            {c.daysPastDue ? t('days', { n: c.daysPastDue }) : '—'}
                          </span>
                          <span className="w-28 shrink-0 truncate text-[13px] text-k-text-2">{c.zone ?? '—'}</span>
                          {/* Las coordenadas, tal cual: son las que se copian a un GPS o se comparten
                              por mensaje, así que van completas y no redondeadas a la vista. */}
                          <span className="w-40 shrink-0 text-[12px] tabular-nums text-k-muted">
                            {loc ? `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : t('noCoords')}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* El recorrido y su orden viven arriba, junto al mapa: se acomodan mirando dónde queda
                cada puerta, no leyendo una lista de nombres al pie de la pantalla. */}
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

/**
 * Un rótulo de columna que ordena.
 *
 * La flecha se dibuja **sólo en la columna activa**: una en cada encabezado no dice cuál manda. Y
 * `aria-sort` lo anuncia, que es lo único que tiene un lector de pantalla para saberlo.
 */
function Th({
  children,
  className,
  onClick,
  active,
  dir,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
}) {
  return (
    <span className={className} role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase hover:text-k-text ${className?.includes('justify-end') ? 'w-full justify-end' : ''}`}
      >
        {children}
        <span aria-hidden className={active ? 'text-k-periwinkle' : 'text-k-muted'}>
          {active && dir === 'desc' ? '↓' : '↑'}
        </span>
      </button>
    </span>
  );
}

const INPUT =
  'h-11 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
