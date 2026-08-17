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
import { CatalogType, RouteStatus } from '@kobrax/shared';
import { listCases, type CaseListItem } from '../cases.service';
import { getRoute, listRoutes } from '../routes.service';
import { clientContext, listByDay, listOverdue } from '../agenda.service';
import { listCatalog } from '../catalogs.service';
import { listNotifications } from '../notifications.service';
import { listPaymentsByDay } from '../payments.service';
import { getClient, type ClientDetail } from '../clients.service';
import { todayISO } from '../agenda-form';
import * as db from '../db';

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
  const hoy = todayISO();

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
  await paso('cartera', () => estado(listCases({ view: 'portfolio', open: true, limit: 100 }))); // Cobranza · Crear ruta
  await paso('casos abiertos', () => estado(listCases({ assigneeId: collectorId, open: true, limit: 1 }))); // Inicio
  await paso('rutas', () => estado(listRoutes({ collectorId }))); // pestaña Rutas
  await paso('agenda', () => estado(listByDay(hoy)));
  await paso('vencidos', () => estado(listOverdue(100)));
  await paso('notificaciones', () => estado(listNotifications()));
  await paso('cobrado hoy', () => estado(listPaymentsByDay(hoy))); // Inicio · pestaña Rutas · resumen

  // La ruta activa, y **su detalle con las paradas**: el listado no las trae y son el itinerario.
  await paso('ruta del día', async () => {
    const res = await listRoutes({ collectorId, status: RouteStatus.IN_PROGRESS }); // Inicio
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    const activa = res.data[0];
    if (!activa) return 'ok'; // sin ruta hoy no hay nada que bajar
    return estado(getRoute(activa.id));
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
    const casos = await db.getMany<CaseListItem>('case');
    const clientIds = [...new Set(casos.map((c) => c.clientId).filter(Boolean))].slice(0, MAX_FICHAS);
    if (clientIds.length === 0) return 'ok';
    for (const id of clientIds) {
      const ficha = await getClient(id);
      if (ficha.status === 'offline') return 'offline';
      if (ficha.status === 'ok') await db.putAll<ClientDetail>('client', [ficha.data]);
      // El contexto es lo que consume el alta de gestión (créditos + contactos + ubicaciones).
      const ctx = await clientContext(id);
      if (ctx.status === 'offline') return 'offline';
    }
    return 'ok';
  });

  return { ok, failed, offline };
}

/** Cuándo se hidrató por última vez (para el "datos de las 08:15" del riesgo R4). */
export function lastHydratedAt(): Promise<number | null> {
  return db.fetchedAt('case');
}
