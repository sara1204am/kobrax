import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_PREFERENCES, type AccountPreferences } from '@kobrax/shared';
import { AccountBrandProvider } from '@/components/account-brand';
import { ScheduleNotice } from './schedule-notice';

function renderNotice(props: { date: string; time?: string }, preferences: AccountPreferences = DEFAULT_PREFERENCES) {
  return render(
    <AccountBrandProvider brand={{ name: 'Cobranzas', phone: null, logoUrl: null, preferences }}>
      <ScheduleNotice {...props} />
    </AccountBrandProvider>,
  );
}

describe('ScheduleNotice', () => {
  it('un día laborable dentro de la jornada no avisa nada', () => {
    renderNotice({ date: '2026-10-29', time: '10:00' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('avisa si el equipo no trabaja ese día', () => {
    renderNotice({ date: '2026-11-01' }); // domingo: de fábrica no se trabaja
    expect(screen.getByRole('status')).toHaveTextContent('Tu equipo no trabaja los domingo');
  });

  it('avisa si la hora cae fuera de la jornada, y no si es una franja (sin hora)', () => {
    const { unmount } = renderNotice({ date: '2026-10-29', time: '19:30' });
    expect(screen.getByRole('status')).toHaveTextContent('Las 19:30 quedan fuera de la jornada (08:00–18:00)');
    unmount();
    renderNotice({ date: '2026-10-29' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('respeta lo que la cuenta configuró', () => {
    renderNotice({ date: '2026-10-31', time: '08:30' }, { ...DEFAULT_PREFERENCES, workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '17:00' });
    expect(screen.getByRole('status').textContent).toMatch(/sábado/);
    expect(screen.getByRole('status').textContent).toMatch(/08:30/);
  });

  it('sin preferencias en la marca (cliente viejo) valen las de fábrica', () => {
    render(
      <AccountBrandProvider brand={{ name: 'Cobranzas', phone: null, logoUrl: null }}>
        <ScheduleNotice date="2026-11-01" />
      </AccountBrandProvider>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
