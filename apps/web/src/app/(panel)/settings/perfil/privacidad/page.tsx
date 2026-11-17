import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { PrivacyPanel } from '@/components/privacy-panel';
import { PrivacyRequests } from '@/components/privacy-requests';
import type { LegalOverview, PrivacyRequestView } from '@/lib/legal';

/** Mi perfil › Privacidad: tus comunicaciones opcionales y los documentos que aceptaste. Es de cada quien: no pide permiso. */
export default async function PrivacidadPage() {
  const [t, res, mine] = await Promise.all([
    getTranslations('privacy'),
    apiCall<LegalOverview>('/legal/me', { method: 'GET', auth: true }),
    apiCall<PrivacyRequestView[]>('/privacy/requests/mine', { method: 'GET', auth: true }),
  ]);
  if (res.status !== 200 || !res.body.data) {
    return (
      <p role="alert" className="rounded-xl border border-k-border bg-white px-5 py-4 text-[14px] text-k-danger">
        {t('loadError')}
      </p>
    );
  }
  return (
    <>
      <PrivacyPanel overview={res.body.data} />
      {/* Si la lista de solicitudes no responde, el resto de la pantalla sigue: se muestra vacía y se puede presentar una nueva. */}
      <PrivacyRequests mode="self" initial={mine.status === 200 ? (mine.body.data ?? []) : []} />
    </>
  );
}
