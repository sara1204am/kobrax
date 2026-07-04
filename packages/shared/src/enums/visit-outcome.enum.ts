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
  NOT_FOUND = 'NOT_FOUND', // domicilio no existe / dirección errónea
  RESCHEDULED = 'RESCHEDULED', // se reagenda la visita
}
