import { getAccount } from '../get-account';
import { GeneralForm } from '../general-form';

/** Quién es el negocio. La cuenta ya la validó el layout. */
export default async function CuentaGeneralPage() {
  const { body } = await getAccount();
  if (!body.data) return null;
  return <GeneralForm account={body.data} />;
}
