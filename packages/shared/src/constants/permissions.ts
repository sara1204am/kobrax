import { Permission } from '../enums/permission.enum.js';
import { RoleType } from '../enums/role.enum.js';

/**
 * Permisos base por rol (role_permission). Los overrides individuales
 * (user_permission_override) se aplican encima de este mapa en runtime.
 *
 * **Fuente única: este mapa.** `packages/database/prisma/seed.ts` lo consume para poblar
 * `role_permissions`, que es de donde salen los `permissions` del JWT. Hasta 2026-08-06 el seed
 * tenía su propia lista y las dos se fueron separando en silencio: la de acá quedó sin los permisos
 * de agenda, catálogos, `client:import` y `credit:write`. Nadie lo notó porque el guard lee la DB —
 * pero `realtime.helpers.ts` sí lee este mapa, y decidía destinatarios de notificaciones con datos
 * viejos. Agregar un permiso a un rol se hace **acá**, y el seed sigue.
 */
export const ROLE_PERMISSIONS: Record<RoleType, Permission[]> = {
  [RoleType.SUPER_ADMIN]: Object.values(Permission),
  [RoleType.ACCOUNT_ADMIN]: Object.values(Permission).filter((p) => p !== Permission.AUDIT_READ),
  [RoleType.MANAGER]: [
    Permission.CASE_READ,
    Permission.CASE_WRITE,
    Permission.CASE_ASSIGN,
    Permission.CASE_CLOSE,
    Permission.PAYMENT_READ,
    Permission.PAYMENT_APPROVE,
    Permission.ROUTE_READ,
    Permission.ROUTE_WRITE,
    Permission.ROUTE_ASSIGN,
    Permission.AGENDA_READ,
    Permission.AGENDA_WRITE,
    Permission.AGENDA_ASSIGN,
    Permission.CATALOG_READ,
    Permission.CATALOG_WRITE,
    Permission.CLIENT_READ,
    Permission.CLIENT_WRITE,
    Permission.CLIENT_PII_READ,
    Permission.CLIENT_IMPORT,
    Permission.CREDIT_READ,
    Permission.CREDIT_WRITE,
    Permission.CREDIT_PII_READ,
    Permission.REPORT_READ,
    Permission.REPORT_EXPORT,
    Permission.ACCOUNT_READ,
    Permission.USER_READ,
  ],
  [RoleType.SUPERVISOR]: [
    Permission.CASE_READ,
    Permission.CASE_WRITE,
    Permission.CASE_ASSIGN,
    Permission.PAYMENT_READ,
    Permission.ROUTE_READ,
    Permission.ROUTE_WRITE,
    Permission.ROUTE_ASSIGN,
    Permission.AGENDA_READ,
    Permission.AGENDA_WRITE,
    Permission.AGENDA_ASSIGN,
    Permission.CATALOG_READ,
    Permission.CLIENT_READ,
    Permission.CREDIT_READ,
    Permission.REPORT_READ,
  ],
  [RoleType.COLLECTOR]: [
    Permission.CASE_READ,
    Permission.CASE_WRITE,
    Permission.PAYMENT_READ,
    Permission.PAYMENT_WRITE,
    Permission.ROUTE_READ,
    Permission.ROUTE_EXECUTE,
    // Su agenda del día es el centro de su trabajo: sin esto el módulo entero es 403 para él.
    Permission.AGENDA_READ,
    Permission.AGENDA_WRITE,
    // Medios de pago y bancos: los lee para registrar un pago, no los administra (CATALOG_WRITE no).
    Permission.CATALOG_READ,
    Permission.CLIENT_READ,
    // El cobrador da de alta clientes en campo y corrige lo que encuentra mal (una dirección sin
    // punto, un teléfono viejo). Sin esto, el formulario de edición se ve pero no guarda.
    // Toda mutación queda auditada; los permisos finos son F3/P10.
    Permission.CLIENT_WRITE,
    // La misma alta, pero desde archivo — el módulo Import del móvil, donde COLLECTOR es el único
    // rol que entra. Sin esto el módulo es 403 para su propio dueño (el cobrador independiente).
    Permission.CLIENT_IMPORT,
    Permission.CREDIT_READ,
    // Da de alta el préstamo junto con el cliente (Cartera S2), no sólo lo consulta.
    Permission.CREDIT_WRITE,
  ],
  [RoleType.AUDITOR]: [
    Permission.CASE_READ,
    Permission.PAYMENT_READ,
    Permission.ROUTE_READ,
    Permission.CLIENT_READ,
    Permission.CLIENT_PII_READ,
    Permission.CREDIT_READ,
    Permission.CREDIT_PII_READ,
    Permission.REPORT_READ,
    Permission.REPORT_EXPORT,
    Permission.AUDIT_READ,
  ],
  [RoleType.VIEWER]: [
    Permission.CASE_READ,
    Permission.PAYMENT_READ,
    Permission.ROUTE_READ,
    Permission.CLIENT_READ,
    Permission.REPORT_READ,
  ],
};
