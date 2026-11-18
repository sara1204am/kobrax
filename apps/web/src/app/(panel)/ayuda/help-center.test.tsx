import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpCenter, type HelpItem } from './help-center';

const ITEMS: HelpItem[] = [
  {
    id: 'help.portfolio',
    name: 'Cartera',
    href: '/cartera',
    what: 'Tus clientes y sus créditos.',
    does: 'Busca y filtra.',
    startWith: 'Crea tu primer cliente.',
    actions: [
      {
        id: 'screen.portfolio.newClient',
        title: 'Nuevo cliente',
        what: 'Registra a una persona.',
        does: '',
      },
    ],
  },
  {
    id: 'help.payments',
    name: 'Pagos',
    href: '/pagos',
    what: 'Los pagos recibidos.',
    does: 'Registra y consulta.',
    startWith: 'Registra un pago.',
    actions: [],
  },
];

describe('Centro de ayuda (F15 · P10)', () => {
  it('muestra una entrada por módulo con su enlace y las acciones', () => {
    render(<HelpCenter items={ITEMS} />);
    expect(screen.getByRole('heading', { name: 'Cartera' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Pagos' })).toHaveAttribute('href', '/pagos');
    expect(screen.getByText('Nuevo cliente.')).toBeInTheDocument();
  });

  it('busca sin distinguir mayúsculas ni tildes, también dentro de las acciones', async () => {
    const user = userEvent.setup();
    render(<HelpCenter items={ITEMS} />);
    await user.type(screen.getByRole('searchbox'), 'CREDITOS');
    expect(screen.getByRole('heading', { name: 'Cartera' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pagos' })).toBeNull();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'registra a una');
    expect(screen.getByRole('heading', { name: 'Cartera' })).toBeInTheDocument();
  });

  it('sin coincidencias lo dice', async () => {
    const user = userEvent.setup();
    render(<HelpCenter items={ITEMS} />);
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/No encontramos nada/)).toBeInTheDocument();
  });
});
