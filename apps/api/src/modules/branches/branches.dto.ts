/**
 * Contrato de RESPUESTA de oficinas y tipos (F13 · P2) para quien consume la API (web P3, móvil después). Las respuestas viajan
 * dentro de `{ data, meta, error }`; acá está sólo el `data`. Los CUERPOS de entrada están en `dto/branch.dto.ts`:
 *
 *   POST   /branches                       {name, parentId?, typeId?, code?, city?, address?, managerUserId?}  → BranchView (201)
 *   PATCH  /branches/:id                   {name?, code?|null, city?|null, address?|null, managerUserId?|null, typeId?, active?} → BranchView
 *   POST   /branches/:id/move              {parentId}                                                          → BranchView (200)
 *   POST   /branches/:id/deactivate|restore (sin cuerpo)                                                       → BranchView (200)
 *   DELETE /branches/:id                                                                                       → 204
 *   POST   /branches/:id/members           {userId} | {userIds[]} + {mode?: 'MOVE'|'ADD'}                       → BranchView (200)
 *   DELETE /branches/:id/members/:userId                                                                       → BranchView (200)
 *   GET    /branches                                                                                           → BranchView[]   (activas E inactivas; no las borradas)
 *   GET    /branches/:id                                                                                       → BranchDetailView
 *   GET    /branch-types  (activos E inactivos) · POST /branch-types {code,name,sortOrder?} · PATCH /branch-types/:id {name?,sortOrder?,isActive?} → BranchTypeView
 *   POST   /credits/reassign-office        {creditIds[] | fromBranchId, toBranchId}                            → ReassignOfficeResult (200)
 */

/** Una oficina del árbol. `GET /branches` devuelve la lista plana: la web arma el árbol con `parentId` o `path`. */
export interface BranchView {
  id: string;
  name: string;
  /** Único entre las oficinas vivas de la cuenta; `null` si no tiene. */
  code: string | null;
  city: string | null;
  address: string | null;
  managerUserId: string | null;
  managerName: string | null;
  /** `false` = desactivada (sigue en la lista; se reactiva con `restore`). */
  active: boolean;
  /** `null` sólo en la raíz. */
  parentId: string | null;
  typeId: string;
  typeCode: string;
  typeName: string;
  /** Ruta materializada de ids: `/raíz/regional/agencia/`. El subárbol de un nodo es todo lo que empieza con su `path`. */
  path: string;
  /** La raíz es 0. */
  depth: number;
  isRoot: boolean;
  /** Ruta legible: «Banco Sur › Chuquisaca › Mesa Verde». */
  fullName: string;
  /** Personas con asignación vigente a ESTA oficina (no a su subárbol). */
  members: number;
  /** Créditos vivos de ESTA oficina. */
  credits: number;
  /** Oficinas hijas vivas (directas). */
  children: number;
}

export interface BranchMemberView {
  userId: string;
  name: string | null;
  roleName: string | null;
  isPrimary: boolean;
  /** ISO 8601. */
  since: string;
}

export interface BranchHistoryView {
  id: string;
  /** CREATE · UPDATE · MOVE · DEACTIVATE · RESTORE · DELETE */
  action: string;
  /** ISO 8601. */
  at: string;
  actorId: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
}

/**
 * La cartera de una oficina **incluidas sus hijas** (una regional no tiene créditos propios: los tienen sus agencias). Sólo
 * créditos vivos (activos; en fuente externa también los vencidos), sin castigados ni borrados.
 *
 * «En mora» es el crédito con días de atraso, y lo que se suma es su **saldo adeudado** (`outstanding_balance`), no la cuota.
 * Un total por moneda: sumar bolivianos con dólares no significa nada.
 */
export interface BranchPortfolioView {
  credits: number;
  arrearsCredits: number;
  byCurrency: { currency: string; credits: number; arrearsCredits: number; balance: number; arrearsBalance: number }[];
}

/** `GET /branches/:id`: la oficina + conteos (`stats`, igual a los campos planos) + personas + historial (hasta 50, el más nuevo primero). */
export interface BranchDetailView extends BranchView {
  stats: { members: number; credits: number; children: number };
  /** La cartera viva de la oficina y de todo lo que cuelga de ella. */
  portfolio: BranchPortfolioView;
  membersList: BranchMemberView[];
  history: BranchHistoryView[];
}

export interface BranchTypeView {
  id: string;
  /** Mayúsculas, único por cuenta: CENTRAL · REGIONAL · AGENCIA… */
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ReassignOfficeResult {
  moved: number;
  /** Ya estaban en la oficina destino. */
  unchanged: number;
  toBranchId: string;
}
