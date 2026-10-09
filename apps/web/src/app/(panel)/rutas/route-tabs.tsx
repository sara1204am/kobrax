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
 * **«Hoy» es el primero y el default** (F4/12): la pantalla responde a «¿qué pasa hoy con mis rutas?» antes que a
 * «¿qué pasó?». Planificar no es una pestaña: es una acción del encabezado, porque arma las rutas de OTRO día.
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
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Segmented
        value={modo}
        label={t('tabs.label')}
        // Al pasar de uno al otro el día de la URL no tiene el mismo sentido: «Hoy» mira UN día y el historial, otro.
        onChange={(v) => go({ modo: v === 'hoy' ? null : v, date: null, vista: null, from: null, to: null })}
        options={[
          { value: 'hoy', label: t('tabs.today') },
          { value: 'historial', label: t('tabs.history') },
        ]}
      />

      {/* La vista es del historial: en «Hoy» no hay período que elegir. */}
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
