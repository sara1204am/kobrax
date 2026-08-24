import { getTranslations } from 'next-intl/server';
import type { AccountInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { PageHeader, EmptyState, Badge } from '@/components/panel-ui';
import { BusinessForm } from './business-form';
import { PlanCard } from './plan-card';
import { WhatsappTemplates, type TemplateItem } from './whatsapp-templates';

/** El tono de cada estado de la cuenta. Suspendida es la única que duele: nadie entra. */
const STATUS_TONE = {
  ACTIVE: 'success',
  TRIAL: 'neutral',
  SUSPENDED: 'danger',
  INACTIVE: 'neutral',
  CANCELLED: 'neutral',
} as const;

/**
 * La cuenta: **qué plan tiene y quién es el negocio**, en ese orden.
 *
 * El plan va primero porque es lo que cambia lo que se puede hacer —cuánta gente, cuánta cartera—;
 * los datos del negocio se editan una vez y no se miran más. Antes esta pantalla era sólo el
 * formulario, con los asientos escondidos en una etiqueta del encabezado que además repetía la del
 * equipo.
 *
 * Requiere `account:read`; la API lo valida.
 */
export default async function CuentaPage() {
  const t = await getTranslations('account');
  const { status, body } = await apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true });

  // 403 = el rol no tiene `account:read`. El ítem del menú tampoco se le dibuja, así que llegar
  // acá es haber escrito la URL: se dice que no y listo, sin sugerir cómo entrar.
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('noAccess')} text={body.error?.message} />;
  }
  const account = body.data;
  const known = account.status in STATUS_TONE;

  // Las plantillas piden `catalog:read`; un rol sin él simplemente no ve la sección — mismo
  // criterio que el selector de roles del equipo, que se esconde si `/roles` viene vacío.
  const templates = await apiCall<TemplateItem[]>('/catalogs/WHATSAPP_TEMPLATE', {
    method: 'GET',
    auth: true,
  });

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        badge={
          <Badge dot tone={known ? STATUS_TONE[account.status as keyof typeof STATUS_TONE] : 'neutral'}>
            {known ? t(`status.${account.status}`) : account.status}
          </Badge>
        }
      />
      <div className="space-y-6">
        <PlanCard account={account} />
        {/* Dibuja sus dos secciones (Datos del negocio · Configuración financiera) él mismo. */}
        <BusinessForm account={account} />
        {templates.status === 200 && templates.body.data && (
          <WhatsappTemplates items={templates.body.data} />
        )}
      </div>
    </>
  );
}
