/** Tono del badge de cada estado del crédito. Lo comparten la lista del cliente y la ficha. */
export const CREDIT_STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'neutral',
  PAID: 'success',
  DEFAULTED: 'danger',
  WRITTEN_OFF: 'danger',
  RESTRUCTURED: 'warning',
  CANCELLED: 'neutral',
};

/**
 * Cuánto se cobró **del total por cobrar** (D15) — la regla vive en `paymentProgress` de shared.
 *
 * 🔴 **No se dibuja si el número no significa nada.** Un importado sin cuota no tiene total conocido:
 * medirlo contra el capital, con un saldo que ya incluye intereses, daba 0 % aunque hubiera pagado.
 * Sin total no hay barra: una barra vacía dice «no pagó nada», que es una acusación, no un dato faltante.
 */
export function CreditProgress({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return null;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] text-k-text-2">{label}</span>
        <span className="text-[12px] font-medium tabular-nums text-k-text">{pct}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-k-light-bg"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-k-periwinkle" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
