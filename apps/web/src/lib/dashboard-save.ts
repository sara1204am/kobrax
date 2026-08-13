import type { DashboardWidget } from '@kobrax/shared';
import { sendJson } from './client';

/**
 * Guardar el tablero: **un solo camino**.
 *
 * Lo llaman los tres lugares que cambian el layout —el arrastre, el botón de agregar y el de quitar
 * o duplicar un widget—. Estaba escrito tres veces, y tres copias de «cómo se arma el cuerpo» son
 * tres formas de que una se quede vieja: basta que el contrato sume un campo para que dos widgets
 * se guarden completos y el tercero no.
 *
 * 🔴 **Si la cuenta todavía no tiene tablero, el primer guardado lo crea.** Por eso `dashboardId`
 * puede faltar: el tablero por defecto vive en el código hasta que alguien lo toca.
 */
export function saveWidgets(
  dashboardId: string | undefined,
  widgets: DashboardWidget[],
  defaultName: string,
): Promise<{ ok: boolean }> {
  const body = {
    widgets: widgets.map((w) => ({
      type: w.type,
      title: w.title || undefined,
      x: w.layout.x,
      y: w.layout.y,
      w: w.layout.w,
      h: w.layout.h,
      config: w.config,
    })),
  };

  return dashboardId
    ? sendJson(`/api/dashboards/${dashboardId}`, body, 'PATCH')
    : sendJson('/api/dashboards', { name: defaultName, isDefault: true, ...body }, 'POST');
}
