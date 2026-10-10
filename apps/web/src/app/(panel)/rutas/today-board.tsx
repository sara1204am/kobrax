import { getTranslations } from 'next-intl/server';
import { memberName, type Member, type RouteItem } from '@kobrax/shared';
import { filterTodayRows, hasRouteFilters, summarizeByCollector, todayRows, totalWork, type RouteParams } from '@/lib/routes';
import { TodayTable } from './today-table';

/**
 * «Hoy»: **¿qué pasa hoy con las rutas?** (F4/12).
 *
 * Un renglón por cobrador, con lo que se viene a mirar: en qué estado está su ruta, cuánto lleva hecho, cuánto cobró y
 * qué parada sigue — y **una sola acción** según el caso: «Iniciar» si es suya y está planificada, «Ver» si ya existe,
 * «Planificar» si todavía no tiene (la pregunta del día es tanto «¿cómo va cada una?» como «¿a quién le falta?»).
 *
 * Arriba, los mismos cuatro totales de siempre, calculados con la cuenta que ya usa el período: dos pantallas que
 * suman las mismas rutas no pueden decir cosas distintas.
 *
 * Es del servidor: filtra y ordena el día entero según la URL (`filterTodayRows`) y le pasa las filas a `TodayTable`, que
 * es el `DataTable` del panel. Los totales de arriba **no se filtran**: son los del día, no los de la vista.
 */
export async function TodayBoard({
  day,
  routes,
  collectors,
  members,
  userId,
  canPlan,
  params = {},
}: {
  day: string;
  routes: RouteItem[];
  /** Los cobradores que se muestran aunque no tengan ruta. Vacío para quien solo ve la suya. */
  collectors: Member[];
  /** Todo el equipo visible, para poner nombre a cada ruta (también la de quien ya no está activo). */
  members: Member[];
  userId?: string;
  canPlan: boolean;
  /** La URL de la pantalla: de ahí salen el filtro por cobrador, el de estado y el orden. */
  params?: RouteParams;
}) {
  const t = await getTranslations('panel.routes');
  const names = new Map([...members, ...collectors].map((m) => [m.userId, memberName(m)]));
  const nameOf = (id: string) => names.get(id) ?? t('unknownCollector');
  const allRows = todayRows(routes, collectors, nameOf);
  const shown = filterTodayRows(allRows, params, nameOf);
  const collectorOptions = allRows
    .map((r) => ({ value: r.collectorId, label: nameOf(r.collectorId) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const total = totalWork(summarizeByCollector(routes));

  const stats = [
    { key: 'collectors', value: total.collectors },
    { key: 'stops', value: total.stops, strong: true },
    { key: 'done', value: total.done },
    { key: 'pending', value: total.pending },
  ];

  return (
    <>
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.key} className="rounded-xl border border-k-border bg-white px-4 py-3.5 shadow-k-card">
            <dd className={`text-[26px] font-semibold tabular-nums leading-tight ${s.strong ? 'text-k-navy' : 'text-k-text'}`}>{s.value}</dd>
            <dt className="mt-0.5 text-[12px] text-k-text-2">{t(`todayBoard.stats.${s.key}`)}</dt>
          </div>
        ))}
      </dl>

      <TodayTable
        rows={shown}
        names={Object.fromEntries(allRows.map((r) => [r.collectorId, nameOf(r.collectorId)]))}
        day={day}
        userId={userId}
        canPlan={canPlan}
        filtered={hasRouteFilters(params)}
        // Quien ve solo lo suyo no tiene a quién filtrar.
        collectorOptions={canPlan ? collectorOptions : []}
      />
    </>
  );
}
