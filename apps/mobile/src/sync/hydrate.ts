/**
 * Hidratación: **el "sync de oficina"** (`ui-screen-map §4.1`). Baja de una vez lo que el cobrador
 * va a necesitar en la calle y lo deja en la base local, para que después opere sin señal.
 *
 * Se hace con wifi, antes de salir. Es la mitad de lectura del offline; la de escritura es la cola.
 *
 * `ponytail:` baja **listas**, no fichas de a una. La ficha de un cliente cualquiera se cachea sola
 * cuando se abre con red (eso lo hace la capa de lectura), así que gastar N llamadas acá para
 * pre-bajar toda la cartera en detalle sería pagar dos veces por lo mismo. La excepción son los
 * clientes de la ruta del día: a esos seguro los va a visitar, y ahí no puede quedarse sin datos.
 */
import { CatalogType } from '@kobrax/shared';
import { RouteStatus } from '@kobrax/shared';
import { listCases, type CaseListItem } from '../cases.service';
import { getRoute, listRoutes, type RouteItem } from '../routes.service';
import { listByDay, listOverdue, type AgendaListItem } from '../agenda.service';
import { listCatalog, type CatalogOption } from '../catalogs.service';
import { listNotifications } from '../notifications.service';
import { getClient, type ClientDetail } from '../clients.service';
import { todayISO } from '../agenda-form';
import * as db from '../db';

/**
 * Los catálogos que las pantallas de campo abren, **verificados uno por uno** contra el código que
 * los consume (no los 12 del enum: bajar los que nadie usa son requests de más en la oficina).
 *   PAYMENT_METHOD/BANK → registrar pago · SPECIAL_CATEGORY → resultado de parada (RT-6)
 *   CANCEL_REASON/RESCHEDULE_REASON → menú ⋯ del detalle de gestión · WHATSAPP_TEMPLATE → envío
 */
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

  const paso = async (nombre: string, fn: () => Promise<'ok' | 'offline' | 'error'>): Promise<void> => {
    const r = await fn();
    if (r === 'ok') ok.push(nombre);
    else {
      failed.push(nombre);
      if (r === 'offline') offline = true;
    }
  };

  // 1. La cartera entera (decisión Q1 del plan): el deudor que aparece fuera de ruta también
  //    tiene que poder cobrarse. Son cientos de filas, una sola llamada.
  await paso('cartera', async () => {
    const res = await listCases({ view: 'portfolio', limit: 500 });
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    await db.replaceAll<CaseListItem>('case', res.data, undefined, (c) => c.clientId);
    return 'ok';
  });

  // 2. La ruta activa CON sus paradas: el listado no las trae, y son el itinerario del día.
  await paso('ruta', async () => {
    const res = await listRoutes({ collectorId, status: RouteStatus.IN_PROGRESS });
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    const activa = res.data[0];
    if (!activa) {
      await db.replaceAll<RouteItem>('route', []); // sin ruta hoy: que no quede la de ayer
      return 'ok';
    }
    const detalle = await getRoute(activa.id);
    if (detalle.status !== 'ok') return detalle.status === 'offline' ? 'offline' : 'error';
    await db.replaceAll<RouteItem>('route', [detalle.data]);
    return 'ok';
  });

  // 3. Agenda de hoy + lo vencido. Se guardan con `scope` distinto para poder leerlas por separado.
  await paso('agenda', async () => {
    const res = await listByDay(hoy);
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    await db.replaceAll<AgendaListItem>('agenda', res.data, hoy);
    return 'ok';
  });

  await paso('vencidos', async () => {
    const res = await listOverdue(100);
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    await db.replaceAll<AgendaListItem>('agenda', res.data, 'overdue');
    return 'ok';
  });

  // 4. Catálogos: sin ellos, el sheet de registrar un pago se abre vacío en el campo.
  await paso('catálogos', async () => {
    let hubo = false;
    for (const catalog of CATALOGOS) {
      const res = await listCatalog(catalog);
      if (res.status === 'offline') return 'offline';
      if (res.status !== 'ok') continue; // un catálogo que falla no tumba a los otros
      await db.replaceAll<CatalogOption>('catalog', res.data, catalog);
      hubo = true;
    }
    return hubo ? 'ok' : 'error';
  });

  await paso('notificaciones', async () => {
    const res = await listNotifications();
    if (res.status !== 'ok') return res.status === 'offline' ? 'offline' : 'error';
    await db.replaceAll('notification', res.data);
    return 'ok';
  });

  // 5. Las fichas de los clientes de la ruta. Es lo único que se baja de a uno, y se justifica:
  //    son los que va a tener enfrente. Si alguna falla, la parada igual tiene nombre y dirección.
  await paso('fichas de la ruta', async () => {
    const rutas = await db.getMany<RouteItem>('route');
    const clientIds = [...new Set((rutas[0]?.stops ?? []).map((s) => s.clientId).filter(Boolean))] as string[];
    if (clientIds.length === 0) return 'ok';
    let algunaOffline = false;
    for (const id of clientIds) {
      const res = await getClient(id);
      if (res.status === 'offline') {
        algunaOffline = true;
        break;
      }
      if (res.status === 'ok') await db.putAll<ClientDetail>('client', [res.data]);
    }
    return algunaOffline ? 'offline' : 'ok';
  });

  return { ok, failed, offline };
}

/** Cuándo se hidrató por última vez (para el "datos de las 08:15" del riesgo R4). */
export function lastHydratedAt(): Promise<number | null> {
  return db.fetchedAt('case');
}
