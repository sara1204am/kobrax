/**
 * Roles predefinidos del sistema (jerarquía RBAC).
 * El catálogo de negocio (Owner, Gerente Regional/Agencia, Jefe Cobranza,
 * Oficial Crédito...) se mapea sobre estos roles técnicos + scopes de permiso.
 */
export enum RoleType {
  SUPER_ADMIN = 'SUPER_ADMIN', // acceso total al sistema (solo Kobrax)
  ACCOUNT_ADMIN = 'ACCOUNT_ADMIN', // Owner / Admin del tenant
  MANAGER = 'MANAGER', // Gerente regional / de agencia
  SUPERVISOR = 'SUPERVISOR', // supervisa cobradores
  COLLECTOR = 'COLLECTOR', // cobrador en campo
  AUDITOR = 'AUDITOR', // solo lectura + reportes
  VIEWER = 'VIEWER', // consulta básica
}
