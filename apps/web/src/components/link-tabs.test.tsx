import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkTabs } from './link-tabs';

let mockPath = '/cuenta/general';
vi.mock('next/navigation', () => ({ usePathname: () => mockPath }));

const TABS = [
  { key: 'general', href: '/cuenta/general', label: 'General' },
  { key: 'plan', href: '/cuenta/plan', label: 'Plan', badge: <span data-testid="b" /> },
];

describe('LinkTabs', () => {
  it('marca la pestaña de la ruta actual (y subrutas) con aria-current', () => {
    mockPath = '/cuenta/plan/detalle';
    render(<LinkTabs tabs={TABS} label="Cuenta" />);
    expect(screen.getByRole('navigation', { name: 'Cuenta' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Plan' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('b')).toBeTruthy();
  });

  it('si onNavigate devuelve false, no navega; en la pestaña activa ni siquiera pregunta', async () => {
    mockPath = '/cuenta/general';
    const onNavigate = vi.fn(() => false);
    render(<LinkTabs tabs={TABS} label="Cuenta" onNavigate={onNavigate} />);
    let prevented = false;
    const plan = screen.getByRole('link', { name: 'Plan' });
    document.addEventListener('click', (e) => (prevented = e.defaultPrevented), { once: true });
    await userEvent.click(plan);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
    await userEvent.click(screen.getByRole('link', { name: 'General' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
