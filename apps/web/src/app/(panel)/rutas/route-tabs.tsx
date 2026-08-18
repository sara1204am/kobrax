'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Segmented } from '@/components/panel-ui';
import type { RouteMode, RouteView } from '@/lib/routes';

/**
 * Los dos modos de la pantalla y, dentro del historial, cómo se mira.
 *
 * 🔴 **Viven en la URL** (`?modo=` y `?vista=`), como el resto del panel: se comparte por link, el
 * botón «atrás» funciona y el server component lee lo mismo para pedir un día o un rango. Un estado
 * local acá obligaría a mover la pantalla entera al navegador para nada.
 *
 * Cambiar de modo o de vista **limpia la página**: la 3 de un día no es la 3 de una semana, y
 * quedarse ahí muestra el medio de una lista que la persona no vio empezar.
 */
export function RouteTabs({ modo, vista }: { modo: RouteMode; vista: RouteView }) {
  const t = useTranslations('panel.routes');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete('page');
    router.push(`${pathname}?${next}`);
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Segmented
        value={modo}
        label={t('tabs.label')}
        onChange={(v) => go({ modo: v === 'historial' ? null : v })}
        options={[
          { value: 'planificacion', label: t('tabs.planning') },
          { value: 'historial', label: t('tabs.history') },
        ]}
      />

      {/* La vista es del historial: en planificación no hay día ni período que elegir. */}
      {modo === 'historial' && (
        <Segmented
          value={vista}
          label={t('views.label')}
          onChange={(v) => go({ vista: v === 'dia' ? null : v })}
          options={[
            { value: 'dia', label: t('views.day') },
            { value: 'periodo', label: t('views.period') },
          ]}
        />
      )}
    </div>
  );
}
