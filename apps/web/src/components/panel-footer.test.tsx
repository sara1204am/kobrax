import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
});

async function draw() {
  vi.resetModules();
  const { PanelFooter } = await import('./panel-footer');
  return render(<PanelFooter />);
}

describe('PanelFooter', () => {
  it('muestra la versión que viene de APP_VERSION, sin ícono', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.1.0');
    const { container } = await draw();
    expect(screen.getByText('v0.1.0')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('el año del copyright se calcula, no está fijo', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.1.0');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-03-01T12:00:00Z'));
    await draw();
    expect(
      screen.getByText('© 2031 Ikigai Tech Bolivia'),
    ).toBeInTheDocument();
  });

  it('sin APP_VERSION no dibuja una «v» huérfana', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '');
    await draw();
    expect(screen.queryByText(/^v/)).toBeNull();
  });
});
