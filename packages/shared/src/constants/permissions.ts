import { Permission } from '../enums/permission.enum.js';
import { RoleType } from '../enums/role.enum.js';

/**
 * Permisos base por rol (role_permission). Los overrides individuales
 * (user_permission_override) se aplican encima de este mapa en runtime.
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
    Permission.CLIENT_READ,
    Permission.CLIENT_WRITE,
    Permission.CLIENT_PII_READ,
    Permission.CLIENT_IMPORT,
    Permission.CREDIT_READ,
    Permission.CREDIT_WRITE,
    Permission.CREDIT_PII_READ,
    Permission.REPORT_READ,
    Permission.REPORT_EXPORT,
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
    Permission.CLIENT_READ,
    Permission.CREDIT_READ,
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
