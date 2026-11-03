import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_PREFERENCES, type AccountPreferences } from '@kobrax/shared';
import { AccountBrandProvider } from '@/components/account-brand';
import { MiniCalendar } from './mini-calendar';

function renderIt(preferences?: AccountPreferences) {
  return render(
    <AccountBrandProvider brand={{ name: 'Cobranzas', phone: null, logoUrl: null, ...(preferences ? { preferences } : {}) }}>
      <MiniCalendar day="2026-10-29" today="2026-10-29" withItems={new Set()} onPickDay={vi.fn()} onPickMonth={vi.fn()} />
    </AccountBrandProvider>,
  );
}

const headers = () => Array.from(document.querySelectorAll('span.pb-1')).map((e) => e.textContent?.toLowerCase());

describe('MiniCalendar · preferencias de trabajo', () => {
  it('de fábrica la semana empieza en lunes', () => {
    renderIt();
    expect(headers()[0]).toBe('lun');
    expect(headers()[6]).toBe('dom');
  });

  it('con domingo de inicio, la primera columna es domingo', () => {
    renderIt({ ...DEFAULT_PREFERENCES, weekStart: 'SUN' });
    expect(headers()[0]).toBe('dom');
    expect(headers()[6]).toBe('sáb');
  });

  it('un día en que el equipo no trabaja lo dice al pasar por encima', () => {
    renderIt(); // de fábrica el domingo no se trabaja
    expect(screen.getByRole('button', { name: /domingo, 1 de noviembre/i })).toHaveAttribute('title', 'Día no laborable');
    expect(screen.getByRole('button', { name: /jueves, 29 de octubre/i })).not.toHaveAttribute('title');
  });

  it('con una cuenta que no trabaja el sábado, el sábado también se marca', () => {
    renderIt({ ...DEFAULT_PREFERENCES, workDays: [1, 2, 3, 4, 5] });
    expect(screen.getByRole('button', { name: /sábado, 31 de octubre/i })).toHaveAttribute('title', 'Día no laborable');
  });
});
