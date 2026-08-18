import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/panel-ui';

/**
 * Planificación: la puerta al armado de las rutas del día.
 *
 * 🔴 **El botón sólo aparece si la persona puede planificar.** Sin `route:assign` la API rechaza
 * armarle la ruta a otro, así que ofrecerlo sería mandar a alguien a llenar un formulario para que
 * lo frene un 403 al final.
 */
export async function PlanningPanel({ canPlan }: { canPlan: boolean }) {
  const t = await getTranslations('panel.routes.planning');

  return (
    <Card>
      <h2 className="text-[18px] font-semibold text-k-navy">{t('title')}</h2>
      <p className="mt-2 max-w-[70ch] text-[14px] text-k-text-2">{canPlan ? t('intro') : t('noPermission')}</p>

      {canPlan && (
        <Link
          href="/rutas/planificar"
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-k-navy px-4 text-[14px] font-medium text-white hover:bg-k-slate"
        >
          {t('cta')}
        </Link>
      )}

      {/* Lo que todavía no hace, dicho acá y no descubierto a mitad del camino. */}
      <p className="mt-4 max-w-[70ch] text-[13px] text-k-muted">{t('scope')}</p>
    </Card>
  );
}
