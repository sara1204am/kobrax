/**
 * Resultado de una visita en campo (CU-04). Reemplaza los strings libres
 * del documento (NO_CONTACTO, COMPROMISO, RECHAZO, VISITADO...).
 */
export enum VisitOutcome {
  NO_CONTACT = 'NO_CONTACT', // cliente no encontrado / sin contacto
  CONTACTED = 'CONTACTED', // se contactó, sin compromiso
  PROMISE_TO_PAY = 'PROMISE_TO_PAY', // compromiso de pago
  PARTIAL_PAYMENT = 'PARTIAL_PAYMENT', // pagó una parte en el acto
  PAID = 'PAID', // pagó el total en el acto
  REFUSAL = 'REFUSAL', // se niega a pagar
  NOT_FOUND = 'NOT_FOUND', // fue al domicilio y no lo encontró
  RESCHEDULED = 'RESCHEDULED', // se reagenda la visita
  WRONG_ADDRESS = 'WRONG_ADDRESS', // la dirección no corresponde (RT-6) — el domicilio hay que corregirlo
  SPECIAL = 'SPECIAL', // gestión especial (fallecimiento, enfermedad…); la categoría va en `details`
}
