import { Permission, canTransitionRoute, routeIsOpen, type RouteCapabilities, type RouteStatus as SharedRouteStatus } from '@kobrax/shared';
import type { RouteStatus } from '@prisma/client';

/**
 * Quién puede qué sobre una ruta (F4/12 · decisión 1). Pura: recibe lo que el servicio ya sabe y devuelve la respuesta,
 * para poder probarla sin base.
 *
 * Hay DOS cosas distintas que no conviene mezclar:
 *  - **Correr** la ruta (iniciar, completar, cancelar, registrar visitas): es de quien la anda — su cobrador — y de
 *    quien la armó.
 *  - **Armarla** (agregar, quitar y mover paradas): manda quien la creó. Si la armó el manager, el cobrador que
 *    quiera cambiar una parada **la pide**, con motivo; y al revés.
 *
 * Una ruta anterior a F4/12 no tiene creador (`createdBy` null): ahí rige lo de siempre — quien administra rutas, y
 * el cobrador sobre la suya — para no dejar de pronto sin dueño a todo lo que ya existía.
 */
export interface RouteActor {
  userId: string | undefined;
  can: (permission: string) => boolean;
}

export interface RouteFacts {
  collectorId: string;
  createdBy: string | null;
  status: RouteStatus;
  /** Visitas ya registradas en la ruta: con alguna, no se cancela (se cierra). */
  hasVisits: boolean;
}

export interface RouteRoles {
  /** Quien administra rutas (asignar o escribir): supervisor, manager, administrador. */
  manager: boolean;
  /** Administrador de la empresa: es quien tiene a la vez asignar y ejecutar (ningún otro rol junta las dos). */
  admin: boolean;
  isCreator: boolean;
  isCollector: boolean;
  /** Anterior a F4/12. */
  legacy: boolean;
  /** Arma la ruta: agrega, quita y mueve paradas sin pedir permiso. */
  canManage: boolean;
  /** Anda la ruta: la inicia, la cierra y la cancela. */
  canRun: boolean;
}

export function routeRoles(actor: RouteActor, route: Pick<RouteFacts, 'collectorId' | 'createdBy'>): RouteRoles {
  const manager = actor.can(Permission.ROUTE_ASSIGN) || actor.can(Permission.ROUTE_WRITE);
  const admin = actor.can(Permission.ROUTE_ASSIGN) && actor.can(Permission.ROUTE_EXECUTE);
  const isCreator = !!actor.userId && route.createdBy === actor.userId;
  const isCollector = !!actor.userId && route.collectorId === actor.userId;
  const legacy = route.createdBy == null;
  return {
    manager,
    admin,
    isCreator,
    isCollector,
    legacy,
    canManage: isCreator || admin || (legacy && (manager || isCollector)),
    canRun: isCollector || isCreator || admin || (legacy && manager),
  };
}

/** Lo que la pantalla puede ofrecer. La API vuelve a validar cada acción: esto solo evita botones que fallarían. */
export function routeCapabilities(actor: RouteActor, route: RouteFacts): RouteCapabilities {
  const r = routeRoles(actor, route);
  const open = routeIsOpen(route.status as unknown as SharedRouteStatus);
  const status = route.status as unknown as SharedRouteStatus;
  const cancelAllowedByState = canTransitionRoute(status, 'CANCELLED' as SharedRouteStatus);
  return {
    isOwner: r.canManage,
    // Un manager que no armó la ruta puede iniciarla/completarla (con motivo); cancelar la pide.
    start: canTransitionRoute(status, 'IN_PROGRESS' as SharedRouteStatus) && (r.canRun || r.manager),
    complete: canTransitionRoute(status, 'COMPLETED' as SharedRouteStatus) && (r.canRun || r.manager),
    cancel: cancelAllowedByState && !route.hasVisits && r.canRun,
    cancelBlockedByVisits: cancelAllowedByState && route.hasVisits && (r.canRun || r.manager),
    edit: open && r.canManage,
    requestChange: open && !r.canManage && (r.manager || r.isCollector),
    recordVisit: route.status !== 'CANCELLED' && (r.canRun || r.manager || r.isCollector),
  };
}
