import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  summarizeDay,
  type CaseListItem,
  type DayPayment,
  type Member,
  type RouteItem,
  type VisitItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { CATEGORY_TONE, ROUTE_STATUS_TONE } from '@/lib/routes';
import { availableQuery, hasPlanFilters, shiftDays, type PlanParams } from '@/lib/plan';
import { Badge, Card, EmptyState, PageHeader } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';
import { RouteEditor } from './route-editor';

/** Techo de lo que se trae de un día —pagos y visitas—. Un día de un tenant no llega a tanto. */
const DAY_LIMIT = 100;

/**
 * El detalle de una ruta: sus paradas en orden y cómo terminó el día.
 *
 * ⚠️ Esta llamada **revela las direcciones en claro y la API lo audita**. Es lo que hace útil la
 * pantalla —una lista de paradas sin dirección no dice adónde fue nadie— y por eso se pide acá y
 * no para pintar el listado.
 *
 * La cuenta la hace `summarizeDay` de `shared`, la MISMA que corre el teléfono: es la única cuenta
 * del día, y existe porque dos pantallas del mismo día decían cosas distintas.
 */
export default async function RutaPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: PlanParams & { editar?: string };
}) {
  const t = await getTranslations('panel.routes');
  const locale = await getLocale();

  const detail = await apiCall<RouteItem>(`/routes/${params.id}`, { method: 'GET', auth: true });
  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('title')} text={detail.body.error?.message} />;
  }
  const route = detail.body.data;
  const day = route.plannedDate.slice(0, 10);

  /*
   * Los pagos se piden **por caso**, uno por parada, y no con una ventana del día.
   *
   * Dos motivos, los dos aprendidos a los golpes: `from`/`to` con la misma fecha arman una ventana
   * de ancho CERO —`paymentDate` es un timestamp, así que sólo entraría un pago hecho a medianoche
   * exacta— y el «recaudado» daba siempre 0. Y pidiendo el día entero del tenant, una sola página
   * de 100 puede dejar afuera pagos de esta ruta y mostrar MENOS plata de la que entró, sin avisar.
   *
   * Por caso es exacto y acotado: son tantas llamadas como paradas con caso, y una parada no junta
   * cien pagos en un día. Sin `payment:read` vuelven vacías y se muestra cero cobrado, que es lo
   * que ese rol puede saber.
   *
   * 🔴 **Pero acotado AL DÍA de la ruta.** Sin `from`/`to`, «Recaudado» sumaba todos los pagos que
   * ese caso tuvo alguna vez: una ruta planificada para mañana, con cero paradas gestionadas, decía
   * que había recaudado mil cuatrocientos bolivianos. `summarizeDay` filtra por caso, no por fecha —
   * da por hecho que los pagos que recibe son los del día.
   *
   * ponytail: la ventana es en UTC y el día del tenant es el de Bolivia (UTC−4). Un pago después de
   * las 20:00 cae en el día siguiente de esta cuenta. Se arregla el día que `TenantClockService`
   * —que ya existe y usa la agenda— llegue a pagos; hasta entonces el error es de horas, no de meses.
   */
  const caseIds = [...new Set((route.stops ?? []).map((s) => s.caseId).filter((id): id is string => !!id))];

  /*
   * 🔴 La mora que se puede sumar **sólo se pide al editar**: son cien casos con sus ubicaciones, y
   * quien entra a mirar cómo terminó la jornada no los necesita. Es la misma consulta que arma la
   * ruta la primera vez —incluido `excludeRouted`, que deja fuera lo que ya es parada de ese día—,
   * acotada a la cartera del cobrador de ESTA ruta salvo que se pida ayuda de todo el equipo.
   */
  const editing = searchParams.editar === '1';
  const planParams: PlanParams = { ...searchParams, collectorId: route.collectorId };

  const [team, paymentsByCase, preview, visits, available] = await Promise.all([
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    Promise.all(
      caseIds.map((caseId) =>
        apiCall<DayPayment[]>(`/payments?caseId=${caseId}&from=${day}&to=${shiftDays(day, 1)}&limit=${DAY_LIMIT}`, {
          method: 'GET',
          auth: true,
        }),
      ),
    ),
    /*
     * El recorrido por las calles. Sale de un motor de ruteo que corre en su propio contenedor, así
     * que **puede no estar**: si falla, las paradas se siguen listando y el mapa une los puntos con
     * rectas punteadas. El mapa es un extra, no el contenido.
     *
     * ponytail: se pide en cada visita a la ficha, y del otro lado ese GET **escribe** la distancia
     * en la ruta y registra un segundo revelado de PII. Se acepta porque el recorrido por calles es
     * lo que justifica el mapa; el arreglo de fondo es que `preview` no escriba ni audite —es una
     * lectura— y eso es de la API, no del panel.
     */
    apiCall<{ geometry: { latitude: number; longitude: number }[] }>(`/routes/${params.id}/preview`, {
      method: 'GET',
      auth: true,
    }),
    // Las visitas de esta ruta: el punto donde se registró cada una (W6-T0).
    apiCall<VisitItem[]>(`/visits?routeId=${params.id}&limit=${DAY_LIMIT}`, { method: 'GET', auth: true }),
    editing
      ? apiCall<CaseListItem[]>(`/cases?${availableQuery(planParams, day)}`, { method: 'GET', auth: true })
      : null,
  ]);

  const members = team.body.data ?? [];
  const collector = members.find((m) => m.userId === route.collectorId);
  const summary = summarizeDay(route, paymentsByCase.flatMap((r) => r.body.data ?? []));
  const stops = route.stops ?? [];

  return (
    <>
      <PageHeader
        title={collector ? memberName(collector) : t('unknownCollector')}
        // El día de la ruta no tiene hora: formateado en la zona local se corría un día para atrás.
        subtitle={dayDate(route.plannedDate, locale)}
        // El estado va al lado del nombre: dice QUÉ ES esta ruta, no es una acción. A la derecha
        // quedaba a media pantalla de aquello que califica.
        badge={<Badge tone={ROUTE_STATUS_TONE[route.status]} dot>{t(`status.${route.status}`)}</Badge>}
      />

      <div className="space-y-6">
        <Card>
          {/*
           * 🔴 **Tres números y una barra, no cuatro rótulos iguales.** Antes el avance era un «0%»
           * suelto al lado de «0 de 4», con el mismo peso que el resto: había que leer los cuatro
           * para saber cómo venía el día. Lo que se viene a mirar es cuánto entró y cuánto falta.
           */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[15px] font-semibold text-k-navy">{t('detail.summary')}</p>

            {/* Sólo las categorías con al menos una parada: un cero no cuenta nada y ocupa lugar. */}
            {summary.categories.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {summary.categories.map((c) => (
                  <li key={c.key}>
                    <Badge tone={CATEGORY_TONE[c.key]}>
                      {t(`category.${c.key}`)} · {c.count}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat tone="money" label={t('detail.collected')} value={money(summary.collected, summary.currency)} strong />
            <Stat tone="work" label={t('detail.done')} value={t('progress', { done: summary.done, total: summary.total })} />
            <Stat
              tone="map"
              label={t('detail.distance')}
              value={route.totalDistanceKm != null ? t('km', { n: route.totalDistanceKm.toFixed(1) }) : null}
              // Sin distancia se dice por qué no la hay: un «—» parece un cero o un dato perdido.
              empty={t('detail.noDistance')}
            />
          </dl>

          {/*
           * La barra dice de un vistazo lo que el «0 de 4» dice leyendo. 🔴 El número va igual al
           * lado: el color no es el dato —hay quien no lo distingue—, y una barra sin cifra obliga a
           * calcular a ojo cuántas paradas faltan.
           */}
          <div className="mt-5 flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={summary.percent}
              aria-label={t('detail.percent')}
              className="h-2.5 flex-1 overflow-hidden rounded-full bg-k-light-bg"
            >
              <div
                className={`h-full rounded-full ${
                  summary.percent === 100 ? 'bg-k-success' : 'bg-gradient-to-r from-k-periwinkle to-k-purple'
                }`}
                style={{ width: `${summary.percent}%` }}
              />
            </div>
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-k-text-2">{summary.percent}%</span>
          </div>
        </Card>

        {/*
         * El mapa, las paradas y su edición: todo junto en el cliente. El orden, el quitar y el
         * sumar necesitan estado, y media lista pintada en el servidor y media acá son dos lugares
         * donde arreglar el mismo detalle.
         */}
        {stops.length > 0 || editing ? (
          <RouteEditor
            routeId={route.id}
            stops={stops}
            visits={(visits.body.data ?? []).map((v) => ({ latitude: v.latitude, longitude: v.longitude }))}
            line={preview.body.data?.geometry ?? []}
            editing={editing}
            available={available?.body.data ?? []}
            total={available?.body.meta?.total ?? available?.body.data?.length ?? 0}
            filtered={hasPlanFilters(planParams)}
          />
        ) : (
          <section>
            <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.stops')}</h2>
            <EmptyState title={t('detail.stopsEmpty')} />
          </section>
        )}
      </div>
    </>
  );
}

/**
 * Los tres colores del resumen: la plata, el trabajo y el mapa.
 *
 * 🔴 El color va en el **fondo y en la línea de abajo**, nunca en el número: sobre estos tintes, un
 * verde de 24 px queda por debajo del contraste mínimo. El dato se lee en navy en las tres, y el
 * color sirve para encontrar la tarjeta de un vistazo, no para decir qué dice.
 */
const STAT_TONES = {
  money: 'border-b-k-success bg-k-success-bg',
  work: 'border-b-k-purple bg-k-highlight',
  map: 'border-b-k-periwinkle bg-k-light-bg',
} as const;

/**
 * Un número del resumen del día. Distinto de `Fact`: acá el valor **es** lo que se viene a mirar, así
 * que se lee de lejos, y el que falta se explica en vez de mostrar un guión.
 */
function Stat({
  label,
  value,
  empty,
  strong,
  tone,
}: {
  label: string;
  value: string | null;
  empty?: string;
  /** El número principal de la tarjeta. Uno solo: si todos gritan, ninguno destaca. */
  strong?: boolean;
  tone: keyof typeof STAT_TONES;
}) {
  // Los bordes se declaran por lado: `border-k-border` pinta los cuatro, y que el color de abajo lo
  // pise dependería del orden en el que Tailwind emita las reglas.
  return (
    <div
      className={`rounded-xl border-x border-t border-b-4 border-x-k-border border-t-k-border px-4 py-3.5 ${STAT_TONES[tone]}`}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-slate">{label}</dt>
      <dd
        className={`mt-1.5 tabular-nums ${
          value === null
            ? 'text-[15px] text-k-text-2'
            : strong
              ? 'text-[24px] font-semibold leading-tight text-k-navy'
              : 'text-[20px] font-medium leading-tight text-k-navy'
        }`}
      >
        {value ?? empty}
      </dd>
    </div>
  );
}

/*
 * Acá vivía `Stop`, que pintaba cada parada en el servidor. Se mudó entera a `RouteEditor`: el orden,
 * el quitar y el sumar necesitan estado, y media lista en el servidor y media en el cliente son dos
 * lugares donde arreglar el mismo detalle.
 */
