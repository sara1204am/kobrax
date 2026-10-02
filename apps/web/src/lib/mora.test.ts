import { describe, expect, it } from 'vitest';
import { MORA_SORTS } from '@kobrax/shared';
import { MORA_DEFAULT_PAGE_SIZE, hasMoraFilters, isMoraExportFormat, moraExportQuery, moraLimit, moraListQuery } from './mora';

describe('moraListQuery', () => {
  /**
   * 🔴 **La pantalla se llama Mora y abre con los vencidos**, pero lo decide la API: sin `dpdMin` ni
   * `todos`, `GET /mora` ya filtra `días >= 1`. La web no manda un piso propio.
   */
  it('sin filtros sólo pide la página: el piso de mora lo pone la API', () => {
    expect(moraListQuery({}).toString()).toBe(`page=1&limit=${MORA_DEFAULT_PAGE_SIZE}`);
  });

  it('🔴 el tamaño de página sale de la URL: el selector de la tabla tiene que hacer algo', () => {
    expect(moraListQuery({ pageSize: '100' }).get('limit')).toBe('100');
    // La API valida `limit ≤ 100`: pedir más es un 400 que deja la pantalla entera sin lista.
    expect(moraLimit({ pageSize: '500' })).toBe(MORA_DEFAULT_PAGE_SIZE);
  });

  it('«incluir los que están al día» viaja como todos=true, no como dpdMin=0', () => {
    const q = moraListQuery({ todos: '1' });
    expect(q.get('todos')).toBe('true');
    expect(q.has('dpdMin')).toBe(false);
  });

  it('un rango escrito a mano viaja', () => {
    const q = moraListQuery({ dpdMin: '30', dpdMax: '90', balanceMin: '100' });
    expect(q.get('dpdMin')).toBe('30');
    expect(q.get('dpdMax')).toBe('90');
    expect(q.get('balanceMin')).toBe('100');
  });

  it('el estado y la prioridad son los del caso y viajan tal cual', () => {
    const q = moraListQuery({ status: 'ACTIVE,PROMISE_TO_PAY', priority: 'CRITICAL' });
    expect(q.get('status')).toBe('ACTIVE,PROMISE_TO_PAY');
    expect(q.get('priority')).toBe('CRITICAL');
  });

  it('las banderas sólo viajan como true/false; lo demás se descarta', () => {
    expect(moraListQuery({ overdue: 'true' }).get('overdue')).toBe('true');
    expect(moraListQuery({ hasCase: 'false' }).get('hasCase')).toBe('false');
    expect(moraListQuery({ unassigned: 'true' }).get('unassigned')).toBe('true');
    expect(moraListQuery({ overdue: 'quizás' }).has('overdue')).toBe(false);
    expect(moraListQuery({ hasPromise: '1' }).has('hasPromise')).toBe(false);
  });

  it('la búsqueda viaja tal cual y un valor vacío no se manda', () => {
    expect(moraListQuery({ q: '302-222' }).get('q')).toBe('302-222');
    expect(moraListQuery({ q: '' }).has('q')).toBe(false);
    expect(moraListQuery({ assigneeId: '' }).has('assigneeId')).toBe(false);
  });

  it('la fuente conocida viaja; una inventada no (D7)', () => {
    expect(moraListQuery({ source: 'PSF' }).get('source')).toBe('PSF');
    expect(moraListQuery({ source: 'otra' }).has('source')).toBe(false);
  });

  it('una clave de orden que el servidor no conoce NO viaja', () => {
    // Si viajara, la API caería a su orden por defecto y la tabla mostraría una flecha de orden
    // sobre una columna que no ordenó nada.
    expect(moraListQuery({ sort: 'inventado' }).has('sort')).toBe(false);
    expect(moraListQuery({ sort: 'daysPastDue' }).get('sort')).toBe('daysPastDue');
    expect(moraListQuery({ sort: 'lastAction' }).get('sort')).toBe('lastAction');
  });

  it('el orden default de una columna es descendente', () => {
    expect(moraListQuery({ sort: 'balance' }).get('dir')).toBe('desc');
    expect(moraListQuery({ sort: 'balance', dir: 'asc' }).get('dir')).toBe('asc');
  });

  it('una página inválida no rompe: cae en la primera', () => {
    expect(moraListQuery({ page: '-3' }).get('page')).toBe('1');
    expect(moraListQuery({ page: 'x' }).get('page')).toBe('1');
  });

  it('las claves que ofrece son las que la API sabe ordenar', () => {
    expect(MORA_SORTS).toEqual(['daysPastDue', 'balance', 'priority', 'lastAction', 'slaDueAt', 'createdAt']);
  });
});

describe('hasMoraFilters', () => {
  /**
   * El piso de mora que la pantalla pone sola **no cuenta como filtro**: contarlo haría que una
   * cartera sin mora dijera «no encontré nada» cuando la respuesta verdadera es «nadie te debe».
   */
  it('distingue «nadie te debe» de «el filtro no encontró nada»', () => {
    expect(hasMoraFilters({})).toBe(false);
    expect(hasMoraFilters({ overdue: 'quizás' })).toBe(false);
    expect(hasMoraFilters({ status: 'ACTIVE' })).toBe(true);
    expect(hasMoraFilters({ assigneeId: 'u1' })).toBe(true);
    expect(hasMoraFilters({ q: 'tapia' })).toBe(true);
    expect(hasMoraFilters({ dpdMin: '30' })).toBe(true);
    expect(hasMoraFilters({ todos: '1' })).toBe(true);
    expect(hasMoraFilters({ hasCase: 'false' })).toBe(true);
    expect(hasMoraFilters({ source: 'KOBRAX' })).toBe(true);
  });
});

describe('moraExportQuery — exportar lo que se está viendo', () => {
  const VISTA = { priority: 'CRITICAL', dpdMin: '90', source: 'PSF', assigneeId: 'u1', q: 'tapia', sort: 'balance', dir: 'asc', todos: '1', hasCase: 'false' } as const;

  it('🔴 es la query de la lista sin página ni tamaño: mismo filtro, mismo orden', () => {
    const lista = moraListQuery({ ...VISTA, page: '4', pageSize: '100' });
    lista.delete('page');
    lista.delete('limit');
    expect(moraExportQuery({ ...VISTA, page: '4', pageSize: '100' }).toString()).toBe(lista.toString());
  });

  it('el ejemplo del pedido: mora >= 90 y prioridad crítica viajan; la página no', () => {
    const q = moraExportQuery({ dpdMin: '90', priority: 'CRITICAL', page: '3' });
    expect(q.get('dpdMin')).toBe('90');
    expect(q.get('priority')).toBe('CRITICAL');
    expect(q.has('page')).toBe(false);
    expect(q.has('limit')).toBe(false);
  });

  it('sin filtros no manda nada: baja todo lo que el alcance deja ver', () => {
    expect(moraExportQuery({}).toString()).toBe('');
  });

  it('un filtro inventado no viaja, igual que en la lista', () => {
    expect(moraExportQuery({ source: 'otra', sort: 'inventado' }).toString()).toBe('');
  });

  it('sólo existen los formatos csv y pdf', () => {
    expect(isMoraExportFormat('csv')).toBe(true);
    expect(isMoraExportFormat('pdf')).toBe(true);
    expect(isMoraExportFormat('xlsx')).toBe(false);
    expect(isMoraExportFormat('../backup')).toBe(false);
    expect(isMoraExportFormat(undefined)).toBe(false);
  });
});
