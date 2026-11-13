import { Permission } from '../enums/permission.enum.js';
import type { PermissionReserved, PermissionRisk } from '../types/role.types.js';

/**
 * Metadatos de cada permiso de la cuenta (F14 · F7): riesgo, si es reservado y de qué otros permisos depende.
 *
 * FUENTE ÚNICA. La siembra (`seed.ts`) y la migración `…f14_f7_permission_catalog_meta` los escriben en la tabla `permissions`; el editor de roles
 * los lee de ahí. Está tipado contra el enum: un permiso nuevo SIN metadatos no compila. Una prueba exige que la migración coincida con este archivo
 * y que ninguna plantilla de rol viole las dependencias (si lo hiciera, sus copias no se podrían guardar nunca).
 *
 * - `risk`: LOW lectura; MEDIUM escribe o ve datos de contacto; HIGH muestra datos en claro, borra, exporta, asigna o administra; CRITICAL cambia la
 *   propiedad o el modelo de acceso. Lo usa el editor para pedir confirmación.
 * - `reserved`: `ADMIN_CORE` = lo que el administrador de la cuenta no puede perder ni repartir (el editor no lo añade ni lo quita en ningún rol).
 * - `requires`: permisos que deben estar concedidos para que éste tenga sentido.
 */
export interface PermissionMeta {
  risk: PermissionRisk;
  reserved?: PermissionReserved;
  requires?: readonly Permission[];
}

const P = Permission;

export const PERMISSION_META: Record<Permission, PermissionMeta> = {
  [P.COLLECTION_READ]: { risk: 'LOW' },
  [P.COLLECTION_WRITE]: { risk: 'MEDIUM', requires: [P.COLLECTION_READ] },
  [P.COLLECTION_EXPORT]: { risk: 'MEDIUM', requires: [P.COLLECTION_READ] },

  [P.PAYMENT_READ]: { risk: 'LOW' },
  [P.PAYMENT_WRITE]: { risk: 'MEDIUM', requires: [P.PAYMENT_READ] },
  [P.PAYMENT_APPROVE]: { risk: 'HIGH', requires: [P.PAYMENT_READ] },

  [P.ROUTE_READ]: { risk: 'LOW' },
  [P.ROUTE_WRITE]: { risk: 'MEDIUM', requires: [P.ROUTE_READ] },
  [P.ROUTE_ASSIGN]: { risk: 'MEDIUM', requires: [P.ROUTE_READ] },
  [P.ROUTE_EXECUTE]: { risk: 'MEDIUM', requires: [P.ROUTE_READ] },

  [P.AGENDA_READ]: { risk: 'LOW' },
  [P.AGENDA_WRITE]: { risk: 'MEDIUM', requires: [P.AGENDA_READ] },
  [P.AGENDA_ASSIGN]: { risk: 'MEDIUM', requires: [P.AGENDA_READ] },

  [P.CATALOG_READ]: { risk: 'LOW' },
  [P.CATALOG_WRITE]: { risk: 'MEDIUM', requires: [P.CATALOG_READ] },

  [P.CLIENT_READ]: { risk: 'LOW' },
  [P.CLIENT_WRITE]: { risk: 'MEDIUM', requires: [P.CLIENT_READ] },
  [P.CLIENT_CREATE]: { risk: 'MEDIUM', requires: [P.CLIENT_READ] },
  [P.CLIENT_DELETE]: { risk: 'HIGH', requires: [P.CLIENT_READ] },
  [P.CLIENT_PII_READ]: { risk: 'HIGH', requires: [P.CLIENT_READ] },
  [P.CLIENT_CONTACT_READ]: { risk: 'MEDIUM', requires: [P.CLIENT_READ] },
  [P.CLIENT_IMPORT]: { risk: 'MEDIUM', requires: [P.CLIENT_READ] },
  [P.CLIENT_IMPORT_REPLACE]: { risk: 'CRITICAL', requires: [P.CLIENT_IMPORT] },

  [P.CREDIT_READ]: { risk: 'LOW' },
  [P.CREDIT_WRITE]: { risk: 'MEDIUM', requires: [P.CREDIT_READ] },
  [P.CREDIT_CREATE]: { risk: 'MEDIUM', requires: [P.CREDIT_READ] },
  [P.CREDIT_PII_READ]: { risk: 'HIGH', requires: [P.CREDIT_READ] },
  [P.ASSIGNMENT_WRITE]: { risk: 'HIGH', requires: [P.CREDIT_READ] },

  [P.REPORT_READ]: { risk: 'LOW' },
  [P.REPORT_EXPORT]: { risk: 'HIGH', requires: [P.REPORT_READ] },

  [P.ACCOUNT_READ]: { risk: 'LOW' },
  [P.ACCOUNT_WRITE]: { risk: 'CRITICAL', reserved: 'ADMIN_CORE', requires: [P.ACCOUNT_READ] },

  [P.OFFICE_READ]: { risk: 'LOW' },
  [P.OFFICE_WRITE]: { risk: 'HIGH', reserved: 'ADMIN_CORE', requires: [P.OFFICE_READ] },

  [P.USER_READ]: { risk: 'LOW' },
  [P.USER_INVITE]: { risk: 'HIGH', requires: [P.USER_READ] },
  [P.USER_WRITE]: { risk: 'CRITICAL', reserved: 'ADMIN_CORE', requires: [P.USER_READ] },
  [P.USER_SESSIONS_REVOKE]: { risk: 'HIGH', requires: [P.USER_READ] },

  [P.ROLE_READ]: { risk: 'LOW' },
  [P.ROLE_WRITE]: { risk: 'CRITICAL', reserved: 'ADMIN_CORE', requires: [P.ROLE_READ] },

  [P.SUPPORT_CONSENT]: { risk: 'HIGH' },
  [P.AUDIT_READ]: { risk: 'MEDIUM' },

  [P.DATA_SCOPE_ALL]: { risk: 'HIGH' },
  [P.DATA_SCOPE_SUBTREE]: { risk: 'MEDIUM' },
  [P.DATA_SCOPE_BRANCH]: { risk: 'MEDIUM' },
};

/** El SQL de `UPDATE` que deja la tabla `permissions` igual a `PERMISSION_META` (lo escribe la migración y lo verifica una prueba). */
export function permissionMetaSql(): string {
  return (Object.keys(PERMISSION_META) as Permission[])
    .sort()
    .map((code) => {
      const m = PERMISSION_META[code];
      const reserved = m.reserved ? `'${m.reserved}'::"PermissionReserved"` : 'NULL';
      const requires = `'${JSON.stringify([...(m.requires ?? [])].sort())}'::jsonb`;
      return `UPDATE "permissions" SET "risk" = '${m.risk}'::"PermissionRisk", "reserved" = ${reserved}, "requires" = ${requires} WHERE "code" = '${code}';`;
    })
    .join('\n');
}
