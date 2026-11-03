/**
 * Datos de facturación de la cuenta (Refactor de Cuenta · F7): a nombre de quién se factura y adónde se manda.
 *
 * Viven en `accounts.configuration.billing`. Sin cobro dentro del producto (el plan lo gestiona Kobrax), son sólo los
 * datos fiscales que Kobrax usa para emitir la factura. `null` = no cargado. Son obligatorios `BILLING_REQUIRED` (la dirección es opcional); el servidor avisa los que faltan en `billingMissing`.
 */
export interface AccountBilling {
  /** Razón social con la que se factura (puede diferir del nombre comercial). */
  legalName: string | null;
  /** NIT / RUC / RFC según el país. */
  taxId: string | null;
  address: string | null;
  /** Correo al que se manda la factura. */
  email: string | null;
}

export const BILLING_FIELDS = ['legalName', 'taxId', 'address', 'email'] as const;

/** Lo que hace falta para poder facturar: todo menos la dirección. */
export const BILLING_REQUIRED = ['legalName', 'taxId', 'email'] as const satisfies readonly (keyof AccountBilling)[];

/** Largo máximo de cada dato: lo valida la API y lo respeta el formulario (una sola fuente). */
export const BILLING_MAX: Record<keyof AccountBilling, number> = { legalName: 160, taxId: 40, address: 240, email: 160 };

export const EMPTY_BILLING: AccountBilling = { legalName: null, taxId: null, address: null, email: null };

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Los datos de facturación de una cuenta a partir de su `configuration`; lo que venga mal formado cuenta como no cargado. */
export function billingOf(configuration: unknown): AccountBilling {
  const raw = (configuration as { billing?: Record<string, unknown> } | null)?.billing;
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BILLING };
  return {
    legalName: clean(raw.legalName),
    taxId: clean(raw.taxId),
    address: clean(raw.address),
    email: clean(raw.email),
  };
}

/** Lo guardado con un parche encima. `null` quita el dato; ausente no lo toca. */
export function mergeBilling(current: AccountBilling, patch: Partial<Record<keyof AccountBilling, string | null>>): AccountBilling {
  const out = { ...current };
  for (const key of BILLING_FIELDS) {
    if (patch[key] !== undefined) out[key] = clean(patch[key]);
  }
  return out;
}

/** Los datos obligatorios que todavía no están cargados; vacío = se puede facturar. */
export function billingMissingOf(billing: AccountBilling): (typeof BILLING_REQUIRED)[number][] {
  return BILLING_REQUIRED.filter((key) => billing[key] === null);
}
