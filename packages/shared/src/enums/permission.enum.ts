/** Ámbito sobre el que aplica un permiso. */
export enum PermissionScope {
  GLOBAL = 'global', // todos los tenants (solo SUPER_ADMIN)
  ACCOUNT = 'account', // todo el tenant
  BRANCH = 'branch', // su sucursal
  OWN = 'own', // solo sus propios recursos
}

/**
 * Permisos granulares: nomenclatura `{recurso}:{acción}`.
 * Es la fuente de verdad para guards (API) y para el control de UI (web/mobile).
 */
export enum Permission {
  CASE_READ = 'case:read',
  CASE_WRITE = 'case:write',
  CASE_ASSIGN = 'case:assign',
  CASE_CLOSE = 'case:close',
  /** Descargar la lista de Mora (CSV/PDF) con el filtro y el alcance de quien la baja. No es `report:export`. */
  CASE_EXPORT = 'case:export',

  /**
   * F4/08 · D5: los `case:*` renombrados. Coexisten con `CASE_*` hasta la fase 6 (las sesiones abiertas
   * llevan los nombres viejos hasta renovar el token); el código nuevo exige estos.
   */
  COLLECTION_READ = 'collection:read',
  /** Gestiones, agenda y notas del crédito. */
  COLLECTION_WRITE = 'collection:write',
  /** Descargar la lista de Mora (CSV/PDF). */
  COLLECTION_EXPORT = 'collection:export',

  PAYMENT_READ = 'payment:read',
  PAYMENT_WRITE = 'payment:write',
  PAYMENT_APPROVE = 'payment:approve',

  ROUTE_READ = 'route:read',
  ROUTE_WRITE = 'route:write',
  ROUTE_ASSIGN = 'route:assign',
  ROUTE_EXECUTE = 'route:execute',

  AGENDA_READ = 'agenda:read',
  AGENDA_WRITE = 'agenda:write',
  AGENDA_ASSIGN = 'agenda:assign', // ver/gestionar agendados de otros cobradores (supervisión)

  CATALOG_READ = 'catalog:read',
  CATALOG_WRITE = 'catalog:write',

  CLIENT_READ = 'client:read',
  CLIENT_WRITE = 'client:write',
  CLIENT_PII_READ = 'client:pii:read', // revelar PII en claro (documento/teléfono/dirección)
  CLIENT_IMPORT = 'client:import', // importación masiva (RECONCILE / UPSERT_ONLY)
  CLIENT_IMPORT_REPLACE = 'client:import:replace', // modo destructivo REPLACE

  CREDIT_READ = 'credit:read',
  CREDIT_WRITE = 'credit:write',
  CREDIT_PII_READ = 'credit:pii:read',

  REPORT_READ = 'report:read',
  REPORT_EXPORT = 'report:export',

  // Datos del propio tenant (razón social, país, moneda, zona horaria).
  // NO cubren plan ni límite de usuarios: eso no se toca desde el producto.
  ACCOUNT_READ = 'account:read',
  ACCOUNT_WRITE = 'account:write',

  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  USER_INVITE = 'user:invite',

  ROLE_READ = 'role:read',
  ROLE_WRITE = 'role:write',

  AUDIT_READ = 'audit:read',

  /**
   * Asignar un crédito a alguien: permanente o temporal (cobertura).
   *
   * Es lo que impide que un cobrador se otorgue acceso a sí mismo — no lo hace un constraint de la
   * base, a propósito: un supervisor o admin **sí** puede tomarse un crédito para cubrir a alguien
   * de baja, y una regla dura de «otorgante ≠ destinatario» bloquearía ese caso legítimo.
   *
   * Quien no tiene este permiso no ELIGE a nadie: no puede poner ni cambiar el responsable de un
   * crédito, tampoco el suyo. Lo único que recibe sin elegir es lo que el sistema deriva como suyo
   * —los nuevos de la cartera que él mismo importa, el préstamo que él mismo da de alta—, nunca un
   * crédito que ya existe. Se revisa en `AssignmentService`, la única vía que escribe el responsable.
   */
  ASSIGNMENT_WRITE = 'assignment:write',

  /**
   * Ve los datos de TODA la empresa, no sólo lo que tiene asignado.
   *
   * No es un permiso más: es el que decide el `app.current_scope` con el que corre cada
   * transacción, y por lo tanto qué filas entrega PostgreSQL (ver `prisma/rls/002_scope.sql`).
   * Quien no lo tiene —hoy sólo el cobrador— recibe únicamente sus filas asignadas, y eso lo
   * impone la base: no depende de que la consulta se acuerde de filtrar.
   */
  DATA_SCOPE_ALL = 'data:scope:all',

  /**
   * F4/08 · D8: ve **todo lo de su agencia** (créditos cuya sucursal es la suya) más lo que tiene a su cargo.
   * Es el alcance del supervisor. Si además tiene `DATA_SCOPE_ALL`, manda el total.
   * Hoy ninguna policy de RLS lo lee: lo aplica `moraAccessConditions` (Mora y Agenda).
   */
  DATA_SCOPE_BRANCH = 'data:scope:branch',
}
