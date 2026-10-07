import { resetTenantToday, setTenantToday, todayISO } from './tenant-day';

/** Un instante a una hora LOCAL del teléfono (el día local es el de `new Date(y, m, d, h)`). */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

beforeEach(() => resetTenantToday());

describe('todayISO (día de la empresa)', () => {
  it('sin haber hablado con el servidor es el día LOCAL del teléfono, nunca el UTC', () => {
    expect(todayISO(at(2026, 10, 6, 22))).toBe('2026-10-06');
  });

  it('con la misma zona que la empresa es simplemente el día local', () => {
    setTenantToday('2026-10-06', at(2026, 10, 6, 21));
    expect(todayISO(at(2026, 10, 6, 22))).toBe('2026-10-06');
  });

  it('sigue avanzando sin red: pasan los días del teléfono y avanza el de la empresa', () => {
    setTenantToday('2026-10-06', at(2026, 10, 6, 9));
    expect(todayISO(at(2026, 10, 7, 8))).toBe('2026-10-07');
    expect(todayISO(at(2026, 10, 9, 8))).toBe('2026-10-09');
  });

  it('si el teléfono y la empresa difieren un día, esa diferencia se conserva', () => {
    // El teléfono dice 7 pero la empresa todavía está en el 6 (zonas distintas).
    setTenantToday('2026-10-06', at(2026, 10, 7, 1));
    expect(todayISO(at(2026, 10, 7, 3))).toBe('2026-10-06');
    expect(todayISO(at(2026, 10, 8, 3))).toBe('2026-10-07');
  });

  it('cruza el fin de mes y de año', () => {
    setTenantToday('2026-12-31', at(2026, 12, 31, 20));
    expect(todayISO(at(2027, 1, 1, 9))).toBe('2027-01-01');
  });
});
