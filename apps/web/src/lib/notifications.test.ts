import { describe, expect, it } from 'vitest';
import { NotificationType } from '@kobrax/shared';
import { notificationHref } from './notifications';

describe('notificationHref', () => {
  it('un aviso de una gestión lleva a esa gestión, aunque también tenga crédito', () => {
    expect(notificationHref({ type: NotificationType.AGENDA_ASSIGNED, agendaItemId: 'g1', creditId: 'c1' })).toBe('/agenda/g1');
  });
  it('el resumen de vencidas lleva a la agenda', () => {
    expect(notificationHref({ type: NotificationType.AGENDA_OVERDUE, agendaItemId: null, creditId: null })).toBe('/agenda');
  });
  it('un pago o una cuota llevan a la ficha del crédito', () => {
    expect(notificationHref({ type: NotificationType.PAYMENT_REGISTERED, agendaItemId: null, creditId: 'c1' })).toBe('/mora/c1');
  });
  it('un aviso del sistema no lleva a ningún lado', () => {
    expect(notificationHref({ type: NotificationType.SYSTEM, agendaItemId: null, creditId: null })).toBeUndefined();
  });
  it('una gestión eliminada (sin enlace) cae al crédito: nunca a una gestión que ya no existe', () => {
    expect(notificationHref({ type: NotificationType.AGENDA_CHANGED, agendaItemId: null, creditId: 'c1' })).toBe('/mora/c1');
  });
});
