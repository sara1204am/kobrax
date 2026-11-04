import { Prisma } from '@prisma/client';
import { Permission } from '@kobrax/shared';

/**
 * Alcance por oficina (F13 · P2). Lógica PURA: decide el tipo de alcance por **capacidad** y arma los fragmentos SQL
 * que lo aplican. Es el único lugar donde se escribe «qué oficinas veo»; mora, agenda, reparto, rutas y analítica
 * lo consumen y ninguno vuelve a comparar `branch_id` con una oficina suelta.
 *
 *  · `ALL`     — `data:scope:all`: toda la cuenta.
 *  · `SUBTREE` — `data:scope:subtree` (gerente regional): lo suyo, o lo que está en el subárbol de sus oficinas asignadas
 *                (haya o no responsable), o TODO si está asignado a la raíz (créditos sin oficina incluidos).
 *  · `BRANCH`  — `data:scope:branch` (supervisor): lo suyo, o lo que tiene responsable y está en el subárbol de sus
 *                oficinas asignadas. Con una agencia (hoja) es EXACTAMENTE la regla de antes (D8).
 *  · `OWN`     — ninguna capacidad: sólo lo suyo (falla cerrado).
 * Sin asignaciones, SUBTREE y BRANCH ven sólo lo suyo (A-4).
 */
export type OfficeScopeKind = 'ALL' | 'SUBTREE' | 'BRANCH' | 'OWN';

/** El alcance de quien consulta, por capacidad (no por nombre de rol). Gana el más amplio. */
export function officeScopeKindOf(can: (permission: string) => boolean): OfficeScopeKind {
  if (can(Permission.DATA_SCOPE_ALL)) return 'ALL';
  if (can(Permission.DATA_SCOPE_SUBTREE)) return 'SUBTREE';
  if (can(Permission.DATA_SCOPE_BRANCH)) return 'BRANCH';
  return 'OWN';
}

/** Las columnas del registro que se está filtrando (alias de la consulta que llama). */
export interface OfficeColumns {
  /** `cr.account_id` */
  account: Prisma.Sql;
  /** `cr.branch_id` */
  branch: Prisma.Sql;
}

/** Columnas del crédito (`cr`). Son literales de código, nunca texto del usuario. */
export const CREDIT_OFFICE_COLUMNS: OfficeColumns = { account: Prisma.raw('cr.account_id'), branch: Prisma.raw('cr.branch_id') };

/**
 * «La oficina del registro está en el subárbol de alguna de MIS asignaciones vigentes».
 * Vigente = no revocada y la persona sigue activa en la cuenta. `LIKE ruta || '%'` usa el índice `text_pattern_ops`.
 */
export function officeInMySubtreeSql(me: string, cols: OfficeColumns = CREDIT_OFFICE_COLUMNS): Prisma.Sql {
  return Prisma.sql`EXISTS (
        SELECT 1 FROM user_branch_assignments ab
        JOIN user_accounts uaa ON uaa.user_id = ab.user_id AND uaa.account_id = ab.account_id AND uaa.is_active = true
        JOIN branches mine ON mine.id = ab.branch_id AND mine.account_id = ab.account_id
        JOIN branches ob ON ob.id = ${cols.branch} AND ob.account_id = ab.account_id
        WHERE ab.user_id = ${me} AND ab.account_id = ${cols.account} AND ab.revoked_at IS NULL
          AND ob.path LIKE mine.path || '%')`;
}

/** «Estoy asignado a la RAÍZ de la cuenta»: cubre todo el árbol y también los registros sin oficina. */
export function assignedToRootSql(me: string, cols: OfficeColumns = CREDIT_OFFICE_COLUMNS): Prisma.Sql {
  return Prisma.sql`EXISTS (
        SELECT 1 FROM user_branch_assignments ar
        JOIN user_accounts uar ON uar.user_id = ar.user_id AND uar.account_id = ar.account_id AND uar.is_active = true
        JOIN branches rb ON rb.id = ar.branch_id AND rb.account_id = ar.account_id AND rb.is_root = true
        WHERE ar.user_id = ${me} AND ar.account_id = ${cols.account} AND ar.revoked_at IS NULL)`;
}

/**
 * La condición de oficina de un alcance `SUBTREE`/`BRANCH` (lo «mío» lo agrega quien llama).
 *  · `BRANCH`: responsable asignado Y oficina no nula Y en mi subárbol (regla de visibilidad de siempre).
 *  · `SUBTREE`: oficina en mi subárbol (sin exigir responsable) O estoy en la raíz.
 */
export function officeVisibilitySql(kind: 'SUBTREE' | 'BRANCH', me: string, cols: OfficeColumns = CREDIT_OFFICE_COLUMNS): Prisma.Sql {
  if (kind === 'BRANCH') {
    return Prisma.sql`(cr.assigned_manager_id IS NOT NULL AND ${cols.branch} IS NOT NULL AND ${officeInMySubtreeSql(me, cols)})`;
  }
  return Prisma.sql`(${officeInMySubtreeSql(me, cols)} OR ${assignedToRootSql(me, cols)})`;
}

/** Cómo se reparte (alcance de asignación): todo, o sólo estas rutas. Sin rutas no se reparte nada (falla cerrado). */
export interface AssignScope {
  kind: 'ALL' | 'OFFICES';
  paths: string[];
}
