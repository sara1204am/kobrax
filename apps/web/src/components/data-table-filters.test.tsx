import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FILTER_CONTROLS, type FilterDef } from './data-table-filters';

const OFICIALES = [
  { value: 'u1', label: 'María Quispe' },
  { value: 'u2', label: 'Juan Pérez' },
  { value: 'u3', label: 'Mariana Rojas' },
];

/** El control suelto, con el estado que le da `Filter`: lo elegido vive en una sola clave, separado por coma. */
function Harness({ def, start = '' }: { def: FilterDef; start?: string }) {
  const [value, setValue] = useState<Record<string, string>>({ registeredBy: start });
  const Control = FILTER_CONTROLS[def.type];
  return (
    <>
      <Control def={def} value={value} onChange={(patch) => setValue((v) => ({ ...v, ...patch }))} />
      <output data-testid="url">{value.registeredBy}</output>
    </>
  );
}

const def = (extra: Partial<FilterDef> = {}): FilterDef => ({
  keys: ['registeredBy'],
  label: 'Oficial de cobranza',
  type: 'multiSelect',
  options: OFICIALES,
  ...extra,
});

const url = () => screen.getByTestId('url').textContent;

describe('multiSelect — lista corta (sin buscador)', () => {
  it('son sólo casillas: no dibuja buscador ni acciones masivas', async () => {
    render(<Harness def={def()} />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seleccionar todos' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Juan Pérez' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'María Quispe' }));
    expect(url()).toBe('u2,u1');
  });
});

describe('multiSelect — con buscador (los oficiales)', () => {
  it('busca sin importar mayúsculas ni tildes', async () => {
    render(<Harness def={def({ searchable: true })} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/ }), 'maria');
    expect(screen.getByRole('checkbox', { name: 'María Quispe' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mariana Rojas' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Juan Pérez' })).not.toBeInTheDocument();
  });

  it('avisa cuando nadie coincide', async () => {
    render(<Harness def={def({ searchable: true })} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/ }), 'zzz');
    expect(screen.getByText('Sin coincidencias.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar todos' })).toBeDisabled();
  });

  it('permite elegir varios y los muestra como chips compactos', async () => {
    render(<Harness def={def({ searchable: true })} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'María Quispe' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Juan Pérez' }));
    expect(url()).toBe('u1,u2');
    const chips = screen.getByRole('list', { name: 'Oficial de cobranza' });
    expect(chips).toHaveTextContent('María Quispe');
    expect(chips).toHaveTextContent('Juan Pérez');
  });

  it('quita una selección individual desde su chip', async () => {
    render(<Harness def={def({ searchable: true })} start="u1,u2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar María Quispe' }));
    expect(url()).toBe('u2');
  });

  it('«Seleccionar todos» marca los autorizados; con una búsqueda, sólo los que coinciden', async () => {
    render(<Harness def={def({ searchable: true })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }));
    expect(url()).toBe('u1,u2,u3');

    await userEvent.click(screen.getByRole('button', { name: 'Quitar todos' }));
    expect(url()).toBe('');

    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/ }), 'maria');
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }));
    expect(url()).toBe('u1,u3');
  });

  it('lo ya elegido se conserva al buscar otra cosa', async () => {
    render(<Harness def={def({ searchable: true })} start="u2" />);
    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar/ }), 'maria');
    await userEvent.click(screen.getByRole('checkbox', { name: 'María Quispe' }));
    expect(url()).toBe('u2,u1');
  });
});
