import { UnprocessableEntityException } from '@nestjs/common';

/** Cómo se llama cada tope cuando hay que decírselo a una persona. */
const NOMBRE: Record<string, string> = {
  users: 'miembros activos',
  credits: 'créditos activos',
  clients: 'clientes',
};

/**
 * Se llegó al techo del plan.
 *
 * Un solo error para todos los topes, con el tipo adentro: la pantalla que quiera decir algo
 * distinto según cuál se llenó lo tiene en `details.kind`, y la que no, muestra el mensaje y ya.
 *
 * Reemplaza a `USER_SEAT_LIMIT`, que era el mismo error cuando el único tope eran los asientos.
 */
export const planLimitReached = (kind: string, used: number, max: number) =>
  new UnprocessableEntityException({
    code: 'PLAN_LIMIT_REACHED',
    message: `Tu plan permite ${max} ${NOMBRE[kind] ?? kind}. Ya tenés ${used}.`,
    details: { kind, used, max },
  });
