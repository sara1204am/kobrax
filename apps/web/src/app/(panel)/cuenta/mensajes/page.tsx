import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { getAccount } from '../get-account';
import { WhatsappTemplates, type TemplateItem } from '../whatsapp-templates';

/** Los mensajes que el equipo manda a los deudores. Piden `catalog:read`. */
export default async function CuentaMensajesPage() {
  const t = await getTranslations('account');
  const [templates, account] = await Promise.all([
    apiCall<TemplateItem[]>('/catalogs/WHATSAPP_TEMPLATE', { method: 'GET', auth: true }),
    getAccount(),
  ]);

  // Un rol sin `catalog:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (templates.status !== 200 || !templates.body.data) {
    return <EmptyState title={t('noAccess')} text={templates.body.error?.message} />;
  }
  // La moneda es solo para que el saldo de ejemplo se vea como lo verá el deudor; sin `account:read` se usa el default.
  const info = account.status === 200 ? account.body.data : null;
  return (
    <WhatsappTemplates
      items={templates.body.data}
      currency={info?.currencyCode}
      currencyDecimals={info?.currencyDecimals}
    />
  );
}
