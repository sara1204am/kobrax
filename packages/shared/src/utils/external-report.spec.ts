import { describe, expect, it } from 'vitest';
import { DEFAULT_REPORT_STALE_AFTER_DAYS, isReportStale, reportAgeDays, staleAfterDaysOf } from './external-report.js';

describe('reportAgeDays', () => {
  it('cuenta días calendario, sin horas', () => {
    expect(reportAgeDays('2026-09-28', new Date('2026-09-30T23:59:00Z'))).toBe(2);
    expect(reportAgeDays(new Date('2026-09-30T00:00:00Z'), '2026-09-30')).toBe(0);
  });

  it('un corte con fecha futura tiene 0 días, no negativos', () => {
    expect(reportAgeDays('2026-10-02', '2026-09-30')).toBe(0);
  });

  it('sin fecha de corte no hay edad', () => {
    expect(reportAgeDays(null, '2026-09-30')).toBeNull();
    expect(reportAgeDays(undefined, '2026-09-30')).toBeNull();
  });
});

describe('isReportStale', () => {
  it('🔴 con el default (2) el dato es viejo desde el tercer día', () => {
    expect(DEFAULT_REPORT_STALE_AFTER_DAYS).toBe(2);
    expect(isReportStale('2026-09-28', '2026-09-30')).toBe(false);
    expect(isReportStale('2026-09-27', '2026-09-30')).toBe(true);
  });

  it('respeta el umbral del formato', () => {
    expect(isReportStale('2026-09-27', '2026-09-30', 5)).toBe(false);
    expect(isReportStale('2026-09-29', '2026-09-30', 0)).toBe(true);
  });

  it('🔴 sin fecha de corte no es viejo: es desconocido (D9)', () => {
    expect(isReportStale(null, '2026-09-30')).toBe(false);
  });
});

describe('staleAfterDaysOf', () => {
  it('usa el configurado si es un entero en rango', () => {
    expect(staleAfterDaysOf(7)).toBe(7);
  });

  it('cae al default ante basura', () => {
    expect(staleAfterDaysOf(undefined)).toBe(2);
    expect(staleAfterDaysOf(0)).toBe(2);
    expect(staleAfterDaysOf(1.5)).toBe(2);
    expect(staleAfterDaysOf('3')).toBe(2);
    expect(staleAfterDaysOf(999)).toBe(2);
  });
});
