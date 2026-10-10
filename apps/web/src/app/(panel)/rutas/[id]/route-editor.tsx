'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { isOpenStop, RouteStopStatus, type RouteCapabilities, type RouteChangeKind, type RouteStopItem } from '@kobrax/shared';
import { ReasonDialog } from '@/components/reason-dialog';
import { SourceBadge } from '@/components/source-badge';
import { AvailableList } from '@/components/route-planner/available-list';
import { MapPanel, type OrderItem, type PlanArea } from '@/components/route-planner/map-panel';
import { candidatePins, distanceLabel, nearbySuggestions, parsePinId, pinId } from '@/components/route-planner/candidate-pins';
import type { MapPoint, PointBadge } from '@/components/route-planner/points-map';
import { FilterPanel } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { sendJson, postJson } from '@/lib/client';
import { money, time } from '@/lib/format';
import { AVAILABLE_LIMIT, SUGGEST_KM, withinRadius, type AvailableCredit } from '@/lib/plan';
import { STOP_STATUS_TONE } from '@/lib/routes';
import { PlanLocationDialog } from '../planificar/plan-location-dialog';
import { planFilterDefs, PLAN_FILTER_KEYS } from '../planificar/plan-filters';
import { RecordVisitDialog } from './record-visit-dialog';
import { WhatsAppButton } from './whatsapp-button';

/**
 * La ruta armada: **el mapa, sus paradas y —cuando se enciende— la edición**.
 *
 * 🔴 **Es la misma pantalla que armar y que la vista previa** (F4/12): el mapa a la izquierda y el recorrido a la
 * derecha (`MapPanel`), la misma lista con los mismos filtros (`AvailableList`, `FilterPanel`), la misma elección de
 * ubicación (`PlanLocationDialog`). Con dos versiones una se queda vieja el día que se toque un detalle, y las
 * pantallas dejan de parecerse.
 *
 * 🔴 **Sólo se toca lo que sigue pendiente.** Una parada visitada o salteada es historia de la
 * jornada —hay una visita con hora, GPS y a veces una foto colgando de ella—: moverla cambiaría el
 * orden de algo que ya pasó y quitarla borraría la prueba. La guarda de verdad es del servidor
 * (`ROUTE_STOP_DONE`); esconder controles es cortesía.
 *
 * 🔴 **Quien armó la ruta cambia directo; el resto PIDE el cambio (F4/12 · decisión 1).** Es la misma pantalla: lo que
 * cambia es qué pasa al tocar. Con `capabilities.edit` cada acción va sola a la API; sin ella, cada acción abre el
 * diálogo del motivo y manda un pedido que quien armó la ruta aprueba o rechaza.
 *
 * 🔴 **El modo edición vive en la URL** (`?editar=1`), y no en un `useState`: la mora que se puede
 * sumar la trae el servidor, así que entrar a editar es pedirle esa lista. Un booleano local no
 * podría traerla.
 *
 * 🔴 **Cada acción va sola al servidor y se recarga.** Reordenar mueve la lista entera del lado de la
 * API —el número de parada es único por ruta—, así que guardar un orden armado en el navegador
 * exigiría replicar esa lógica acá y mantener las dos iguales para siempre.
 *
 * 🔴 **Sugerencias cerca de la ruta.** La mora **sin ruta** que queda a menos de `SUGGEST_KM` de alguna parada se dibuja
 * en el mapa y se lista al costado: «ya voy a estar por ahí», una visita preventiva. Es la cartera del cobrador de esta
 * ruta más lo que tiene asignado como ayuda (lo resuelve `GET /mora` con `assigneeId`). Agregarla es igual que sumar
 * una parada: directo para quien armó la ruta, pedido con motivo para el resto.
 */

/**
 * El alto del mapa de esta ficha. Al entrar y salir de la edición el mapa es el mismo componente: con altos
 * distintos, todo lo que está abajo saltaba a cada clic.
 */
const MAP_HEIGHT = 540;

/** Un UUID de ubicación. Un dato viejo sin id usa un índice como parte del pin, y ése no viaja a la API. */
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function RouteEditor({
  routeId,
  stops,
  visits,
  line,
  editing,
  available,
  total,
  filtered,
  categories,
  capabilities: caps,
  collectorName,
  viewerIsCollector,
  canPay,
  today,
}: {
  routeId: string;
  stops: RouteStopItem[];
  visits: { latitude: number; longitude: number }[];
  /** El recorrido por las calles. Vacío si el motor de ruteo no contestó: el mapa se dibuja igual. */
  line: { latitude: number; longitude: number }[];
  editing: boolean;
  /**
   * La mora que se puede sumar (`id` = creditId), sin lo que ya es parada de esta ruta. Se pide siempre que la ruta esté
   * abierta: de ahí salen las sugerencias; al editar es además la lista para elegir.
   */
  available: AvailableCredit[];
  total: number;
  filtered: boolean;
  /** Las categorías de mora de la cuenta, para el filtro. */
  categories: { code: string; name: string }[];
  /** Lo que quien mira puede hacer con esta ruta (lo decide la API). */
  capabilities: RouteCapabilities;
  collectorName: string;
  viewerIsCollector: boolean;
  /** `payment:write`: para registrar un cobro desde el panel. */
  canPay: boolean;
  /** «Hoy» de la empresa, para la fecha mínima de una promesa. */
  today: string;
}) {
  const t = useTranslations('panel.routes');
  const tPlan = useTranslations('panel.routes.planning');
  const tFilters = useTranslations('panel.routes.planning.filters');
  const tOutcome = useTranslations('panel.routes.outcome');
  const tTable = useTranslations('panel.table');
  const tStops = useTranslations('panel.routes.stopsTable');
  const tSuggest = useTranslations('panel.routes.suggest');
  const tType = useTranslations('portfolio.locationType');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [panelOpen, setPanelOpen] = useState(filtered);
  const [area, setArea] = useState<PlanArea | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSuggest, setShowSuggest] = useState(true);
  // La parada sobre la que se registra una gestión, y el pedido de cambio que espera su motivo.
  const [recording, setRecording] = useState<RouteStopItem | null>(null);
  const [asking, setAsking] = useState<{ kind: RouteChangeKind; payload: Record<string, unknown> } | null>(null);
  // El crédito al que hay que elegirle la ubicación antes de sumarlo (más de una, o ninguna con punto).
  const [locFor, setLocFor] = useState<AvailableCredit | null>(null);
  /** La parada a la que se le está cambiando la dirección (la misma pregunta de a qué puerta se va). */
  const [relocate, setRelocate] = useState<RouteStopItem | null>(null);

  // Quien armó la ruta (o su administrador) cambia directo; el resto PIDE el cambio y quien la armó lo aprueba.
  const direct = caps.edit;
  const canEditMode = caps.edit || caps.requestChange;

  const pendientes = stops.filter((s) => s.status === RouteStopStatus.PENDING).length;
  const byId = useMemo(() => new Map(available.map((c) => [c.id, c])), [available]);

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
    const sequenceOrder = stop.sequenceOrder + delta;
    if (!direct) return setAsking({ kind: 'REORDER', payload: { stopId, sequenceOrder } });
    void run(stopId, () => sendJson(`/api/routes/${routeId}/stops/${stopId}`, { sequenceOrder }, 'PATCH'));
  };

  const remove = (stopId: string) => {
    if (!direct) return setAsking({ kind: 'REMOVE_STOP', payload: { stopId } });
    void run(stopId, () => sendJson(`/api/routes/${routeId}/stops/${stopId}`, null, 'DELETE'));
  };

  /**
   * Sumar un crédito a la ruta. Va con **cliente, crédito y ubicación**: el cliente es lo que la parada necesita para
   * tener dirección, el crédito es contra qué se cobra cuando el cobrador llegue, y la ubicación es **a cuál de sus
   * puertas se va** (domicilio, trabajo, un garante). Sin ubicación, la API resuelve la principal del cliente.
   */
  const add = (creditId: string, locationId?: string) => {
    const credito = byId.get(creditId);
    if (!credito) return;
    const loc = locationId && IS_UUID.test(locationId) ? { locationId } : {};
    if (!direct) return setAsking({ kind: 'ADD_STOP', payload: { clientId: credito.clientId, creditId, ...loc } });
    void run(creditId, () => postJson(`/api/routes/${routeId}/stops`, { clientId: credito.clientId, creditId, ...loc }));
  };

  /**
   * Sumar desde la lista o desde una sugerencia: con **una sola** ubicación dibujable se va a esa; con varias —o con
   * ninguna con punto— se pregunta a cuál, como al armar la ruta. Una parada sin punto en el mapa no se puede dibujar.
   */
  const requestAdd = (creditId: string) => {
    const c = byId.get(creditId);
    if (!c) return;
    const drawable = (c.locations ?? []).filter((l) => l.id);
    if (drawable.length === 1) return add(creditId, drawable[0]!.id);
    setLocFor(c);
  };

  /**
   * Cambiar a qué dirección del cliente va una parada que ya está en la ruta: abre el mismo modal que al sumar un cliente.
   * Solo quien armó la ruta y solo una parada pendiente; la API vuelve a validarlo.
   */
  const askRelocate = (stopId: string) => {
    const stop = stops.find((s) => s.id === stopId);
    if (stop && stop.status === RouteStopStatus.PENDING) setRelocate(stop);
  };

  /** Arrastrar una parada a otro lugar: una sola llamada, la API reordena la lista entera. */
  const reorder = (stopId: string, toIndex: number) => {
    const sequenceOrder = toIndex + 1;
    if (!direct) return setAsking({ kind: 'REORDER', payload: { stopId, sequenceOrder } });
    void run(stopId, () => sendJson(`/api/routes/${routeId}/stops/${stopId}`, { sequenceOrder }, 'PATCH'));
  };

  /** El pedido de cambio, con el motivo que escribió quien lo pide. */
  async function sendRequest(reason: string): Promise<string | null> {
    if (!asking) return null;
    const { ok, data } = await postJson(`/api/routes/${routeId}/change-requests`, { ...asking, reason });
    if (!ok) return (data as { error?: { message?: string } }).error?.message ?? t('edit.error');
    setNotice(tStops('askSent'));
    router.refresh();
    return null;
  }

  /*
   * Un clic en el mapa. Editando: si el punto es una parada, se saca; si es mora disponible, se suma **con esa
   * ubicación**. Mirando: una parada abre su detalle (el resto se suma desde el costado, con el botón). Un solo camino
   * con la lista y el panel de orden — con dos, un día el mapa y la tabla dejan de coincidir.
   */
  const clickPunto = (pin: string) => {
    const stop = stops.find((s) => s.id === pin);
    if (stop) {
      if (!editing) return router.push(`/rutas/${routeId}/parada/${pin}`);
      // Una parada ya gestionada es la jornada que pasó: ni se quita ni se pide quitarla (la lista ya la marca como bloqueada).
      return stop.status === RouteStopStatus.PENDING ? remove(pin) : undefined;
    }
    if (!editing || !canEditMode) return;
    const { creditId, locationId } = parsePinId(pin);
    add(creditId, locationId);
  };

  /** Las filas de abajo: primero el área —si está puesta—, y el orden lo resuelve la lista. */
  const filas = useMemo(() => (area ? withinRadius(available, area, area.radiusKm) : available), [available, area]);

  const withPoint = stops.filter((s) => s.latitude != null && s.longitude != null);
  /** Dónde está la ruta: la primera parada con punto. El mapa de marcar una dirección sin punto abre por ahí, no en otra ciudad. */
  const routeCenter = withPoint[0] ? { latitude: withPoint[0].latitude!, longitude: withPoint[0].longitude! } : undefined;
  const nextId = stops
    .filter((s) => isOpenStop(s.status as never))
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)[0]?.id;

  // La mora sin ruta a menos de `SUGGEST_KM` de alguna parada: visitas preventivas. Con la ruta cerrada no llega mora.
  const suggestions = useMemo(
    () => nearbySuggestions(available, withPoint.map((s) => ({ latitude: s.latitude!, longitude: s.longitude! })), SUGGEST_KM),
    // `withPoint` se rearma en cada render; sus coordenadas cambian sólo si cambian las paradas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, stops],
  );

  const detailOf = (c: AvailableCredit) =>
    [money(c.amount, c.currency ?? 'BOB'), c.daysPastDue ? tPlan('days', { n: c.daysPastDue }) : null, c.zone ?? null].filter(Boolean).join(' · ');

  /** El estado de una parada, dicho dos veces —pin y etiqueta— pero cada una a su manera (ver `PointsMap`). */
  const toneOf = (s: RouteStopItem) =>
    s.status === RouteStopStatus.VISITED
      ? ('done' as const)
      : s.status === RouteStopStatus.SKIPPED
        ? ('skipped' as const)
        : s.id === nextId
          ? ('next' as const)
          : s.agendaItemId || s.scheduledTime
            ? ('scheduled' as const)
            : ('pending' as const);

  const badgesOf = (s: RouteStopItem): PointBadge[] => [
    { label: t(`stopStatus.${s.status}`), tone: STOP_STATUS_TONE[s.status] },
    ...(s.lastOutcome ? [{ label: t(`outcome.${s.lastOutcome}`), tone: 'neutral' as const }] : []),
    ...(s.agendaItemId ? [{ label: tStops('withVisit'), tone: 'warning' as const }] : []),
    ...(s.scheduledTime ? [{ label: tPlan('fixedAt', { time: s.scheduledTime }), tone: 'info' as const }] : []),
    ...(s.isHelp ? [{ label: tPlan('help'), tone: 'warning' as const }] : []),
    ...(s.overdueAmount != null ? [{ label: money(s.overdueAmount, s.currency ?? 'BOB'), tone: 'neutral' as const }] : []),
    ...(s.daysPastDue ? [{ label: tStops('days', { n: s.daysPastDue }), tone: 'danger' as const }] : []),
  ];

  /*
   * Los pines. **Las paradas siempre**, numeradas y del color de su estado: son la ruta. Con el recorrido por las calles,
   * el mapa lo dibuja; si no, une las paradas con rectas. Además: el punto donde se registró cada visita; las
   * sugerencias cercanas (si están encendidas); y, editando con área puesta, **cada ubicación** de la mora que cae adentro.
   */
  const puntos = useMemo(() => {
    const deParadas: MapPoint[] = withPoint.map((s) => ({
      id: s.id,
      latitude: s.latitude!,
      longitude: s.longitude!,
      label: s.clientName ?? undefined,
      detail: [s.locationOwner, s.address].filter(Boolean).join(' · ') || undefined,
      picked: true,
      order: s.sequenceOrder,
      photoUrl: s.locationPhotoUrl,
      tone: toneOf(s),
      badges: badgesOf(s),
    }));
    const deVisitas: MapPoint[] = visits.map((v, i) => ({
      id: `visit:${i}`,
      latitude: v.latitude,
      longitude: v.longitude,
      label: t('detail.visitPoint'),
      tone: 'visit' as const,
    }));
    const deArea: MapPoint[] =
      editing && area
        ? candidatePins(filas, { skip: new Set(), typeLabel: (type) => tType(type as 'HOME'), detail: detailOf })
        : [];
    const deSugerencias: MapPoint[] = showSuggest
      ? suggestions.map((s) => ({
          // El mismo id que `candidatePins` (aun sin id de ubicación): si no, con el área puesta la puerta saldría dos veces.
          id: pinId(s.credit.id, s.location.id ?? `i${s.index}`),
          latitude: s.location.latitude,
          longitude: s.location.longitude,
          label: s.credit.clientName ?? undefined,
          detail: [detailOf(s.credit), distanceLabel(s.km, locale)].filter(Boolean).join(' · '),
          tone: 'suggestion' as const,
          photoUrl: s.location.photoUrl,
          badges: [{ label: tSuggest('badge'), tone: 'warning' as const }],
        }))
      : [];
    // Un mismo id no puede ser dos pines: la sugerencia pisa al candidato gris (es la misma ubicación, mejor dicha).
    // 🔴 Las paradas **primero**: el área de búsqueda se centra en el primer punto, y tiene que ser de la ruta.
    return [...new Map([...deParadas, ...deVisitas, ...deArea, ...deSugerencias].map((p) => [p.id, p])).values()];
    // `toneOf`, `badgesOf` y `detailOf` dependen de lo que ya está en la lista de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, visits, area, filas, editing, showSuggest, suggestions, nextId, locale]);

  /** La lista de la derecha: las mismas paradas, con su estado, su hora y —mirando— sus acciones. */
  const orden: OrderItem[] = stops.map((s) => {
    const canRecord = caps.recordVisit && !!s.creditId && s.status !== RouteStopStatus.VISITED;
    return {
      id: s.id,
      name: s.clientName ?? '—',
      hint: [s.locationOwner, s.address].filter(Boolean).join(' · ') || '—',
      // Las fotos de la casa: miniatura en la fila y, al tocarla, todas.
      photos: s.locationPhotoUrls ?? (s.locationPhotoUrl ? [s.locationPhotoUrl] : undefined),
      photosOwner: s.locationOwner,
      // La hora real si ya se visitó; la hora fija de la visita agendada si la tiene; si no, nada.
      meta: s.visitedAt ? time(s.visitedAt, locale) : s.scheduledTime,
      tone: toneOf(s),
      locked: s.status !== RouteStopStatus.PENDING,
      badges: badgesOf(s),
      ...(editing
        ? {}
        : {
            href: `/rutas/${routeId}/parada/${s.id}`,
            // WhatsApp (solo ícono) y «Ver detalle» van antes de «Ir en mapa»; «Registrar» después.
            trailing: (
              <>
                <WhatsAppButton clientId={s.clientId} clientName={s.clientName} variant="icon" />
                <Link
                  href={`/rutas/${routeId}/parada/${s.id}`}
                  className="inline-flex h-8 items-center rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-slate hover:bg-k-bg"
                >
                  {tStops('viewDetail')}
                </Link>
              </>
            ),
            primary: canRecord ? (
              <button
                type="button"
                onClick={() => setRecording(s)}
                className="h-8 rounded-lg bg-k-navy px-3 text-[13px] font-semibold text-white hover:bg-k-slate"
              >
                {tStops('register')}
              </button>
            ) : undefined,
            // D7: el cobrador tiene que saber que ese saldo es el reportado por el banco.
            chips: <SourceBadge source={s.externalSource} syncStatus={s.syncStatus} reportedAsOf={s.reportedAsOf} />,
            menu: [
              { label: tStops('clientFile'), href: `/cartera/${s.clientId}` },
              ...(s.address ? [{ label: tStops('copyAddress'), onClick: () => void navigator.clipboard?.writeText(s.address!) }] : []),
            ],
          }),
    };
  });

  /** Las sugerencias, a un costado del recorrido: quién es, cuánto debe, a qué distancia y cómo sumarla. */
  const lateral =
    showSuggest && suggestions.length > 0 ? (
      <section className="rounded-2xl border border-k-warning bg-k-warning-bg/40 p-4">
        <h3 className="text-[14px] font-semibold text-k-navy">{tSuggest('title', { n: suggestions.length })}</h3>
        <p className="mt-0.5 text-[12px] text-k-text-2">{tSuggest('hint', { km: SUGGEST_KM })}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {suggestions.map((s) => (
            <li key={s.credit.id} className={`rounded-xl border border-k-border bg-white px-3 py-2 ${busy === s.credit.id ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-k-text">{s.credit.clientName ?? '—'}</p>
                  <p className="truncate text-[12px] text-k-text-2">{detailOf(s.credit)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-k-warning-bg px-2 py-0.5 text-[11px] font-medium text-k-warning-text">
                  {tSuggest('away', { d: distanceLabel(s.km, locale) })}
                </span>
              </div>
              {canEditMode && (
                <button
                  type="button"
                  onClick={() => requestAdd(s.credit.id)}
                  className="mt-1.5 text-[12px] font-medium text-k-periwinkle hover:underline"
                >
                  {direct ? tSuggest('add') : tSuggest('ask')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const suggestToggle =
    suggestions.length > 0 ? (
      <button
        type="button"
        onClick={() => setShowSuggest((v) => !v)}
        aria-pressed={showSuggest}
        className={`h-8 rounded-lg border px-3 text-[13px] font-medium ${
          showSuggest ? 'border-k-warning bg-k-warning-bg text-k-warning-text' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
        }`}
      >
        {tSuggest('toggle', { n: suggestions.length })}
      </button>
    ) : null;

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-xl border border-k-danger bg-k-danger-bg px-4 py-3 text-[13px] text-k-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl border border-k-success bg-k-success-bg px-4 py-3 text-[13px] text-k-text">
          {notice}
        </p>
      )}

      {/*
       * 🔴 **El mismo mapa en las dos vistas.** Mirando: el recorrido y sus paradas, con las acciones de cada una.
       * Editando: lo mismo, con el orden en la lista y la búsqueda por área. Lo que cambia es qué se puede tocar, no cómo
       * se ve — por eso entrar a editar no mueve nada de lugar.
       */}
      <MapPanel
        points={puntos}
        order={orden}
        area={area}
        onArea={setArea}
        noArea={!editing}
        onPointClick={clickPunto}
        onMove={editing && canEditMode ? move : undefined}
        onReorder={editing && canEditMode ? reorder : undefined}
        onRemove={editing && canEditMode ? remove : undefined}
        onChangeAddress={editing && canEditMode && direct ? askRelocate : undefined}
        alwaysShowList
        listWide
        listTitle={t('detail.stopsCount', { n: stops.length })}
        line={line}
        height={MAP_HEIGHT}
        counter={
          area
            ? tPlan('mapInArea', { n: puntos.length, km: area.radiusKm })
            : [t('edit.mapCount', { n: withPoint.length }), showSuggest && suggestions.length > 0 ? tSuggest('count', { n: suggestions.length }) : null].filter(Boolean).join(' · ')
        }
        actions={
          <>
            {suggestToggle}
            {editing && canEditMode ? (
              <button
                type="button"
                onClick={salir}
                className="h-8 rounded-lg border border-k-navy bg-k-navy px-3 text-[13px] font-medium text-white hover:bg-k-slate"
              >
                {t('edit.done')}
              </button>
            ) : (
              /* Sin ninguna pendiente no hay nada que editar: la jornada ya pasó entera. */
              pendientes > 0 &&
              canEditMode && (
                <button
                  type="button"
                  onClick={() => go({ editar: '1' })}
                  className="h-8 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
                >
                  {direct ? t('edit.start') : t('edit.startRequest')}
                </button>
              )
            )}
          </>
        }
      />

      {/*
        🔴 Se mira la GEOMETRÍA, no el status: cuando el motor de ruteo está caído la API degrada
        con 200 y una geometría vacía, así que preguntar por el status dejaba el aviso sin
        dibujarse nunca — justo el «mapa con rectas y sin explicación» que se quería evitar.
      */}
      {/* Las sugerencias, **debajo** del mapa y a lo ancho: en la columna del recorrido dejaban un hueco bajo el mapa. */}
      {lateral}

      {!editing && line.length === 0 && <p className="text-[13px] text-k-text-2">{t('detail.noPreview')}</p>}

      {editing && canEditMode && (
        <>
          <p className="rounded-xl border border-k-border bg-k-bg px-4 py-2.5 text-[13px] text-k-text-2">
            {direct ? t('edit.hint') : t('edit.requestHint')}
          </p>

          {/* Abajo, para sumar: la misma lista con los mismos filtros que arma la ruta la primera vez. */}
          <div className="flex flex-col gap-5 lg:flex-row">
            {panelOpen && (
              <FilterPanel
                defs={planFilterDefs(tFilters, categories, tOutcome)}
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
                  <h2 className="text-[16px] font-semibold text-k-navy">{direct ? t('edit.addTitle') : t('edit.askAddTitle')}</h2>
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
                  onToggle={requestAdd}
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
      )}

      {recording && (
        <RecordVisitDialog
          open
          onClose={() => setRecording(null)}
          stop={{
            id: recording.id,
            creditId: recording.creditId,
            clientName: recording.clientName,
            address: recording.address,
            latitude: recording.latitude,
            longitude: recording.longitude,
            overdueAmount: recording.overdueAmount,
            installmentAmount: recording.installmentAmount,
            nextDueDate: recording.nextDueDate,
            currency: recording.currency,
            externalSource: recording.externalSource,
            locationId: recording.locationId,
          }}
          collectorName={collectorName}
          viewerIsCollector={viewerIsCollector}
          canPay={canPay}
          today={today}
        />
      )}

      {relocate && (
        <PlanLocationDialog
          open
          onClose={() => setRelocate(null)}
          clientId={relocate.clientId}
          clientName={relocate.clientName}
          near={routeCenter}
          chosenId={relocate.locationId}
          onChoose={(loc) => {
            const stopId = relocate.id;
            setRelocate(null);
            void run(stopId, () => sendJson(`/api/routes/${routeId}/stops/${stopId}`, { locationId: loc.id }, 'PATCH'));
          }}
        />
      )}

      {/* A cuál de las ubicaciones del cliente se va: la misma pregunta, el mismo diálogo que al armar la ruta. */}
      {locFor && (
        <PlanLocationDialog
          open
          onClose={() => setLocFor(null)}
          clientId={locFor.clientId}
          clientName={locFor.clientName}
          near={routeCenter}
          onChoose={(loc) => add(locFor.id, loc.id)}
        />
      )}

      <ReasonDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking?.kind === 'REMOVE_STOP' ? tStops('askTitleRemove') : asking?.kind === 'REORDER' ? tStops('askTitleMove') : t('edit.askAddTitle')}
        confirmLabel={tStops('askSend')}
        onConfirm={sendRequest}
      >
        {asking?.kind === 'REMOVE_STOP' ? tStops('askTextRemove') : asking?.kind === 'REORDER' ? tStops('askTextMove') : t('edit.askAddText')}
      </ReasonDialog>
    </div>
  );
}
