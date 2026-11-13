import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let query = '';
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace }),
}));

import { HiddenModuleNotice } from './hidden-module-notice';

describe('HiddenModuleNotice (F15 · A-4)', () => {
  it('sin `?oculto=` no dice nada', () => {
    query = '';
    const { container } = render(<HiddenModuleNotice canManage />);
    expect(container).toBeEmptyDOMElement();
  });

  it('quien puede editar la cuenta sabe dónde volver a mostrarlo', () => {
    query = 'oculto=routes';
    render(<HiddenModuleNotice canManage />);
    expect(screen.getByRole('status')).toHaveTextContent('Rutas está oculto para tu organización.');
    expect(screen.getByRole('status')).toHaveTextContent('Cuenta › Espacio de trabajo');
  });

  it('el resto sabe a quién pedírselo', () => {
    query = 'oculto=team';
    render(<HiddenModuleNotice canManage={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Equipo está oculto');
    expect(screen.getByRole('status')).toHaveTextContent('Pídele a quien administra la cuenta');
  });

  it('🔴 una clave que no es de un módulo ocultable no escribe nada en la pantalla (la URL no es un canal de texto)', () => {
    for (const bad of ['portfolio', 'inventado', '<b>x</b>']) {
      query = `oculto=${encodeURIComponent(bad)}`;
      const { container, unmount } = render(<HiddenModuleNotice canManage />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('cerrar el aviso limpia la URL', () => {
    query = 'oculto=export';
    render(<HiddenModuleNotice canManage />);
    screen.getByRole('button', { name: 'Cerrar aviso' }).click();
    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('🔴 G6: cerrar el aviso solo quita `oculto`; la pestaña del tablero y los filtros se conservan', () => {
    replace.mockClear();
    query = 'view=abc&oculto=routes&edit=1';
    render(<HiddenModuleNotice canManage />);
    screen.getByRole('button', { name: 'Cerrar aviso' }).click();
    expect(replace).toHaveBeenCalledWith('/dashboard?view=abc&edit=1');
  });
});
