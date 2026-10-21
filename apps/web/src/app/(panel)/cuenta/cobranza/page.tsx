import type { ArrearCategory } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { ArrearCategories } from '../arrear-categories';
import { FinancialForm } from '../financial-form';
import { getAccount } from '../get-account';

/** Cómo cuenta el negocio la plata y la mora. */
export default async function CuentaCobranzaPage() {
  const { body } = await getAccount();
  if (!body.data) return null;

  // Los rangos de la categoría de mora piden `collection:read`; un rol sin él no ve la sección.
  const arrear = await apiCall<ArrearCategory[]>('/arrear-categories', { method: 'GET', auth: true });

  return (
    <>
      <FinancialForm account={body.data} />
      {arrear.status === 200 && arrear.body.data && <ArrearCategories categories={arrear.body.data} />}
    </>
  );
}
