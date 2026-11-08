import { Permission } from '@kobrax/shared';
import { getAccount } from '../get-account';
import { GeneralForm } from '../general-form';
import { requirePermission } from '@/lib/authz';

/** Quién es el negocio. La cuenta ya la validó el layout. */
export default async function CuentaGeneralPage() {
  const blocked = await requirePermission(Permission.ACCOUNT_READ);
  if (blocked) return blocked;
  const { body } = await getAccount();
  if (!body.data) return null;
  return <GeneralForm account={body.data} />;
}
