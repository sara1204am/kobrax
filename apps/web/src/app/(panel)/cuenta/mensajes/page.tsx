import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { WhatsappTemplates, type TemplateItem } from '../whatsapp-templates';

/** Los mensajes que el equipo manda a los deudores. Piden `catalog:read`. */
export default async function CuentaMensajesPage() {
  const t = await getTranslations('account');
  const templates = await apiCall<TemplateItem[]>('/catalogs/WHATSAPP_TEMPLATE', {
    method: 'GET',
    auth: true,
  });

  // Un rol sin `catalog:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (templates.status !== 200 || !templates.body.data) {
    return <EmptyState title={t('noAccess')} text={templates.body.error?.message} />;
  }
  return <WhatsappTemplates items={templates.body.data} />;
}
