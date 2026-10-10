import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeCapabilities, routeRoles, type RouteFacts } from './route-access';

const actor = (userId: string, ...perms: string[]) => ({ userId, can: (p: string) => perms.includes(p) });
const COLLECTOR = ['route:read', 'route:execute'];
const MANAGER = ['route:read', 'route:write', 'route:assign'];
const ADMIN = ['route:read', 'route:write', 'route:assign', 'route:execute'];
const AUDITOR = ['route:read'];

const route = (over: Partial<RouteFacts> = {}): RouteFacts => ({ collectorId: 'cobrador', createdBy: 'manager', status: 'PLANNED' as never, hasVisits: false, ...over });

describe('routeRoles · quién arma y quién anda la ruta (F4/12)', () => {
  it('arma la ruta quien la creó y el administrador; el cobrador de una ruta que armó el manager NO', () => {
    assert.equal(routeRoles(actor('manager', ...MANAGER), route()).canManage, true);
    assert.equal(routeRoles(actor('admin', ...ADMIN), route()).canManage, true, 'el administrador es quien junta asignar y ejecutar');
    assert.equal(routeRoles(actor('cobrador', ...COLLECTOR), route()).canManage, false);
    assert.equal(routeRoles(actor('otro-manager', ...MANAGER), route()).canManage, false);
  });

  it('anda la ruta (iniciar, cerrar, cancelar) su cobrador y quien la armó; otro manager no', () => {
    assert.equal(routeRoles(actor('cobrador', ...COLLECTOR), route()).canRun, true);
    assert.equal(routeRoles(actor('manager', ...MANAGER), route()).canRun, true);
    assert.equal(routeRoles(actor('otro-manager', ...MANAGER), route()).canRun, false);
  });

  it('una ruta sin creador (anterior a F4/12) se rige como siempre: quien administra rutas y su cobrador', () => {
    const legacy = route({ createdBy: null });
    assert.equal(routeRoles(actor('cualquier-manager', ...MANAGER), legacy).canManage, true);
    assert.equal(routeRoles(actor('cobrador', ...COLLECTOR), legacy).canManage, true);
    assert.equal(routeRoles(actor('otro-cobrador', ...COLLECTOR), legacy).canManage, false);
  });

  it('sin sesión nadie es dueño de nada', () => {
    const r = routeRoles({ userId: undefined, can: () => true }, route({ createdBy: null }));
    assert.equal(r.isCreator, false);
    assert.equal(r.isCollector, false);
  });
});

describe('routeCapabilities · lo que la pantalla puede ofrecer', () => {
  it('el cobrador de una ruta planificada por el manager: la inicia y la cancela, pero la edición la pide', () => {
    const c = routeCapabilities(actor('cobrador', ...COLLECTOR), route());
    assert.equal(c.start, true);
    assert.equal(c.cancel, true);
    assert.equal(c.edit, false);
    assert.equal(c.requestChange, true);
    assert.equal(c.recordVisit, true);
    assert.equal(c.complete, false, 'no se completa lo que no se inició');
  });

  it('en curso: se completa; con visitas ya no se cancela (se cierra)', () => {
    const c = routeCapabilities(actor('cobrador', ...COLLECTOR), route({ status: 'IN_PROGRESS' as never, hasVisits: true }));
    assert.equal(c.complete, true);
    assert.equal(c.cancel, false);
    assert.equal(c.cancelBlockedByVisits, true);
  });

  it('otro manager: puede iniciar/completar (con motivo) y pedir cambios, pero no cancelar ni editar directo', () => {
    const c = routeCapabilities(actor('otro-manager', ...MANAGER), route());
    assert.equal(c.start, true);
    assert.equal(c.cancel, false);
    assert.equal(c.edit, false);
    assert.equal(c.requestChange, true);
    assert.equal(c.recordVisit, true, 'quien administra rutas registra visitas (decisión 2)');
  });

  it('una ruta cerrada no ofrece nada de edición ni de estado, y una cancelada no recibe visitas', () => {
    const done = routeCapabilities(actor('manager', ...MANAGER), route({ status: 'COMPLETED' as never }));
    assert.deepEqual([done.start, done.complete, done.cancel, done.edit, done.requestChange], [false, false, false, false, false]);
    assert.equal(done.recordVisit, true, 'se puede registrar lo que se olvidó en una ruta ya completada');
    const cancelled = routeCapabilities(actor('manager', ...MANAGER), route({ status: 'CANCELLED' as never }));
    assert.equal(cancelled.recordVisit, false);
  });

  it('un auditor no puede nada', () => {
    const c = routeCapabilities(actor('auditor', ...AUDITOR), route());
    assert.deepEqual([c.start, c.complete, c.cancel, c.edit, c.requestChange, c.recordVisit], [false, false, false, false, false, false]);
  });
});
