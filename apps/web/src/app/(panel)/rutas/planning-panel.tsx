import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/panel-ui';

/**
 * Planificación — **el modo existe, el planificador todavía no**.
 *
 * 🔴 No hay botón de «Planificar rutas» y es a propósito: un botón que no hace nada es peor que no
 * tenerlo. Lo que sí hay es la verdad de hoy —cómo nacen las rutas ahora mismo— para que quien entra
 * no se quede pensando que la pantalla se rompió.
 *
 * Lo que falta es UI, no backend: `POST /routes/generate` ya acepta el cobrador y los casos, y
 * quien tiene `route:assign` puede armarle la ruta a cualquiera. La etapa que sigue lo cablea.
 */
export async function PlanningPanel({ canPlan }: { canPlan: boolean }) {
  const t = await getTranslations('panel.routes.planning');

  return (
    <Card>
      <h2 className="text-[18px] font-semibold text-k-navy">{t('title')}</h2>
      <p className="mt-2 max-w-[70ch] text-[14px] text-k-text-2">{t('soon')}</p>
      {/* Sin `route:assign` no va a poder planificar cuando exista: mejor decirlo ahora que
          dejar que arme una tanda entera para chocarse con un 403 al confirmar. */}
      <p className="mt-3 max-w-[70ch] text-[14px] text-k-text-2">{canPlan ? t('today') : t('noPermission')}</p>
    </Card>
  );
}
