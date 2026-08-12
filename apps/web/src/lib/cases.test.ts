import { describe, expect, it } from 'vitest';
import { CaseStatus } from '@kobrax/shared';
import { CASE_SORTS, canClose, caseQuery, hasCaseFilters, nextStates } from './cases';

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

describe('caseQuery', () => {
  it('no manda los filtros vacíos, pero sí pide sólo lo abierto', () => {
    // La lista promete «el trabajo abierto del equipo»: sin `open=true` traía también los
    // cerrados, y ordenando por prioridad un crítico cerrado quedaba arriba del alto de hoy.
    const query = caseQuery({}, 20);
    expect(query.toString()).toBe('page=1&limit=20&open=true');
  });

  it('con un estado elegido manda ÉSE, aunque sea terminal', () => {
    // Pedir «Cerrados» tiene que traer cerrados: `open` los excluiría a todos.
    const query = caseQuery({ status: 'CLOSED' }, 20);
    expect(query.get('status')).toBe('CLOSED');
    expect(query.has('open')).toBe(false);
  });

  it('overdue viaja como texto, que es como lo valida el DTO', () => {
    expect(caseQuery({ overdue: 'true' }, 20).get('overdue')).toBe('true');
    expect(caseQuery({ overdue: 'false' }, 20).has('overdue')).toBe(false);
  });

  it('una clave de orden que el servidor no conoce NO viaja', () => {
    // Si viajara, la API caería a su orden por defecto y la tabla mostraría una flecha de orden
    // sobre una columna que no ordenó nada.
    expect(caseQuery({ sort: 'inventado' }, 20).has('sort')).toBe(false);
    expect(caseQuery({ sort: 'daysPastDue' }, 20).get('sort')).toBe('daysPastDue');
  });

  it('el orden default de una columna es descendente', () => {
    expect(caseQuery({ sort: 'balance' }, 20).get('dir')).toBe('desc');
    expect(caseQuery({ sort: 'balance', dir: 'asc' }, 20).get('dir')).toBe('asc');
  });

  it('una página inválida no rompe: cae en la primera', () => {
    expect(caseQuery({ page: '-3' }, 20).get('page')).toBe('1');
    expect(caseQuery({ page: 'x' }, 20).get('page')).toBe('1');
  });

  it('las claves que ofrece son las que la API sabe ordenar', () => {
    expect(CASE_SORTS).toEqual(['priority', 'daysPastDue', 'balance', 'slaDueAt', 'createdAt']);
  });
});

describe('hasCaseFilters', () => {
  it('distingue la lista vacía de la búsqueda sin resultados', () => {
    expect(hasCaseFilters({})).toBe(false);
    expect(hasCaseFilters({ overdue: 'false' })).toBe(false);
    expect(hasCaseFilters({ status: 'ACTIVE' })).toBe(true);
    expect(hasCaseFilters({ assigneeId: 'u1' })).toBe(true);
  });
});
