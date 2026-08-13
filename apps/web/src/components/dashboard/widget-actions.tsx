'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DashboardWidget } from '@kobrax/shared';
import { useToast } from '@/components/toast';
import { saveWidgets } from '@/lib/dashboard-save';

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
    const res = await saveWidgets(dashboardId, next, t('defaultName'));
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
