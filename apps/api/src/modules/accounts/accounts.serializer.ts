import type { Account } from '@prisma/client';

/**
 * Payload público del tenant. `memberCount` (miembros activos) va acá y no en
 * `/users` porque la pantalla de cuenta muestra "3 de 5 miembros" sin traer la lista.
 */
export function serializeAccount(a: Account, memberCount: number) {
  return {
    id: a.id,
    businessName: a.businessName,
    taxId: a.taxId,
    accountType: a.accountType,
    status: a.status,
    planCode: a.planCode,
    countryCode: a.countryCode,
    currencyCode: a.currencyCode,
    timezone: a.timezone,
    maxUsers: a.maxUsers,
    memberCount,
  };
}
