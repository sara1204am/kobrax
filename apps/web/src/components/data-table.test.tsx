import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './data-table';
import type { FilterDef } from './data-table-filters';

const { push, replace, search } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: { value: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/cartera',
  useSearchParams: () => new URLSearchParams(search.value),
}));

interface Row {
  id: string;
  name: string;
  debt: number;
}
const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Cliente', render: (r) => r.name, sortable: true },
  { key: 'debt', header: 'Deuda', render: (r) => r.debt, sortable: true, numeric: true },
];
const ROWS: Row[] = [
  { id: '1', name: 'Ana', debt: 100 },
  { id: '2', name: 'Beto', debt: 200 },
];
const META = { total: 45, page: 2, limit: 20, pages: 3 };

function renderTable(meta = META, rows = ROWS) {
  return render(
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      meta={meta}
      empty={<p>Sin clientes</p>}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  search.value = '';
  localStorage.clear();
});

describe('DataTable — el orden vive en la URL', () => {
  it('ordenar por una columna vuelve a la página 1', async () => {
    search.value = 'page=7&sort=debt&dir=asc';
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: /cliente/i }));
    // Sin el reset, la persona cae en un pedazo del medio de una lista que no vio empezar.
    expect(push).toHaveBeenCalledWith('/cartera?page=1&sort=name&dir=asc');
  });

  it('volver a tocar la misma columna invierte el sentido', async () => {
    search.value = 'sort=name&dir=asc';
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: /cliente/i }));
    expect(push).toHaveBeenCalledWith('/cartera?sort=name&dir=desc&page=1');
  });

  it('conserva los filtros que ya estaban en la URL', async () => {
    search.value = 'q=perez&estado=mora';
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: /deuda/i }));
    expect(push).toHaveBeenCalledWith('/cartera?q=perez&estado=mora&sort=debt&dir=asc&page=1');
  });

  it('anuncia el orden a los lectores de pantalla', () => {
    search.value = 'sort=debt&dir=desc';
    renderTable();
    expect(screen.getByRole('columnheader', { name: /deuda/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});

describe('DataTable — paginación', () => {
  it('en la primera página no se puede retroceder', () => {
    renderTable({ ...META, page: 1 });
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  it('en la última no se puede avanzar', () => {
    renderTable({ ...META, page: 3 });
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('cuenta el tramo visible sobre el total', () => {
    renderTable();
    expect(screen.getByText('21–40 de 45')).toBeInTheDocument();
  });

  it('con una sola página no se pinta la paginación', () => {
    renderTable({ total: 2, page: 1, limit: 20, pages: 1 });
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
  });
});

describe('DataTable — sin filas', () => {
  it('muestra el vacío que le pasaron, no una tabla con encabezados solos', () => {
    renderTable(META, []);
    expect(screen.getByText('Sin clientes')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('🔴 vacío por filtros NO es lo mismo que lista vacía', () => {
    // Uno se arregla borrando el filtro y el otro dando de alta a alguien. Decir «no hay clientes»
    // cuando lo que pasa es que el filtro no encontró nada manda a la persona a buscar el problema
    // donde no está.
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        meta={META}
        filtered
        empty={<p>Sin clientes</p>}
        noResults={<p>Nada con esos filtros</p>}
      />,
    );
    expect(screen.getByText('Nada con esos filtros')).toBeInTheDocument();
  });

  it('el error reemplaza a la tabla entera', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        meta={META}
        empty={<p>Sin clientes</p>}
        error={<p>No se pudo cargar</p>}
      />,
    );
    expect(screen.getByText('No se pudo cargar')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

/** Columnas con una apagada por defecto, para probar el ojito de ⚙ Columnas. */
const CONFIGURABLES: Column<Row>[] = [
  ...COLUMNS,
  { key: 'oculta', header: 'Riesgo', render: () => '—', visibleByDefault: false },
];

/**
 * Los filtros. El core no sabe qué significan: sólo escribe sus claves en la URL. Viven en el panel
 * lateral, no en el encabezado de la tabla.
 */
const FILTROS: FilterDef[] = [
  { keys: ['q'], label: 'Cliente', type: 'text' },
  { keys: ['debtMin', 'debtMax'], label: 'Deuda', type: 'numberRange' },
];

function renderFiltrable(extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable
      tableId="prueba"
      columns={CONFIGURABLES}
      rows={ROWS}
      rowKey={(r) => r.id}
      meta={META}
      filters={FILTROS}
      empty={<p>Sin clientes</p>}
      {...extra}
    />,
  );
}

/** El panel arranca cerrado salvo que ya haya un filtro puesto: hay que abrirlo para filtrar. */
async function abrirFiltros() {
  await userEvent.click(screen.getByRole('button', { name: 'Filtros aplicados' }));
}

/*
 * ⚠️ **Sin `useFakeTimers`.** El debounce se prueba con temporizadores reales y `waitFor`: en este
 * setup, `useFakeTimers` junto con `userEvent` cuelga la corrida entera —ya pasó, y el síntoma es
 * un test que nunca termina, no uno que falla—. Son 350 ms; `waitFor` espera hasta un segundo.
 */
describe('DataTable — panel de filtros', () => {
  it('el panel arranca cerrado, y abre solo si ya venía un filtro puesto', () => {
    const { unmount } = renderFiltrable();
    expect(screen.queryByRole('complementary', { name: 'Filtros' })).not.toBeInTheDocument();
    unmount();

    // Con un filtro puesto tiene que estar a la vista: escondido, la lista sale corta y nada lo explica.
    renderFiltrable({ filtered: true });
    expect(screen.getByRole('complementary', { name: 'Filtros' })).toBeInTheDocument();
  });

  it('un filtro de texto escribe su clave y vuelve a la página 1', async () => {
    search.value = 'page=5';
    renderFiltrable();
    await abrirFiltros();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Cliente' }), 'perez');
    // Mientras se tipea no sale ni un pedido: seis teclas serían seis consultas a la cartera entera.
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/cartera?page=1&q=perez'));
  });

  it('un rango manda sólo el extremo que se escribió', async () => {
    renderFiltrable();
    await abrirFiltros();
    await userEvent.type(screen.getByRole('spinbutton', { name: /Deuda — Mín/ }), '10000');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/cartera?debtMin=10000&page=1'));
  });

  it('🔴 filtrar NO borra el orden ni el resto de los filtros', async () => {
    search.value = 'sort=debt&dir=desc&dpdMin=90';
    renderFiltrable({ filtered: true });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Cliente' }), 'ana');
    await waitFor(() => expect(push).toHaveBeenCalled());
    const url = push.mock.calls.at(-1)![0] as string;
    expect(url).toContain('sort=debt');
    expect(url).toContain('dir=desc');
    expect(url).toContain('dpdMin=90');
  });

  it('«Limpiar» borra los filtros y deja el orden', async () => {
    search.value = 'q=perez&debtMin=10000&sort=debt&dir=desc';
    renderFiltrable({ filtered: true });
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    const url = push.mock.calls.at(-1)![0] as string;
    expect(url).not.toContain('debtMin');
    expect(url).not.toContain('q=perez');
    // El orden no es un filtro: limpiar filtros no reordena la lista bajo los pies de nadie.
    expect(url).toContain('sort=debt');
  });
});

describe('DataTable — columnas configurables', () => {
  it('una columna apagada no se dibuja hasta que se prende con el ojito', async () => {
    renderFiltrable();
    expect(screen.queryByRole('columnheader', { name: 'Riesgo' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar Riesgo' }));
    expect(screen.getByRole('columnheader', { name: 'Riesgo' })).toBeInTheDocument();
    // Y se puede volver a apagar desde el mismo botón, que ahora dice lo contrario.
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar Riesgo' }));
    expect(screen.queryByRole('columnheader', { name: 'Riesgo' })).not.toBeInTheDocument();
  });

  it('🔴 se reordena también con el teclado, no sólo arrastrando', async () => {
    // Arrastrar no existe para quien navega con teclado: sin esto, reordenar sería una función que
    // sólo tienen algunos.
    renderFiltrable();
    const fila = screen.getByRole('listitem', { name: /^Deuda —/ });
    fila.focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[0]).toContain('Deuda');
  });
});

describe('DataTable — tamaño de página', () => {
  it('cambiarlo vuelve a la página 1', async () => {
    search.value = 'page=4';
    renderFiltrable();
    await userEvent.selectOptions(screen.getByLabelText(/Por página/), '100');
    expect(push).toHaveBeenCalledWith('/cartera?page=1&pageSize=100');
  });

});

describe('DataTable — abrir una fila', () => {
  const EXPAND = {
    label: (r: Row) => `Ver el detalle de ${r.name}`,
    render: (r: Row) => <p>{`Detalle de ${r.name}`}</p>,
  };
  const renderConExpand = (rows = ROWS) =>
    render(
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.id}
        meta={META}
        empty={<p>Sin clientes</p>}
        expand={EXPAND}
      />,
    );

  it('sin `expand` no hay flecha ni columna de más', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('abre y cierra, y lo anuncia', async () => {
    renderConExpand();
    const flecha = screen.getByRole('button', { name: 'Ver el detalle de Ana' });
    expect(flecha).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Detalle de Ana')).not.toBeInTheDocument();

    await userEvent.click(flecha);
    expect(flecha).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Detalle de Ana')).toBeInTheDocument();
    // Sólo la que se tocó: abrir una no abre las demás.
    expect(screen.queryByText('Detalle de Beto')).not.toBeInTheDocument();

    await userEvent.click(flecha);
    expect(screen.queryByText('Detalle de Ana')).not.toBeInTheDocument();
  });

  it('🔴 el detalle ocupa el ancho de la tabla, no el de una columna', async () => {
    // Metido en una celda normal heredaría el ancho de esa columna y el alineado a la derecha de
    // los números: se leería como una cifra rota, no como un detalle.
    renderConExpand();
    await userEvent.click(screen.getByRole('button', { name: 'Ver el detalle de Ana' }));
    const celda = screen.getByText('Detalle de Ana').closest('td');
    expect(celda).toHaveAttribute('colspan', '3'); // 2 columnas + la de la flecha
  });

  it('cambiar las filas cierra lo abierto', async () => {
    const { rerender } = renderConExpand();
    await userEvent.click(screen.getByRole('button', { name: 'Ver el detalle de Ana' }));
    expect(screen.getByText('Detalle de Ana')).toBeInTheDocument();

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={[{ id: '9', name: 'Zoe', debt: 900 }]}
        rowKey={(r) => r.id}
        meta={META}
        empty={<p>Sin clientes</p>}
        expand={EXPAND}
      />,
    );
    await waitFor(() => expect(screen.queryByText('Detalle de Ana')).not.toBeInTheDocument());
  });
});

describe('DataTable — selección de filas', () => {
  const renderConSeleccion = (rows = ROWS) =>
    render(
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.id}
        meta={META}
        empty={<p>Sin clientes</p>}
        selection={{ render: (ids) => <button type="button">{`Aplicar a ${ids.length}`}</button> }}
      />,
    );

  it('sin `selection` no dibuja ni una casilla: la cartera sigue como estaba', () => {
    renderTable();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('elegir filas muestra las acciones con el número', async () => {
    renderConSeleccion();
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Elegir este préstamo' })[0]!);
    expect(screen.getByRole('button', { name: 'Aplicar a 1' })).toBeInTheDocument();
    expect(screen.getByText('1 seleccionados')).toBeInTheDocument();
  });

  it('la casilla del encabezado elige y suelta toda la página', async () => {
    renderConSeleccion();
    const todos = screen.getByRole('checkbox', { name: 'Elegir todos los de esta página' });
    await userEvent.click(todos);
    expect(screen.getByRole('button', { name: 'Aplicar a 2' })).toBeInTheDocument();
    await userEvent.click(todos);
    expect(screen.queryByRole('button', { name: /Aplicar/ })).not.toBeInTheDocument();
  });

  /**
   * 🔴 **La trampa de una selección que sobrevive a un filtro.** Si los ids elegidos siguieran vivos
   * después de que la lista cambia, el botón diría «aplicar a 2» sin una sola casilla marcada en
   * pantalla — y la acción caería sobre filas que la persona ya no está mirando.
   */
  it('cambiar las filas borra lo elegido', async () => {
    const { rerender } = renderConSeleccion();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Elegir todos los de esta página' }));
    expect(screen.getByRole('button', { name: 'Aplicar a 2' })).toBeInTheDocument();

    rerender(
      <DataTable
        columns={COLUMNS}
        rows={[{ id: '9', name: 'Zoe', debt: 900 }]}
        rowKey={(r) => r.id}
        meta={META}
        empty={<p>Sin clientes</p>}
        selection={{ render: (ids) => <button type="button">{`Aplicar a ${ids.length}`}</button> }}
      />,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Aplicar/ })).not.toBeInTheDocument());
  });
});
