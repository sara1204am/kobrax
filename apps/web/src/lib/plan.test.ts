import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_LIMIT,
  DEFAULT_MIN_STOPS,
  addMinutes,
  availableQuery,
  clockConflicts,
  defaultLocation,
  hasPlanFilters,
  helpingOthers,
  minStops,
  shiftDays,
  sortAvailable,
  toAvailable,
  haversineKm,
  withinRadius,
} from './plan';

const DIA = '2026-08-25';
const JUAN = '11111111-2222-3333-4444-555555555555';

describe('availableQuery', () => {
  it('🔴 sólo manda lo que GET /mora acepta, y excludeRouted va SIEMPRE con el día que se planifica', () => {
    // El pipe global es forbidNonWhitelisted: un parámetro de más es un 400 y la lista queda vacía.
    const q = availableQuery({ collectorId: JUAN }, DIA);
    expect([...q.keys()].sort()).toEqual(['assigneeId', 'excludeRouted', 'limit', 'sort', 'dir'].sort());
    expect(q.get('excludeRouted')).toBe(DIA);
  });

  it('por defecto trae SÓLO la cartera del cobrador elegido', () => {
    // «Cada uno lo suyo» es la regla; tomar la de otro es ayuda puntual y tiene que ser explícito.
    const q = availableQuery({ collectorId: JUAN }, DIA);
    expect(q.get('assigneeId')).toBe(JUAN);
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

  it('categoría y prioridad (del episodio) aceptan varias, y descartan lo inventado', () => {
    const q = availableQuery({ categoria: 'A,B,../x', prioridad: 'HIGH,CRITICAL,INVENTADA' }, DIA);
    expect(q.get('category')).toBe('A,B');
    expect(q.get('priority')).toBe('HIGH,CRITICAL');
  });

  it('el estado de caso ya no existe: no viaja', () => {
    expect(availableQuery({ estado: 'ACTIVE' } as never, DIA).has('status')).toBe(false);
  });

  it('«Última visita»: nunca visitado, o sin visita desde hace N días (fecha YYYY-MM-DD)', () => {
    const never = availableQuery({ visita: 'never' }, DIA);
    expect(never.get('neverVisited')).toBe('true');
    expect(never.has('notVisitedSince')).toBe(false);
    expect(availableQuery({ visita: '7' }, DIA).get('notVisitedSince')).toBe('2026-08-18');
    expect(availableQuery({ visita: '30' }, DIA).get('notVisitedSince')).toBe('2026-07-26');
    const bad = availableQuery({ visita: '999' }, DIA);
    expect(bad.has('notVisitedSince')).toBe(false);
    expect(bad.has('neverVisited')).toBe(false);
  });

  it('«Resultado de visita» acepta varios y descarta lo inventado', () => {
    const q = availableQuery({ resultado: 'NOT_FOUND,REFUSAL,INVENTADO' }, DIA);
    expect(q.get('outcome')).toBe('NOT_FOUND,REFUSAL');
    expect(availableQuery({ resultado: 'INVENTADO' }, DIA).has('outcome')).toBe(false);
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

describe('toAvailable', () => {
  it('el id de la fila es el creditId: es lo que viaja a generate y a add-stop', () => {
    const row = toAvailable({
      creditId: 'cr-1',
      clientId: 'cl-1',
      clientName: 'Teresa',
      code: 'C-9',
      currency: 'BOB',
      balance: 1200,
      daysPastDue: 40,
      responsibleId: JUAN,
    } as never);
    expect(row).toMatchObject({ id: 'cr-1', clientId: 'cl-1', amount: 1200, daysPastDue: 40, assigneeId: JUAN, creditCode: 'C-9' });
  });
});

describe('toAvailable: zona y ubicaciones', () => {
  it('pasa zone y locations tal cual vienen de GET /mora', () => {
    const locations = [{ latitude: -19.03, longitude: -65.26, address: 'Calle 1' }];
    const row = toAvailable({ creditId: 'cr-1', clientId: 'cl-1', zone: 'Centro', locations } as never);
    expect(row.zone).toBe('Centro');
    expect(row.locations).toEqual(locations);
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
  it('«última visita» y «resultado» cuentan como filtros puestos', () => {
    expect(hasPlanFilters({ visita: 'never' })).toBe(true);
    expect(hasPlanFilters({ resultado: 'PAID' })).toBe(true);
  });

  it('el día y el cobrador NO son filtros: son de qué se está planificando', () => {
    expect(hasPlanFilters({ date: DIA, collectorId: JUAN })).toBe(false);
    expect(hasPlanFilters({ zona: 'Centro' })).toBe(true);
    expect(hasPlanFilters({ cartera: 'todos' })).toBe(true);
  });
});

describe('sortAvailable', () => {
  const fila = (clientName?: string, zone?: string, latitude?: number) => ({
    clientName,
    zone,
    ...(latitude != null ? { locations: [{ latitude }] } : {}),
  });

  it('por nombre, sin que el acento ni la mayúscula manden', () => {
    const rows = [fila('zeballos'), fila('Ávila'), fila('Camacho')];
    expect(sortAvailable(rows, 'client', 'asc').map((r) => r.clientName)).toEqual(['Ávila', 'Camacho', 'zeballos']);
    expect(sortAvailable(rows, 'client', 'desc').map((r) => r.clientName)).toEqual(['zeballos', 'Camacho', 'Ávila']);
  });

  it('por zona, para juntar la ruta', () => {
    const rows = [fila('a', 'Norte'), fila('b', 'Centro'), fila('c', 'Sur')];
    expect(sortAvailable(rows, 'zone', 'asc').map((r) => r.zone)).toEqual(['Centro', 'Norte', 'Sur']);
  });

  it('por ubicación ordena de norte a sur, que es lo que agrupa geográficamente', () => {
    const rows = [fila('a', undefined, -19.05), fila('b', undefined, -19.09), fila('c', undefined, -19.01)];
    expect(sortAvailable(rows, 'coords', 'asc').map((r) => r.clientName)).toEqual(['b', 'a', 'c']);
  });

  it('🔴 quien no tiene el dato va al final EN LOS DOS SENTIDOS', () => {
    // Un cliente sin zona no es «la zona que va primero alfabéticamente»: es uno del que no se sabe
    // dónde está. Al invertir, ponerlo arriba llenaría la cabecera de filas vacías.
    const rows = [fila('a', undefined), fila('b', 'Centro'), fila('c', 'Norte')];
    expect(sortAvailable(rows, 'zone', 'asc').map((r) => r.clientName)).toEqual(['b', 'c', 'a']);
    expect(sortAvailable(rows, 'zone', 'desc').map((r) => r.clientName)).toEqual(['c', 'b', 'a']);
  });

  it('no toca el arreglo original', () => {
    const rows = [fila('z'), fila('a')];
    sortAvailable(rows, 'client', 'asc');
    expect(rows.map((r) => r.clientName)).toEqual(['z', 'a']);
  });
});

describe('haversineKm y withinRadius', () => {
  // Dos puntos reales de Sucre, a unas veinte cuadras.
  const PLAZA = { latitude: -19.0478, longitude: -65.2593 };
  const MERCADO = { latitude: -19.0421, longitude: -65.2612 };

  it('mide en kilómetros, y un punto contra sí mismo da cero', () => {
    expect(haversineKm(PLAZA, PLAZA)).toBe(0);
    const d = haversineKm(PLAZA, MERCADO);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(0.8);
  });

  it('es simétrica: la distancia no depende de desde dónde se mide', () => {
    expect(haversineKm(PLAZA, MERCADO)).toBeCloseTo(haversineKm(MERCADO, PLAZA), 10);
  });

  it('el radio deja adentro lo que está adentro, y afuera lo de más allá', () => {
    const rows = [
      { id: 'cerca', locations: [MERCADO] },
      { id: 'lejos', locations: [{ latitude: -19.1, longitude: -65.35 }] },
    ];
    expect(withinRadius(rows, PLAZA, 1).map((r) => r.id)).toEqual(['cerca']);
    expect(withinRadius(rows, PLAZA, 20).map((r) => r.id)).toEqual(['cerca', 'lejos']);
    expect(withinRadius(rows, PLAZA, 0.1)).toEqual([]);
  });

  it('🔴 quien no tiene ubicación queda AFUERA del área', () => {
    // El área pregunta «qué hay acá», y de esa persona no se sabe dónde está. Meterla igual dejaría
    // una ruta armada por zona con una parada en la otra punta.
    const rows = [{ id: 'sin-ubicacion' }, { id: 'cerca', locations: [MERCADO] }];
    expect(withinRadius(rows, PLAZA, 5).map((r) => r.id)).toEqual(['cerca']);
  });
});

describe('shiftDays', () => {
  it('cuenta días civiles en UTC, sin correrse por la zona horaria', () => {
    expect(shiftDays('2026-08-25', -15)).toBe('2026-08-10');
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('defaultLocation · el domicilio del cliente antes que cualquier otro (F4/12)', () => {
  const loc = (over: Record<string, unknown>) => ({ latitude: -16.5, longitude: -68.1, ...over });

  it('prefiere el domicilio del propio cliente', () => {
    const l = defaultLocation([loc({ id: 'w', locationType: 'WORK' }), loc({ id: 'h', locationType: 'HOME' })]);
    expect(l?.id).toBe('h');
  });

  it('sin domicilio, otra ubicación del cliente antes que la de un garante', () => {
    const l = defaultLocation([loc({ id: 'g', locationType: 'GUARANTOR', ownerName: 'Juan Pérez' }), loc({ id: 'w', locationType: 'WORK' })]);
    expect(l?.id).toBe('w');
  });

  it('solo hay de un garante: se usa esa, para no dejar a la persona sin parada', () => {
    expect(defaultLocation([loc({ id: 'g', locationType: 'GUARANTOR', ownerName: 'Juan' })])?.id).toBe('g');
  });

  it('un domicilio de un garante no gana por llamarse HOME', () => {
    const l = defaultLocation([loc({ id: 'g', locationType: 'HOME', ownerName: 'Juan' }), loc({ id: 'w', locationType: 'WORK' })]);
    expect(l?.id).toBe('w');
  });

  it('sin ubicaciones no hay predeterminada', () => {
    expect(defaultLocation([])).toBeUndefined();
    expect(defaultLocation(undefined)).toBeUndefined();
  });
});

describe('addMinutes y clockConflicts · la hora fija es una restricción dura', () => {
  it('suma minutos a una hora, dando la vuelta a medianoche', () => {
    expect(addMinutes('08:30', 125)).toBe('10:35');
    expect(addMinutes('23:30', 60)).toBe('00:30');
    expect(addMinutes('08:30', 0)).toBe('08:30');
  });

  it('una hora inválida no inventa un resultado', () => {
    expect(addMinutes('25:00', 5)).toBe('—');
    expect(addMinutes('', 5)).toBe('—');
  });

  it('marca las paradas que llegan después de la hora fija de su visita', () => {
    const stops = [
      { id: 'a', etaMinutes: 0 },
      { id: 'b', etaMinutes: 95, scheduledTime: '10:00' }, // sale 08:30 + 95 = 10:05 → tarde
      { id: 'c', etaMinutes: 40, scheduledTime: '10:00' }, // 09:10 → a tiempo
      { id: 'd', scheduledTime: '11:00' }, // sin estimación: no se puede afirmar nada
    ];
    expect(clockConflicts(stops, '08:30')).toEqual(['b']);
  });

  it('llegar justo a la hora no es un choque', () => {
    expect(clockConflicts([{ id: 'a', etaMinutes: 90, scheduledTime: '10:00' }], '08:30')).toEqual([]);
  });
});
