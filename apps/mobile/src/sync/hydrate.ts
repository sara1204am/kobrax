/**
 * Hidratación: **el "sync de oficina"** (`ui-screen-map §4.1`). Baja de una vez lo que el cobrador
 * va a necesitar en la calle y lo deja en la base local, para que después opere sin señal.
 *
 * Se hace con wifi, antes de salir. Es la mitad de lectura del offline; la de escritura es la cola.
 *
 * **No escribe en la base: llama a los services.** El guardado lo hace `sync/cached`, igual que
 * cuando la pantalla pide el dato. Esa es la única forma de que el respaldo quede bajo la misma
 * consulta que después va a consultarse — hidratar con otros parámetros llena casillas que nadie
 * mira, que es exactamente el defecto que destapó la prueba de campo.
 */
import { CACHE_MAX_BYTES, CACHE_TTL_DAYS, CatalogType, RouteStatus } from '@kobrax/shared';
import { getMora, getMoraMetrics, listArrearCategories, listMora, listMoraEpisodes, listMoraNotes, listMoraPromises, listPortfolio, MORA_LIMIT, TENANT_CURRENCY_PROBE_LIMIT } from '../mora.service';
import type { MoraRow } from '../mora';
import { getRoute, listRoutes } from '../routes.service';
import { clientContext, getItem, listByDay, listOverdue, refreshTenantToday } from '../agenda.service';
import type { AgendaListItem } from '@kobrax/shared';
import { addDays, agendaDetailIds, AGENDA_AHEAD_DAYS } from './agenda-offline';
import { syncAgendaReminders } from '../agenda-notifications';
import { listCatalog } from '../catalogs.service';
import { listNotifications } from '../notifications.service';
import { listCreditPayments, listPaymentsByDay } from '../payments.service';
import { getClient, type ClientDetail } from '../clients.service';
import { todayISO } from '../agenda-form';
import * as db from '../db';
import { getSession } from '../session';
import { preloadImages } from '../image-cache';
import { photoUri } from '../photo-uri';

/**
 * Los catálogos que las pantallas de campo abren, **verificados uno por uno** contra el código que
 * los consume (no los 12 del enum: bajar los que nadie usa son requests de más en la oficina).
 *   PAYMENT_METHOD/BANK → registrar pago · SPECIAL_CATEGORY → resultado de parada (RT-6)
 *   CANCEL_REASON/RESCHEDULE_REASON → menú ⋯ del detalle de gestión · WHATSAPP_TEMPLATE → envío
 */
/** Techo de fichas que se bajan de a una. Con más que esto, la hidratación deja de ser un trámite. */
const MAX_FICHAS = 150;

const CATALOGOS: CatalogType[] = [
  CatalogType.PAYMENT_METHOD,
  CatalogType.BANK,
  CatalogType.SPECIAL_CATEGORY,
  CatalogType.CANCEL_REASON,
  CatalogType.RESCHEDULE_REASON,
  CatalogType.WHATSAPP_TEMPLATE,
];

export interface HydrateResult {
  /** Qué se bajó bien, para el mensaje de la pantalla. */
  ok: string[];
  /** Qué falló. La hidratación **no es atómica**: lo que entró, entró. */
  failed: string[];
  /** `true` si no había red — el caller distingue "sin señal" de "el server falló". */
  offline: boolean;
}

/**
 * Baja la jornada. Cada recurso es independiente: si la agenda falla, la ruta igual queda guardada.
 * Un dato viejo sirve más que ninguno, así que **nada se borra si la bajada falla**.
 */
export async function hydrate(collectorId: string): Promise<HydrateResult> {
  const ok: string[] = [];
  const failed: string[] = [];
  let offline = false;
  // Primero qué día es para la empresa: todo lo que sigue se pide con ESE «hoy» (a las 20:00 en Bolivia el UTC ya es mañana).
  await refreshTenantToday();
  const hoy = todayISO();
  /** Las gestiones que bajan las listas: de ahí sale cuáles se bajan completas. */
  const gestiones: AgendaListItem[] = [];

  /** De `QueryResult` al resultado del paso: sólo interesa si se pudo bajar o no. */
  const estado = async (p: Promise<{ status: string }>): Promise<'ok' | 'offline' | 'error'> => {
    const r = await p;
    return r.status === 'ok' ? 'ok' : r.status === 'offline' ? 'offline' : 'error';
  };

  const paso = async (nombre: string, fn: () => Promise<'ok' | 'offline' | 'error'>): Promise<void> => {
    const r = await fn();
    if (r === 'ok') ok.push(nombre);
    else {
      failed.push(nombre);
      if (r === 'offline') offline = true;
    }
  };

  // 1–4. Se llaman **los mismos services que usan las pantallas, con los mismos parámetros**, y el
  //       guardado lo hace `cachedList` solo. Antes esto escribía en la base por su cuenta, y ahí
  //       estaba el defecto que destapó la prueba de campo: el respaldo de una lista se guarda bajo
  //       LA CONSULTA que la pidió, así que hidratar con `limit: 500` no le servía a la Cobranza,
  //       que pide `limit: 100`, ni hidratar la ruta filtrando por estado le servía a la pestaña
  //       Rutas, que pide sin filtro. Se llenaban casillas que nadie consultaba.
  //
  //       Por eso cada línea de acá abajo **copia exactamente** la llamada de su pantalla. Si una
  //       pantalla cambia sus parámetros, tiene que cambiar acá — y es el precio de que el respaldo
  //       sea la respuesta del server tal cual, sin reimplementar sus filtros en el teléfono.
  await paso('cartera', () => estado(listPortfolio())); // Cobranza · Crear ruta: TODOS los créditos, al día o en mora
  await paso('mora', () => estado(listMora({ limit: MORA_LIMIT }))); // Cobranza · chip En mora
  await paso('créditos en mora', () => estado(listMora({ limit: TENANT_CURRENCY_PROBE_LIMIT }))); // Inicio (moneda y contador)
  await paso('rutas', () => estado(listRoutes({ collectorId }))); // pestaña Rutas
  await paso('agenda', async () => {
    const r = await listByDay(hoy);
    if (r.status === 'ok') gestiones.push(...r.data);
    return estado(Promise.resolve(r));
  });
  // La semana que viene también se prepara en la oficina: sin esto, cualquier día que no fuera hoy daba «Sin conexión».
  await paso('agenda de la semana', async () => {
    let hubo = false;
    for (let i = 1; i <= AGENDA_AHEAD_DAYS; i++) {
      const r = await listByDay(addDays(hoy, i));
      if (r.status === 'offline') return 'offline';
      if (r.status !== 'ok') continue; // un día que falla no tumba a los otros
      hubo = true;
      gestiones.push(...r.data);
    }
    return hubo ? 'ok' : 'error';
  });
  await paso('vencidos', async () => {
    const r = await listOverdue(100);
    if (r.status === 'ok') gestiones.push(...r.data);
    return estado(Promise.resolve(r));
  });
  // Los avisos locales: con la agenda de la semana ya bajada, el teléfono avisa de cada gestión aunque no haya señal ni la app abierta.
  await paso('avisos de la agenda', async () => {
    await syncAgendaReminders(gestiones, { complete: true });
    return 'ok';
  });
  // El detalle de cada pendiente (teléfono, dirección, mensaje): sin él, una gestión que nunca se abrió con señal no se podía ni
  // ver ni registrar en la calle — el `GET /agenda/:id` es lo único que trae a dónde llamar o ir.
  await paso('detalle de las gestiones', async () => {
    let hubo = false;
    for (const id of agendaDetailIds(gestiones, hoy)) {
      const r = await getItem(id);
      if (r.status === 'offline') return 'offline';
      if (r.status === 'ok') hubo = true;
    }
    return hubo || gestiones.length === 0 ? 'ok' : 'error';
  });
  await paso('notificaciones', () => estado(listNotifications()));
  await paso('cobrado hoy', () => estado(listPaymentsByDay(hoy))); // Inicio · pestaña Rutas · resumen
  await paso('categorías de mora', () => estado(listArrearCategories())); // Cobranza (filtro) · ficha de mora

  // La ruta activa, y **su detalle con las paradas**: el listado no las trae y son el itinerario.
  await paso('ruta del día', async () => {
    const res = await listRoutes({ collectorId, status: RouteStatus.IN_PROGRESS }); // Inicio
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    const activa = res.data[0];
    if (!activa) return 'ok'; // sin ruta hoy no hay nada que bajar
    const detalle = await getRoute(activa.id);
    if (detalle.status === 'ok') {
      // La principal de cada parada pendiente: el itinerario se ve completo sin señal. Nunca tumba la hidratación.
      try {
        const session = await getSession();
        const fotos = (detalle.data.stops ?? [])
          .filter((p) => p.status === 'PENDING')
          .map((p) => (p.locationPhotoUrl ? photoUri(p.locationPhotoUrl) ?? undefined : undefined));
        if (session) await preloadImages(fotos, session.accessToken);
      } catch {
        /* una foto que no baja no es motivo de fallar */
      }
    }
    return estado(Promise.resolve(detalle));
  });

  // Catálogos: sin ellos, el sheet de registrar un pago se abre vacío en el campo.
  await paso('catálogos', async () => {
    let hubo = false;
    for (const catalog of CATALOGOS) {
      const res = await listCatalog(catalog);
      if (res.status === 'offline') return 'offline';
      if (res.status !== 'ok') continue; // un catálogo que falla no tumba a los otros
      hubo = true;
    }
    return hubo ? 'ok' : 'error';
  });

  // 5. Las fichas y el contexto de **toda la cartera**, no sólo de la ruta.
  //
  //    Empezó bajando sólo los clientes de la ruta y la prueba de campo mostró que no alcanza: el
  //    cobrador busca a un deudor que no estaba en el itinerario —se lo cruzó, o lo llamó— y sin
  //    señal lo encontraba en la lista pero no podía abrirlo ni agendarle nada. Ver el nombre y que
  //    la pantalla siguiente no cargue es peor que no encontrarlo.
  //
  //    ponytail: es lo único que se baja de a uno, y se paga UNA vez, en la oficina y con wifi
  //    (§4.1). El tope evita que una cartera enorme convierta la hidratación en algo eterno; si
  //    aparece un tenant que lo supere, el arreglo es un endpoint que devuelva el lote, no subirlo.
  await paso('fichas de la cartera', async () => {
    const cartera = await db.getMany<MoraRow>('portfolio');
    // La lista de mora es un subconjunto de la cartera, pero si la cartera falló y la mora no, igual se bajan esas.
    const enMora = await db.getMany<MoraRow>('mora');
    const clientIds = [...new Set([...cartera, ...enMora].map((c) => c.clientId).filter(Boolean))].slice(0, MAX_FICHAS);
    if (clientIds.length === 0) return 'ok';
    for (const id of clientIds) {
      const ficha = await getClient(id);
      if (ficha.status === 'offline') return 'offline';
      if (ficha.status === 'ok') await db.putAll<ClientDetail>('client', [ficha.data]);
      // El contexto es lo que consume el alta de gestión (créditos + contactos + ubicaciones).
      const ctx = await clientContext(id);
      if (ctx.status === 'offline') return 'offline';
      // Y la ficha de cada crédito (gestiones, asignaciones…): lo que la pantalla de cliente abre por `creditId`,
      // más lo que pide la ficha de mora (`app/mora/[creditId].tsx`, MISMAS llamadas): promesas, notas, pagos del crédito, historial de episodios y métricas de recuperación. Los nombres
      // (autores, responsable, asignados) ya vienen dentro de cada respuesta: no hace falta bajar el equipo.
      if (ctx.status === 'ok') {
        for (const c of ctx.data.credits) {
          const det = await getMora(c.creditId);
          if (det.status === 'offline') return 'offline';
          const eps = await listMoraEpisodes(c.creditId);
          if (eps.status === 'offline') return 'offline';
          const met = await getMoraMetrics(c.creditId);
          if (met.status === 'offline') return 'offline';
          const prom = await listMoraPromises(c.creditId);
          if (prom.status === 'offline') return 'offline';
          const notas = await listMoraNotes(c.creditId);
          if (notas.status === 'offline') return 'offline';
          const pagos = await listCreditPayments(c.creditId); // también la ficha del cliente
          if (pagos.status === 'offline') return 'offline';
        }
      }
    }
    return 'ok';
  });

  // Con datos recién bajados se poda lo vencido o lo que pasa del tope; sin señal NO se poda (no hay con qué reemplazarlo).
  if (ok.length > 0) await db.purgeCache(CACHE_TTL_DAYS * 86_400_000, CACHE_MAX_BYTES);
  return { ok, failed, offline };
}

/** Cuándo se hidrató por última vez (para el "datos de las 08:15" del riesgo R4). */
export function lastHydratedAt(): Promise<number | null> {
  return db.fetchedAt('portfolio');
}
