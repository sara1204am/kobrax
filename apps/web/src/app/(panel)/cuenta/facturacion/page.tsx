import type { PlanHistoryEntry } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAccount } from '../get-account';
import { BillingForm } from './billing-form';
import { PlanHistory } from './plan-history';

/**
 * Facturación: los datos fiscales (editables) y el historial de plan (sólo lectura). No hay cobro en el producto: el
 * plan lo gestiona Kobrax.
 */
export default async function CuentaFacturacionPage() {
  const { body } = await getAccount();
  if (!body.data) return null;
  const history = await apiCall<PlanHistoryEntry[]>('/accounts/me/plan-history', { method: 'GET', auth: true });

  return (
    <>
      <BillingForm account={body.data} />
      <PlanHistory entries={history.body.data ?? []} timezone={body.data.timezone} />
    </>
  );
}
