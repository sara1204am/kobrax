import { getTranslations } from 'next-intl/server';
import { Permission } from '@kobrax/shared';
import { requirePermission } from '@/lib/authz';
import { apiCall } from '@/lib/bff';
import { PrivacyRequests } from '@/components/privacy-requests';
import type { PrivacyRequestView } from '@/lib/legal';

/**
 * Cuenta › Privacidad: solicitudes de derechos de los titulares de cobranza (las personas cuyos datos administra esta organización).
 * Pide `account:write`. La organización es la responsable de atenderlas; Kobrax solo ofrece el registro y el seguimiento.
 */
export default async function CuentaPrivacidadPage() {
  const blocked = await requirePermission(Permission.ACCOUNT_WRITE);
  if (blocked) return blocked;
  const [t, res] = await Promise.all([
    getTranslations('privacy'),
    apiCall<PrivacyRequestView[]>('/privacy/requests/org', { method: 'GET', auth: true }),
  ]);
  if (res.status !== 200 || !res.body.data) {
    return (
      <p role="alert" className="rounded-xl border border-k-border bg-white px-5 py-4 text-[14px] text-k-danger">
        {t('loadError')}
      </p>
    );
  }
  return <PrivacyRequests mode="org" initial={res.body.data} />;
}
