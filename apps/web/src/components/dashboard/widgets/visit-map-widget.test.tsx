import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { VisitMapPoint } from '@kobrax/shared';
import { VisitMapWidget } from './visit-map-widget';

// MapLibre no corre en jsdom: se captura lo que el widget le pasa al mapa.
const seen: { stops: { title?: string; lines?: string[] }[] }[] = [];
vi.mock('next/dynamic', () => ({
  default: () =>
    function RouteMapStub(props: { stops: { title?: string; lines?: string[] }[] }) {
      seen.push(props);
      return <div data-testid="route-map" />;
    },
}));

const PUNTO: VisitMapPoint = {
  stopId: 's1',
  clientId: 'c1',
  latitude: -19.03,
  longitude: -65.26,
  status: 'PENDING',
  sequenceOrder: 1,
  collectorId: 'u1',
  clientName: 'Freddy Tarqui',
  amount: 2296.96,
  currency: 'BOB',
  collectorName: 'Carlos Collector',
};

describe('VisitMapWidget · globo de cada pin', () => {
  it('el globo dice a quién se visita, el monto y el cobrador al que está asignada', () => {
    seen.length = 0;
    render(<VisitMapWidget points={[PUNTO]} day="2026-10-09" />);
    const stop = seen.at(-1)!.stops[0]!;
    expect(stop.title).toBe('Freddy Tarqui');
    expect(stop.lines?.some((l) => l.startsWith('Monto:') && l.includes('2.296,96'))).toBe(true);
    expect(stop.lines).toContain('Cobrador: Carlos Collector');
    expect(stop.lines).toContain('Pendiente');
  });

  it('🔴 sin monto o sin cobrador esa línea no se escribe (nunca «Monto: Bs 0»)', () => {
    seen.length = 0;
    render(<VisitMapWidget points={[{ ...PUNTO, amount: undefined, currency: undefined, collectorName: undefined }]} day="2026-10-09" />);
    const lines = seen.at(-1)!.stops[0]!.lines!;
    expect(lines.some((l) => l.startsWith('Monto'))).toBe(false);
    expect(lines.some((l) => l.startsWith('Cobrador'))).toBe(false);
  });
});
