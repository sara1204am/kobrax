import { describe, expect, it } from 'vitest';
import { AVAILABLE_LIMIT, DEFAULT_MIN_STOPS, availableQuery, hasPlanFilters, helpingOthers, minStops, shiftDays } from './plan';

const DIA = '2026-08-25';
const JUAN = '11111111-2222-3333-4444-555555555555';

describe('availableQuery', () => {
  it('🔴 nunca ofrece mora que ya es parada de una ruta de ese día', () => {
    // Sin esto, dos supervisores mandan a dos cobradores a la misma puerta la misma mañana. Y ni
    // siquiera hacen falta dos: alcanza con volver a entrar a la pantalla.
    expect(availableQuery({}, DIA).get('excludeRouted')).toBe(DIA);
  });

  it('por defecto trae SÓLO la cartera del cobrador elegido', () => {
    // «Cada uno lo suyo» es la regla; tomar la de otro es ayuda puntual y tiene que ser explícito.
    const q = availableQuery({ collectorId: JUAN }, DIA);
    expect(q.get('assigneeId')).toBe(JUAN);
    expect(q.get('open')).toBe('true');
    expect(q.get('view')).toBe('portfolio');
    expect(q.get('limit')).toBe(String(AVAILABLE_LIMIT));
  });

  it('«ayudar a otro» saca el filtro de cartera, y sólo entonces', () => {
    const q = availableQuery({ collectorId: JUAN, cartera: 'todos' }, DIA);
    expect(q.has('assigneeId')).toBe(false);
    expect(helpingOthers({ cartera: 'todos' })).toBe(true);
    expect(helpingOthers({})).toBe(false);
  });

  it('el rango de mora viaja como mínimo y máximo', () => {
    const q = availableQuery({ dpd: '31-60' }, DIA);
    expect(q.get('dpdMin')).toBe('31');
    expect(q.get('dpdMax')).toBe('60');
  });

  it('«+90 días» no manda máximo: es un piso, no un rango', () => {
    const q = availableQuery({ dpd: '90-' }, DIA);
    expect(q.get('dpdMin')).toBe('90');
    expect(q.has('dpdMax')).toBe(false);
  });

  it('estado, prioridad y resultado aceptan varios, y descartan lo inventado', () => {
    const q = availableQuery({ estado: 'ACTIVE,INVENTADO', prioridad: 'HIGH,CRITICAL', resultado: 'NOT_FOUND,X' }, DIA);
    expect(q.get('status')).toBe('ACTIVE');
    expect(q.get('priority')).toBe('HIGH,CRITICAL');
    expect(q.get('outcome')).toBe('NOT_FOUND');
  });

  it('«no visitado hace 15 días» se traduce a una fecha, contando desde el día que se planifica', () => {
    // Y no desde hoy: si se planifica el lunes que viene, «hace 15 días» es respecto de ese lunes.
    expect(availableQuery({ visita: '15' }, DIA).get('notVisitedSince')).toBe('2026-08-10');
  });

  it('«nunca visitado» es otro filtro, no una fecha', () => {
    const q = availableQuery({ visita: 'never' }, DIA);
    expect(q.get('neverVisited')).toBe('true');
    expect(q.has('notVisitedSince')).toBe(false);
  });

  it('el saldo viaja sólo si es un número', () => {
    expect(availableQuery({ saldoMin: '1000' }, DIA).get('balanceMin')).toBe('1000');
    expect(availableQuery({ saldoMin: 'mil' }, DIA).has('balanceMin')).toBe(false);
    expect(availableQuery({ saldoMin: '-5' }, DIA).has('balanceMin')).toBe(false);
  });

  it('sin orden pedido, lo más urgente primero', () => {
    const q = availableQuery({}, DIA);
    expect(q.get('sort')).toBe('priority');
    expect(q.get('dir')).toBe('desc');
  });

  it('🔴 un orden que la API no conoce NO viaja: caería al default y la flecha mentiría', () => {
    const q = availableQuery({ sort: 'distance' }, DIA);
    expect(q.get('sort')).toBe('priority');
  });
});

describe('minStops', () => {
  it('🔴 es un MÍNIMO, y su default es el que arma el negocio', () => {
    // No hay capacidad máxima (decisión de la dueña): no se bloquea al noveno, se avisa al que
    // queda corto.
    expect(minStops({})).toBe(DEFAULT_MIN_STOPS);
    expect(minStops({ minStops: '12' })).toBe(12);
    expect(minStops({ minStops: '0' })).toBe(DEFAULT_MIN_STOPS);
    expect(minStops({ minStops: 'ocho' })).toBe(DEFAULT_MIN_STOPS);
  });
});

describe('hasPlanFilters', () => {
  it('el día y el cobrador NO son filtros: son de qué se está planificando', () => {
    expect(hasPlanFilters({ date: DIA, collectorId: JUAN })).toBe(false);
    expect(hasPlanFilters({ zona: 'Centro' })).toBe(true);
    expect(hasPlanFilters({ cartera: 'todos' })).toBe(true);
  });
});

describe('shiftDays', () => {
  it('cuenta días civiles en UTC, sin correrse por la zona horaria', () => {
    expect(shiftDays('2026-08-25', -15)).toBe('2026-08-10');
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
