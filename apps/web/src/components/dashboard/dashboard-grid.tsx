'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import GridLayout, { useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type { DashboardWidget } from '@kobrax/shared';
import { useToast } from '@/components/toast';
import { saveWidgets } from '@/lib/dashboard-save';
import { widgetDefinition } from '@/lib/widget-registry';

/** Lo que tarda en guardarse un arrastre después de soltarlo. */
const SAVE_DELAY = 600;

/**
 * La grilla del tablero: doce columnas, arrastrable y redimensionable **sólo en modo Editar**.
 *
 * 🔴 **No se guarda cada píxel.** Arrastrar dispara `onLayoutChange` decenas de veces por segundo;
 * mandar un PATCH por cada uno sería inundar la API para escribir el mismo tablero. El cambio va al
 * estado local y se guarda una vez, 600 ms después de que la persona soltó.
 *
 * Los widgets llegan **ya renderizados desde el servidor** (`children`): esta grilla los ubica, no
 * sabe qué son. Por eso uno puede ser un mapa con `maplibre` y otro un SVG plano sin que se entere.
 *
 * ⚠️ Es `react-grid-layout` **v2**, que no tiene el `WidthProvider` de la v1: el ancho lo da el hook
 * `useContainerWidth`, y las opciones van agrupadas (`gridConfig`, `dragConfig`, `resizeConfig`) en
 * vez de sueltas. Escribir contra la API vieja compila hasta que se corre.
 */
export function DashboardGrid({
  dashboardId,
  widgets,
  editable,
  children,
}: {
  /** `undefined` = la cuenta todavía no guardó ningún tablero; al primer cambio se crea. */
  dashboardId?: string;
  widgets: DashboardWidget[];
  editable: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('panel.dashboard');
  const router = useRouter();
  const toast = useToast();
  const { containerRef, width, mounted } = useContainerWidth();
  const [layout, setLayout] = useState<LayoutItem[]>(() => toLayout(widgets));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dirty = useRef(false);

  // Si el servidor manda otro tablero (se cambió de vista, se agregó un widget), el estado local
  // deja de mandar: lo que vale es lo que vino.
  useEffect(() => {
    setLayout(toLayout(widgets));
    dirty.current = false;
  }, [widgets]);

  const save = useCallback(
    async (next: readonly LayoutItem[]) => {
      /*
       * La grilla devuelve posiciones, no widgets: se le vuelve a pegar su tipo y su config antes de
       * guardar. Un widget que la grilla reporte y que ya no esté en la lista se descarta —pasa al
       * borrar uno mientras había un guardado pendiente— en vez de viajar como un `text` vacío.
       */
      const moved = next.flatMap((l) => {
        const widget = widgets.find((w) => w.id === l.i);
        return widget ? [{ ...widget, layout: { x: l.x, y: l.y, w: l.w, h: l.h } }] : [];
      });

      const res = await saveWidgets(dashboardId, moved, t('defaultName'));
      dirty.current = false;
      if (!res.ok) {
        toast(t('saveError'), 'danger');
        return;
      }
      if (!dashboardId) router.refresh();
    },
    [dashboardId, router, t, toast, widgets],
  );

  function onLayoutChange(next: Layout) {
    setLayout([...next]);
    // `onLayoutChange` también dispara al montar y al recalcular el ancho: sin la marca de que hubo
    // un arrastre de verdad, abrir la pantalla guardaría el tablero solo.
    if (!editable || !dirty.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), SAVE_DELAY);
  }

  return (
    // La grilla se dibuja recién cuando el contenedor tiene ancho medido: pintarla antes la
    // calcularía contra cero y todos los widgets nacerían apilados en una columna.
    // El `as` es por React 18: la librería tipa su ref como `RefObject<T | null>`, que es la forma
    // de React 19. Es el mismo objeto en tiempo de ejecución.
    <div ref={containerRef as React.RefObject<HTMLDivElement>}>
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: 12, rowHeight: 64, margin: [16, 16], containerPadding: [0, 0] }}
          // El tirador es la barra del título: con toda la caja arrastrable no se puede seleccionar
          // un número ni tocar un enlace de adentro.
          dragConfig={{ enabled: editable, handle: '.kbx-drag' }}
          resizeConfig={{ enabled: editable }}
          onDragStart={() => (dirty.current = true)}
          onResizeStart={() => (dirty.current = true)}
          onLayoutChange={onLayoutChange}
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}

function toLayout(widgets: DashboardWidget[]): LayoutItem[] {
  return widgets.map((w) => {
    const def = widgetDefinition(w.type);
    return {
      i: w.id,
      x: w.layout.x,
      y: w.layout.y,
      w: w.layout.w,
      h: w.layout.h,
      // El mínimo sale del catálogo y no de la base: un tablero guardado con un mapa de una columna
      // —de una versión vieja o de una mano curiosa— se corrige solo al abrirlo.
      minW: def?.minSize.w ?? 2,
      minH: def?.minSize.h ?? 2,
    };
  });
}
