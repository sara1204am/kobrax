import { Permission } from '@kobrax/shared';
import type { ArrearCategory, LatePolicyInfo } from '@kobrax/shared';
import { requirePermission } from '@/lib/authz';
import { apiCall } from '@/lib/bff';
import { ArrearCategories } from '../arrear-categories';
import { FinancialForm } from '../financial-form';
import { getAccount } from '../get-account';
import { LatePolicyForm } from '../late-policy-form';
import { PreferencesForm } from '../preferences-form';

/** Cómo cuenta el negocio la plata y la mora. */
export default async function CuentaCobranzaPage() {
  const blocked = await requirePermission(Permission.ACCOUNT_READ);
  if (blocked) return blocked;
  const { body } = await getAccount();
  if (!body.data) return null;

  // Los rangos de la categoría de mora piden `collection:read`; un rol sin él no ve la sección.
  const arrear = await apiCall<ArrearCategory[]>('/arrear-categories', { method: 'GET', auth: true });

  // La política de interés moratorio vigente (apagada por defecto). Si la lectura falla la sección no se muestra: nunca se inventa un valor.
  const late = await apiCall<LatePolicyInfo>('/accounts/me/late-policy', { method: 'GET', auth: true });

  return (
    <>
      <FinancialForm account={body.data} />
      {late.status === 200 && late.body.data && <LatePolicyForm policy={late.body.data} />}
      <PreferencesForm account={body.data} />
      {arrear.status === 200 && arrear.body.data && <ArrearCategories categories={arrear.body.data} />}
    </>
  );
}
