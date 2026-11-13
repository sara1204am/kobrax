import { Permission } from '@kobrax/shared';
import { requirePermission } from '@/lib/authz';
import { getAccount } from '../get-account';
import { WorkspaceEditor } from './workspace-editor';

/**
 * Cuenta › Espacio de trabajo (F15 · P4): qué módulos y opciones ve esta organización. Pide `account:write`.
 *
 * `key` = el `rev` guardado: si otra persona guardó y se recarga, el formulario se vuelve a montar con lo último en vez de
 * conservar un borrador sobre un documento viejo.
 *
 * 🔴 Ocultar no es autorizar: esto no cambia permisos, planes ni datos; la API valida igual cada llamada.
 */
export default async function CuentaEspacioDeTrabajoPage() {
  const blocked = await requirePermission(Permission.ACCOUNT_WRITE);
  if (blocked) return blocked;
  const { body } = await getAccount();
  if (!body.data) return null;
  return <WorkspaceEditor key={body.data.workspace?.rev ?? 0} account={body.data} />;
}
