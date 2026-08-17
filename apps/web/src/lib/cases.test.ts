import { describe, expect, it } from 'vitest';
import { CaseStatus } from '@kobrax/shared';
import { CASE_SORTS, canClose, hasMoraFilters, moraQuery, nextStates } from './cases';

describe('nextStates', () => {
  it('ofrece sólo lo que la máquina de estados permite', () => {
    expect(nextStates(CaseStatus.PENDING)).toEqual([CaseStatus.ACTIVE]);
    expect(nextStates(CaseStatus.PROMISE_TO_PAY)).toEqual([CaseStatus.PAID, CaseStatus.ACTIVE]);
  });

  it('🔴 CLOSED nunca sale por el control de estados', () => {
    // Tiene su propio endpoint, exige motivo y pide otro permiso: mezclarlo lo haría parecer un
    // cambio de estado más, y es el único que no se puede deshacer.
    for (const from of Object.values(CaseStatus)) {
      expect(nextStates(from)).not.toContain(CaseStatus.CLOSED);
    }
    expect(nextStates(CaseStatus.PAID)).toEqual([]);
  });

  it('un caso terminal no ofrece nada', () => {
    expect(nextStates(CaseStatus.CLOSED)).toEqual([]);
    expect(nextStates(CaseStatus.WRITTEN_OFF)).toEqual([]);
  });
});

describe('canClose', () => {
  it('sólo se cierra lo que ya está pagado', () => {
    expect(canClose(CaseStatus.PAID)).toBe(true);
    expect(canClose(CaseStatus.ACTIVE)).toBe(false);
    expect(canClose(CaseStatus.CLOSED)).toBe(false);
  });
});

describe('moraQuery', () => {
  /**
   * 🔴 **La pantalla se llama Mora y abre con los vencidos.** Sin `dpdMin=1` listaba todo el trabajo
   * abierto, incluyendo a quien está al día y sólo tiene el expediente sin cerrar.
   */
  it('abre por vencidos y pide sólo lo abierto', () => {
    // La lista promete «el trabajo abierto»: sin `open=true` traía también los cerrados, y
    // ordenando por prioridad un crítico cerrado quedaba arriba del alto de hoy.
    expect(moraQuery({}, 20).toString()).toBe('page=1&limit=20&dpdMin=1&open=true');
  });

  it('«incluir los que están al día» saca el piso de mora, no lo pone en cero', () => {
    // Mandar `dpdMin=0` sería un filtro de verdad y perdería a los que no tienen crédito con mora.
    expect(moraQuery({ todos: '1' }, 20).has('dpdMin')).toBe(false);
  });

  it('un rango escrito a mano gana sobre el default', () => {
    const q = moraQuery({ dpdMin: '30', dpdMax: '90' }, 20);
    expect(q.get('dpdMin')).toBe('30');
    expect(q.get('dpdMax')).toBe('90');
  });

  it('con un estado elegido manda ÉSE, aunque sea terminal', () => {
    // Pedir «Cerrados» tiene que traer cerrados: `open` los excluiría a todos.
    const query = moraQuery({ status: 'CLOSED' }, 20);
    expect(query.get('status')).toBe('CLOSED');
    expect(query.has('open')).toBe(false);
  });

  it('overdue viaja como texto, que es como lo valida el DTO', () => {
    expect(moraQuery({ overdue: 'true' }, 20).get('overdue')).toBe('true');
    expect(moraQuery({ overdue: 'false' }, 20).has('overdue')).toBe(false);
  });

  it('la búsqueda por deudor viaja tal cual', () => {
    expect(moraQuery({ q: 'tapia' }, 20).get('q')).toBe('tapia');
    expect(moraQuery({ q: '' }, 20).has('q')).toBe(false);
  });

  it('una clave de orden que el servidor no conoce NO viaja', () => {
    // Si viajara, la API caería a su orden por defecto y la tabla mostraría una flecha de orden
    // sobre una columna que no ordenó nada.
    expect(moraQuery({ sort: 'inventado' }, 20).has('sort')).toBe(false);
    expect(moraQuery({ sort: 'daysPastDue' }, 20).get('sort')).toBe('daysPastDue');
  });

  it('el orden default de una columna es descendente', () => {
    expect(moraQuery({ sort: 'balance' }, 20).get('dir')).toBe('desc');
    expect(moraQuery({ sort: 'balance', dir: 'asc' }, 20).get('dir')).toBe('asc');
  });

  it('una página inválida no rompe: cae en la primera', () => {
    expect(moraQuery({ page: '-3' }, 20).get('page')).toBe('1');
    expect(moraQuery({ page: 'x' }, 20).get('page')).toBe('1');
  });

  it('las claves que ofrece son las que la API sabe ordenar', () => {
    expect(CASE_SORTS).toEqual(['priority', 'daysPastDue', 'balance', 'slaDueAt', 'createdAt']);
  });
});

describe('hasMoraFilters', () => {
  /**
   * El `dpdMin=1` que la pantalla pone sola **no cuenta como filtro**: contarlo haría que una
   * cartera sin mora dijera «no encontré nada» cuando la respuesta verdadera es «nadie te debe».
   */
  it('distingue «nadie te debe» de «el filtro no encontró nada»', () => {
    expect(hasMoraFilters({})).toBe(false);
    expect(hasMoraFilters({ overdue: 'false' })).toBe(false);
    expect(hasMoraFilters({ status: 'ACTIVE' })).toBe(true);
    expect(hasMoraFilters({ assigneeId: 'u1' })).toBe(true);
    expect(hasMoraFilters({ q: 'tapia' })).toBe(true);
    expect(hasMoraFilters({ dpdMin: '30' })).toBe(true);
    expect(hasMoraFilters({ todos: '1' })).toBe(true);
  });
});
