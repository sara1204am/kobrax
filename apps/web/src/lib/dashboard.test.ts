import { describe, expect, it } from 'vitest';
import { analyticsQuery, dashboardFilters, deltaOf, presetRange } from './dashboard';

const TODAY = new Date('2026-08-13T16:00:00.000Z');

describe('presetRange', () => {
  it('🔴 «últimos 7 días» son 7 contando hoy, no 8', () => {
    // Con 8, el «vs período anterior» compara contra un rango corrido y la flecha miente.
    expect(presetRange('d7', TODAY)).toEqual({ from: '2026-08-07', to: '2026-08-13' });
    expect(presetRange('d30', TODAY)).toEqual({ from: '2026-07-15', to: '2026-08-13' });
  });

  it('el mes corriente arranca el 1° y termina hoy', () => {
    expect(presetRange('month', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-13' });
  });

  it('el mes anterior es el mes ENTERO, no 30 días para atrás', () => {
    expect(presetRange('prevMonth', TODAY)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('el mes anterior cruza bien el año', () => {
    expect(presetRange('prevMonth', new Date('2026-01-09T10:00:00.000Z'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });
});

describe('dashboardFilters', () => {
  it('sin nada en la URL, los últimos 7 días', () => {
    expect(dashboardFilters({}, TODAY)).toEqual({ dateFrom: '2026-08-07', dateTo: '2026-08-13' });
  });

  it('🔴 un id inventado NO viaja a la API', () => {
    // Los seis widgets comparten los filtros: un 400 por un uuid mal formado no rompe uno, rompe
    // la pantalla entera.
    const out = dashboardFilters({ collectorId: '../../users', branchId: 'x' }, TODAY);
    expect(out.collectorId).toBeUndefined();
    expect(out.branchId).toBeUndefined();
  });

  it('un uuid de verdad sí viaja', () => {
    const id = '3f2b9c10-1a4d-4b7e-9c8f-0a1b2c3d4e5f';
    expect(dashboardFilters({ collectorId: id }, TODAY).collectorId).toEqual([id]);
  });

  it('🔴 de varios valores se descarta el inválido, no la lista entera', () => {
    // Un valor pegado a mano no puede arruinar la elección de los otros tres: quien mira la pantalla
    // vería su filtro vacío sin ninguna forma de saber por qué.
    const id = '3f2b9c10-1a4d-4b7e-9c8f-0a1b2c3d4e5f';
    const out = dashboardFilters({ collectorId: `${id},../../users`, caseStatus: 'ACTIVE,INVENTADO' }, TODAY);
    expect(out.collectorId).toEqual([id]);
    expect(out.caseStatus).toEqual(['ACTIVE']);
  });

  it('🔴 un estado o una prioridad inventados tampoco viajan', () => {
    // La API los valida con `@IsEnum` y contesta 400 **a los seis endpoints**: el tablero entero se
    // vuelve seis cajas de error por un valor pegado en la URL.
    const out = dashboardFilters({ caseStatus: 'INVENTADO', priority: 'URGENTISIMA' }, TODAY);
    expect(out.caseStatus).toBeUndefined();
    expect(out.priority).toBeUndefined();
  });

  it('un estado y una prioridad de verdad sí viajan', () => {
    const out = dashboardFilters({ caseStatus: 'ACTIVE', priority: 'HIGH' }, TODAY);
    expect(out.caseStatus).toEqual(['ACTIVE']);
    expect(out.priority).toEqual(['HIGH']);
  });

  it('una fecha inventada cae al rango por defecto', () => {
    expect(dashboardFilters({ from: 'ayer', to: '13/08/2026' }, TODAY)).toEqual({
      dateFrom: '2026-08-07',
      dateTo: '2026-08-13',
    });
  });

  it('un rango al revés se da vuelta en vez de no devolver nada', () => {
    expect(dashboardFilters({ from: '2026-08-20', to: '2026-08-01' }, TODAY)).toEqual({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-20',
    });
  });
});

describe('analyticsQuery', () => {
  it('manda sólo lo que tiene valor', () => {
    const query = analyticsQuery({ dateFrom: '2026-08-01', dateTo: '2026-08-13', collectorId: ['u1'] });
    expect(query.toString()).toBe('dateFrom=2026-08-01&dateTo=2026-08-13&collectorId=u1');
  });

  it('varios valores viajan separados por coma', () => {
    expect(analyticsQuery({ collectorId: ['u1', 'u2'] }).get('collectorId')).toBe('u1,u2');
  });

  it('🔴 una lista vacía no viaja', () => {
    // `[]` es un objeto y pasa cualquier `if`: sin la guarda saldría `collectorId=` y la API armaría
    // un `IN ()`, que es un error de sintaxis de Postgres y no «sin filtro».
    expect(analyticsQuery({ collectorId: [] }).has('collectorId')).toBe(false);
  });
});

describe('deltaOf', () => {
  it('🔴 sin historia no hay flecha', () => {
    // La API manda `previous: null` en los saldos porque la base no guarda cuánto se debía antes.
    // Devolver 0 % acá dibujaría una variación inventada sobre plata.
    expect(deltaOf({ value: 1000, previous: null })).toBeNull();
  });

  it('desde cero tampoco hay porcentaje', () => {
    // Pasar de 0 a 500 no es «+∞ %», es una primera vez.
    expect(deltaOf({ value: 500, previous: 0 })).toBeNull();
  });

  it('calcula la variación y su sentido', () => {
    expect(deltaOf({ value: 110, previous: 100 })).toEqual({ pct: 10, up: true });
    expect(deltaOf({ value: 80, previous: 100 })).toEqual({ pct: -20, up: false });
  });
});
