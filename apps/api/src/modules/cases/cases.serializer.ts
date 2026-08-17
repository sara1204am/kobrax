import type { CaseActivity, CollectionCase } from '@prisma/client';
import { arrearsSourceOf, creditView, readCreditMetadata } from '@kobrax/shared';
import { clientDisplayName } from '../clients/clients.serializer';

const TERMINAL = ['CLOSED', 'WRITTEN_OFF'];

/** Datos mínimos del deudor para pintar la tarjeta de caso (nombre; NO PII cifrada). */
type CaseClient = { firstName: string | null; lastName: string | null; businessName: string | null };
/**
 * Datos financieros del crédito para la tarjeta de cartera (spec §5.3: "Cuota Bs 300 · vence 15 jul").
 * `metadata`/`installments` son opcionales: solo vienen cuando el query los incluye.
 */
type CaseCredit = {
  outstandingBalance: unknown;
  currency: string;
  daysPastDue: number;
  code?: string | null;
  metadata?: unknown;
  installments?: { dueDate: Date; amount: unknown; status: string }[];
};

export function serializeActivity(a: CaseActivity) {
  return {
    id: a.id,
    type: a.type,
    result: a.result ?? undefined,
    notes: a.notes ?? undefined,
    userId: a.userId ?? undefined,
    createdAt: a.createdAt,
  };
}

type CaseWithActivities = CollectionCase & {
  activities?: CaseActivity[];
  client?: CaseClient | null;
  credit?: CaseCredit | null;
};

/** Un punto dibujable del cliente. `ownerName` presente = es de un garante/familiar, no del cliente. */
export type PortfolioLocation = {
  id: string;
  locationType: string;
  latitude: number;
  longitude: number;
  /** En claro: el listado de cartera ya audita el revelado (`case_portfolio/PII_REVEAL`). */
  address?: string;
  ownerName?: string;
  ownerRelation?: string;
};

/** Campos de la lista de cartera (§5.3), resueltos por el servicio solo con `view=portfolio`. */
export type PortfolioExtra = {
  /** Zona de la ubicación primaria del cliente. */
  zone?: string;
  /**
   * **Todas** las ubicaciones dibujables del cliente: la casa, el negocio, y también las de sus
   * garantes y familiares (el mapa de Rutas pinta un pin por cada una). Sólo las que tienen
   * coordenadas — una dirección sin punto existe, pero no se puede dibujar. Vacío = el cliente no
   * aparece en el mapa y sale en el aviso aparte.
   */
  locations?: PortfolioLocation[];
  /** Documento ENMASCARADO (12345***) — para el buscador local; nunca en claro, sin `PII_REVEAL`. */
  documentMasked?: string;
  /** Hay una promesa de pago vigente en agenda → badge PROMESA (§5.3). */
  hasActivePromise?: boolean;
};

export function serializeCase(c: CaseWithActivities, now: Date = new Date(), portfolio?: PortfolioExtra) {
  const isOverdue = !!c.slaDueAt && !TERMINAL.includes(c.status) && c.slaDueAt.getTime() < now.getTime();
  // Cuota y próxima fecha: derivadas del cronograma si existe, leídas del metadata si no.
  // Misma función que usa el móvil → la tarjeta dice lo mismo en los dos lados.
  const view = c.credit
    ? creditView({
        metadata: c.credit.metadata,
        installments: c.credit.installments?.map((i) => ({ ...i, amount: Number(i.amount) })),
      })
    : undefined;
  return {
    id: c.id,
    creditId: c.creditId,
    clientId: c.clientId,
    branchId: c.branchId ?? undefined,
    assigneeId: c.assigneeId ?? undefined,
    status: c.status,
    priority: c.priority,
    /*
     * 🔴 **Que la prioridad está fijada a mano tiene que verse.** Si no, un préstamo de 200 días en
     * prioridad baja es inexplicable desde la pantalla: parece que el cálculo está roto, cuando lo
     * que pasa es que alguien la bajó a propósito. Y sin verlo, tampoco hay cómo soltarla.
     */
    priorityPinned: c.priorityPinnedAt !== null,
    slaDueAt: c.slaDueAt ?? undefined,
    isOverdue, // derivado (el catálogo "overdue" del doc se modela vía SLA)
    // Enriquecido cuando el query incluye client/credit (listado de agenda); ausente en mutaciones.
    clientName: c.client ? clientDisplayName(c.client) : undefined,
    amount: c.credit ? Number(c.credit.outstandingBalance) : undefined,
    currency: c.credit?.currency,
    daysPastDue: c.credit?.daysPastDue, // mora calculada por el server (no por el reloj del móvil)
    creditCode: c.credit?.code ?? undefined,
    /*
     * 🔴 **De dónde sale ese número de días.** No es un adorno: dice cuánto confiar en él. La
     * calculada la mantiene el trabajo diario todas las noches; la del archivo vale hasta la próxima
     * importación; la marcada a mano la puso una persona y nadie la revisa. Sin esto, tres números
     * que significan cosas distintas se leen como si fueran el mismo.
     *
     * Se **deriva** de la metadata (no es columna), así que no puede quedar desincronizado.
     */
    arrearsSource: c.credit ? arrearsSourceOf(readCreditMetadata(c.credit.metadata)) : undefined,
    installmentAmount: view?.installmentAmount,
    nextDueDate: view?.nextDueDate,
    frequency: view?.frequency,
    origin: view?.origin, // el móvil pinta el candado con esto (§4.3)
    locked: view?.locked,
    // Cartera (§5.3): solo presentes con `view=portfolio`; ausentes en agenda/mutaciones.
    zone: portfolio?.zone,
    locations: portfolio?.locations,
    documentMasked: portfolio?.documentMasked,
    hasActivePromise: portfolio?.hasActivePromise,
    lastActionAt: c.lastActionAt ?? undefined,
    closedAt: c.closedAt ?? undefined,
    closedReason: c.closedReason ?? undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    activities: c.activities?.map(serializeActivity),
  };
}
