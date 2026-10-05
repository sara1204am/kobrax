import type { Account } from '@prisma/client';
import { arrearsMethodOf, effectiveLimits } from '@kobrax/shared';

/** Lo que llegue de settings es JSON de la base: cualquier cosa fuera de 0–2 cae al default 2. */
function currencyDecimalsOf(settings: unknown): number {
  const raw = (settings as { currencyDecimals?: unknown } | null)?.currencyDecimals;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 2 ? raw : 2;
}

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
    currencyDecimals: currencyDecimalsOf(a.settings),
    // D20: método de mora por defecto de los créditos nuevos (también vive en settings).
    arrearsMethod: arrearsMethodOf(a.settings),
    limits: effectiveLimits(a.planCode, a.limitsOverride),
    usage,
  };
}
