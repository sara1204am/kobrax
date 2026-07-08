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

  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  USER_INVITE = 'user:invite',

  ROLE_READ = 'role:read',
  ROLE_WRITE = 'role:write',

  AUDIT_READ = 'audit:read',
}
