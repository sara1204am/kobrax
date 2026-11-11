/**
 * Qué oficinas se ofrecen al dar de alta un cliente y si hace falta elegir (F14 · F8, D-7 / F2).
 *
 * La regla del servidor (`client.create`): el cliente se registra en UNA oficina. Con una sola oficina posible el servidor la resuelve solo y la app
 * **no muestra nada** (RULES C2: sin jerarquía no hay selector). Con varias hay que elegir; la central no registra clientes.
 */
export interface OfficeOption {
  id: string;
  name: string;
  isRoot: boolean;
}

export interface OfficeChoice {
  options: OfficeOption[];
  /** Hay más de una opción: la persona tiene que elegir antes de guardar. */
  needsChoice: boolean;
}

/**
 * `own`: las oficinas de su membresía (`/auth/me`). `visible`: las que ve en la cuenta (`GET /branches`, solo con `office:read`); si vino, manda
 * porque es lo que el servidor le deja elegir. La central se descarta mientras haya otras (ahí no se registran clientes).
 */
export function officeChoices(opts: { own?: readonly OfficeOption[] | null; visible?: readonly OfficeOption[] | null }): OfficeChoice {
  const pool = (opts.visible && opts.visible.length > 0 ? opts.visible : opts.own) ?? [];
  const nonRoot = pool.filter((o) => !o.isRoot);
  const options = [...(nonRoot.length > 0 ? nonRoot : pool)].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { options, needsChoice: options.length > 1 };
}

/** «Agencia Sur, Agencia Norte» o el texto de «sin oficina», para Más › Cuenta. */
export function officesLine(offices: readonly OfficeOption[] | null | undefined): string {
  return offices && offices.length > 0 ? offices.map((o) => o.name).join(', ') : 'Sin oficina asignada';
}
