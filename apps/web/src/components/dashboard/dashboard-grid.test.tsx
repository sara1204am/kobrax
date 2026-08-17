import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import type { DashboardWidget } from '@kobrax/shared';
import { ToastProvider } from '@/components/toast';
import { DashboardGrid } from './dashboard-grid';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/*
 * jsdom no layoutea: `getComputedStyle(div).width` viene vacío y `clientWidth` es 0, así que la
 * grilla mediría cero y no se dibujaría nada. Se le da un ancho al entorno, que es lo único que le
 * falta — el cálculo de columnas es de la librería y sí corre de verdad.
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1280 });
});

const widgets = (ids: [string, string]): DashboardWidget[] => [
  { id: ids[0], type: 'kpi', title: '', layout: { x: 0, y: 0, w: 4, h: 3 }, config: {} },
  { id: ids[1], type: 'kpi', title: '', layout: { x: 4, y: 0, w: 4, h: 3 }, config: {} },
];

function draw(list: DashboardWidget[]) {
  return (
    <ToastProvider>
      <DashboardGrid dashboardId="d1" widgets={list} editable>
        {list.map((w) => (
          <div key={w.id}>{w.id}</div>
        ))}
      </DashboardGrid>
    </ToastProvider>
  );
}

/** El ancho en píxeles que la grilla le puso a cada widget. */
const anchos = () =>
  [...document.querySelectorAll<HTMLElement>('.react-grid-item')].map((el) => Number.parseFloat(el.style.width));

describe('DashboardGrid', () => {
  it('mantiene el tamaño de los widgets cuando el guardado les cambia el id', () => {
    // La API borra y vuelve a crear los widgets en cada guardado: el refresh trae las mismas
    // posiciones con ids nuevos. Si el layout se sincronizara un render tarde, la grilla no
    // encontraría ninguna posición y les daría su default de 1×1 — el parpadeo con todo hecho
    // cajitas en una columna.
    const { rerender } = render(draw(widgets(['viejo-1', 'viejo-2'])));
    const antes = anchos();
    expect(antes).toHaveLength(2);
    expect(antes[0]).toBeGreaterThan(300); // 4 de 12 columnas sobre 1280px

    rerender(draw(widgets(['nuevo-1', 'nuevo-2'])));
    expect(anchos()).toEqual(antes);
  });
});
