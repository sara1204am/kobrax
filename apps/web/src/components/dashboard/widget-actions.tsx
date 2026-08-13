'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DashboardWidget } from '@kobrax/shared';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

/**
 * Quitar o duplicar un widget. **Sólo en modo Editar**.
 *
 * Guardan la lista completa, igual que el arrastre: es la misma llamada y no hay un segundo camino
 * que pueda quedar desincronizado.
 */
export function WidgetActions({
  widget,
  widgets,
  dashboardId,
}: {
  widget: DashboardWidget;
  widgets: DashboardWidget[];
  dashboardId?: string;
}) {
  const t = useTranslations('panel.dashboard');
  const router = useRouter();
  const toast = useToast();

  async function save(next: DashboardWidget[]) {
    const body = {
      widgets: next.map((w) => ({
        type: w.type,
        title: w.title || undefined,
        x: w.layout.x,
        y: w.layout.y,
        w: w.layout.w,
        h: w.layout.h,
        config: w.config,
      })),
    };
    const res = dashboardId
      ? await sendJson(`/api/dashboards/${dashboardId}`, body, 'PATCH')
      : await sendJson('/api/dashboards', { name: t('defaultName'), isDefault: true, ...body }, 'POST');
    if (!res.ok) {
      toast(t('saveError'), 'danger');
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={t('duplicateWidget')}
        title={t('duplicateWidget')}
        onClick={() =>
          void save([
            ...widgets,
            { ...widget, id: `${widget.id}-copia`, layout: { ...widget.layout, y: widget.layout.y + widget.layout.h } },
          ])
        }
        className="rounded-md px-1.5 text-[14px] leading-none text-k-muted hover:bg-k-bg hover:text-k-text-2"
      >
        ⧉
      </button>
      <button
        type="button"
        aria-label={t('removeWidget')}
        title={t('removeWidget')}
        onClick={() => void save(widgets.filter((w) => w.id !== widget.id))}
        className="rounded-md px-1.5 text-[16px] leading-none text-k-muted hover:bg-k-danger-bg hover:text-k-danger"
      >
        ×
      </button>
    </span>
  );
}
