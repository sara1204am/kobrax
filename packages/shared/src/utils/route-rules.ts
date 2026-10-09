/**
 * Las reglas del ciclo de vida de una ruta y de sus paradas. Puras, sin red ni React.
 *
 * 🔴 **La API es la autoridad** (F4/12): estas tablas son las que ella aplica y las que la pantalla lee para decidir
 * qué botón mostrar. Que el cliente las tenga NO lo autoriza a nada: la API vuelve a validar cada cambio. Existe acá
 * para que web y móvil no reescriban la regla cada uno por su lado.
 */
import { RouteStatus, RouteStopStatus } from '../enums/index.js';

/**
 * De qué estado a cuáles se puede pasar. Completada y cancelada son finales: una ruta cerrada no se reabre.
 *
 * - Iniciar sale de PLANIFICADA; completar, de EN CURSO. No se completa lo que nunca se inició.
 * - Cancelar se puede desde PLANIFICADA o EN CURSO — pero con visitas ya registradas se **cierra**, no se cancela
 *   (la información de campo no se borra): esa regla depende de las paradas, así que la aplica `routeBlockers`.
 */
export const ROUTE_TRANSITIONS: Record<RouteStatus, RouteStatus[]> = {
  [RouteStatus.PLANNED]: [RouteStatus.IN_PROGRESS, RouteStatus.CANCELLED],
  [RouteStatus.IN_PROGRESS]: [RouteStatus.COMPLETED, RouteStatus.CANCELLED],
  [RouteStatus.COMPLETED]: [],
  [RouteStatus.CANCELLED]: [],
};

export function canTransitionRoute(from: RouteStatus, to: RouteStatus): boolean {
  return ROUTE_TRANSITIONS[from].includes(to);
}

/** Una ruta abierta todavía se puede armar y editar: planificada o en curso. */
export function routeIsOpen(status: RouteStatus): boolean {
  return status === RouteStatus.PLANNED || status === RouteStatus.IN_PROGRESS;
}

/**
 * Las paradas a mano. **VISITADA no está como destino**: una parada se visita registrando la visita (`POST /visits`),
 * que es lo que deja el GPS, el resultado y el cierre de la agenda. Marcarla a secas dejaba la gestión sin hacer.
 */
export const STOP_TRANSITIONS: Record<RouteStopStatus, RouteStopStatus[]> = {
  [RouteStopStatus.PENDING]: [RouteStopStatus.IN_ROUTE, RouteStopStatus.SKIPPED],
  [RouteStopStatus.IN_ROUTE]: [RouteStopStatus.PENDING, RouteStopStatus.SKIPPED],
  [RouteStopStatus.VISITED]: [],
  [RouteStopStatus.SKIPPED]: [],
};

export function canTransitionStop(from: RouteStopStatus, to: RouteStopStatus): boolean {
  return STOP_TRANSITIONS[from].includes(to);
}

/** «Sin gestionar»: ni visitada ni descartada. Es lo que se mueve, se quita y se salta. */
export function isOpenStop(status: RouteStopStatus): boolean {
  return status === RouteStopStatus.PENDING || status === RouteStopStatus.IN_ROUTE;
}

/** Cuánto puede medir el motivo escrito de un cierre, una cancelación o un pedido. */
export const ROUTE_REASON_MIN = 5;
export const ROUTE_REASON_MAX = 500;

/** El motivo vale si dice algo: sin espacios de más y con un mínimo, para que «.» no pase por motivo. */
export function isValidReason(reason: string | null | undefined): reason is string {
  const text = (reason ?? '').trim();
  return text.length >= ROUTE_REASON_MIN && text.length <= ROUTE_REASON_MAX;
}

/** Lo que una persona puede hacer con una ruta, ya resuelto por la API (`RouteItem.capabilities`). */
export interface RouteCapabilities {
  /** Quién armó la ruta, o su cobrador, o un administrador: modifica sin pedir permiso. */
  isOwner: boolean;
  start: boolean;
  complete: boolean;
  /** `false` con visitas registradas (se cierra) o si la ruta ya está cerrada. */
  cancel: boolean;
  /** Agregar, quitar y mover paradas directo. */
  edit: boolean;
  /** Sin ser dueño: puede pedir el cambio, con motivo. */
  requestChange: boolean;
  /** Registrar una visita desde el panel (quien la armó, su cobrador o quien asigna). */
  recordVisit: boolean;
  /** Por qué no se puede cancelar, si es por tener visitas: la pantalla ofrece «Completar» en su lugar. */
  cancelBlockedByVisits: boolean;
}
