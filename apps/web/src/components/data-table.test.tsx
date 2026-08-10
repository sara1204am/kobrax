import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './data-table';

const { push, search } = vi.hoisted(() => ({ push: vi.fn(), search: { value: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
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
  search.value = '';
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
});
