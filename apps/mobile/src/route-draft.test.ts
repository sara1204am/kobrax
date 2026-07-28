import { RouteStopStatus } from '@kobrax/shared';
import { diffStops, emptyDraft, moveStop, withoutStop, withStop } from './route-draft';
import type { RouteStopItem } from './routes.service';

const stop = (id: string, caseId: string, sequenceOrder: number, status = RouteStopStatus.PENDING): RouteStopItem => ({
  id,
  clientId: `cl-${caseId}`,
  caseId,
  sequenceOrder,
  status,
});

describe('borrador local (ediciones)', () => {
  it('agrega en orden y no duplica el mismo caso', () => {
    let d = emptyDraft('2026-07-28');
    d = withStop(d, 'ca1', 'cl1');
    d = withStop(d, 'ca2', 'cl2');
    d = withStop(d, 'ca1', 'cl1'); // segundo toque sobre el mismo pin
    expect(d.caseIds).toEqual(['ca1', 'ca2']);
    expect(d.clientByCase).toEqual({ ca1: 'cl1', ca2: 'cl2' });
  });

  it('quitar saca el caso y su cliente', () => {
    let d = withStop(withStop(emptyDraft('2026-07-28'), 'ca1', 'cl1'), 'ca2', 'cl2');
    d = withoutStop(d, 'ca1');
    expect(d.caseIds).toEqual(['ca2']);
    expect(d.clientByCase).toEqual({ ca2: 'cl2' });
  });

  it('mover respeta los bordes: la primera no sube, la última no baja', () => {
    let d = emptyDraft('2026-07-28');
    for (const c of ['ca1', 'ca2', 'ca3']) d = withStop(d, c, `cl-${c}`);
    expect(moveStop(d, 'ca3', -1).caseIds).toEqual(['ca1', 'ca3', 'ca2']);
    expect(moveStop(d, 'ca1', -1).caseIds).toEqual(['ca1', 'ca2', 'ca3']); // ya es la primera
    expect(moveStop(d, 'ca3', 1).caseIds).toEqual(['ca1', 'ca2', 'ca3']); // ya es la última
  });
});

describe('diffStops', () => {
  it('server vacío: todo se agrega', () => {
    expect(diffStops(['ca1', 'ca2'], [])).toEqual({ toAdd: ['ca1', 'ca2'], toRemove: [], toMove: [] });
  });

  it('server igual al borrador: no hay nada que hacer (idempotente)', () => {
    const d = diffStops(['ca1', 'ca2'], [stop('s1', 'ca1', 1), stop('s2', 'ca2', 2)]);
    expect(d).toEqual({ toAdd: [], toRemove: [], toMove: [] });
  });

  it('lo que ya no está en el borrador se quita', () => {
    const d = diffStops(['ca1'], [stop('s1', 'ca1', 1), stop('s2', 'ca2', 2)]);
    expect(d.toRemove).toEqual(['s2']);
    expect(d.toAdd).toEqual([]);
  });

  it('el orden del borrador manda: devuelve las posiciones a corregir', () => {
    const d = diffStops(['ca2', 'ca1'], [stop('s1', 'ca1', 1), stop('s2', 'ca2', 2)]);
    expect(d.toMove).toEqual([
      { stopId: 's2', sequenceOrder: 1 },
      { stopId: 's1', sequenceOrder: 2 },
    ]);
  });

  it('una parada ya visitada no se toca ni se cuenta como sobrante', () => {
    const server = [stop('s1', 'ca1', 1, RouteStopStatus.VISITED), stop('s2', 'ca2', 2)];
    const d = diffStops(['ca2'], server);
    expect(d.toRemove).toEqual([]); // s1 es historia de la jornada
    expect(d.toAdd).toEqual([]);
    expect(d.toMove).toEqual([]); // s2 ya está en la posición 2 (después de la visitada)
  });

  it('las posiciones se cuentan después de las paradas ya gestionadas', () => {
    const server = [stop('s1', 'ca1', 1, RouteStopStatus.VISITED), stop('s2', 'ca2', 2), stop('s3', 'ca3', 3)];
    const d = diffStops(['ca3', 'ca2'], server);
    expect(d.toMove).toEqual([
      { stopId: 's3', sequenceOrder: 2 },
      { stopId: 's2', sequenceOrder: 3 },
    ]);
  });
});
