import type { Account } from '@prisma/client';
import { effectiveLimits } from '@kobrax/shared';

/**
 * Payload público del tenant.
 *
 * Los topes viajan **ya resueltos** —el plan con su excepción encima— y no como `planCode` +
 * excepción cruda: si cada pantalla los resolviera, la web, el móvil y la API tendrían tres
 * oportunidades de resolverlos distinto. `limitsOverride` no sale de la API: es información
 * interna de lo que se negoció con ese cliente.
 *
 * `usage` va acá y no en `/users` porque la pantalla de cuenta muestra «3 de 5 miembros» sin
 * traer la lista entera. Trae **sólo los topes que se cuentan hoy** — desde L2, los cinco:
 * fotos y gestiones son lo que va del mes del huso de la cuenta.
 */
export function serializeAccount(
  a: Account,
  usage: {
    users: number;
    credits: number;
    clients: number;
    photosPerMonth: number;
    actionsPerMonth: number;
  },
) {
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
    limits: effectiveLimits(a.planCode, a.limitsOverride),
    usage,
  };
}
