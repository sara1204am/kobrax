import { Permission } from '@kobrax/shared';
import { redirect } from 'next/navigation';
import { getMe, requirePermission } from '@/lib/authz';

/**
 * Seguridad es un grupo del menú, no una pantalla: esta ruta sólo existe para que un marcador viejo
 * no caiga en 404. Lleva a la primera sección que la persona puede abrir.
 */
export default async function SecurityRedirectPage() {
  const blocked = await requirePermission({ anyOf: [Permission.ROLE_READ, Permission.SUPPORT_CONSENT] });
  if (blocked) return blocked;
  const granted = new Set((await getMe()).body.data?.permissions ?? []);
  redirect(granted.has(Permission.ROLE_READ) ? '/seguridad/roles' : '/seguridad/soporte');
}
