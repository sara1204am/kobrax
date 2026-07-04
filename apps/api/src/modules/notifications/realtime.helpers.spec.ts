import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission, RoleType } from '@kobrax/shared';
import {
  SUPERVISORY_ROLES,
  canSendLocation,
  deriveRooms,
  isValidCoord,
  shouldAcceptLocation,
  supervisorsRoom,
  tenantRoom,
  userRoom,
  LOCATION_THROTTLE_MS,
} from './realtime.helpers';

const collector = { userId: 'u1', accountId: 'a1', permissions: [Permission.ROUTE_EXECUTE, Permission.CASE_READ] };
const supervisor = { userId: 'u2', accountId: 'a1', permissions: [Permission.ROUTE_ASSIGN, Permission.CASE_READ] };

describe('deriveRooms', () => {
  it('un cobrador entra a su tenant y su user, NO a supervisores', () => {
    const rooms = deriveRooms(collector);
    assert.deepEqual(rooms, [tenantRoom('a1'), userRoom('u1')]);
    assert.ok(!rooms.includes(supervisorsRoom('a1')));
  });

  it('un supervisor además entra a la room de supervisores de su tenant', () => {
    const rooms = deriveRooms(supervisor);
    assert.ok(rooms.includes(supervisorsRoom('a1')));
  });

  it('las rooms se derivan del tenant del propio socket (aislamiento)', () => {
    const rooms = deriveRooms({ ...supervisor, accountId: 'otro' });
    assert.ok(rooms.includes(tenantRoom('otro')));
    assert.ok(!rooms.includes(tenantRoom('a1')));
  });
});

describe('canSendLocation', () => {
  it('solo cobradores (route:execute) pueden emitir ubicación', () => {
    assert.equal(canSendLocation(collector), true);
    assert.equal(canSendLocation(supervisor), false);
  });
});

describe('isValidCoord', () => {
  it('acepta coordenadas válidas y rechaza fuera de rango / no finitas', () => {
    assert.equal(isValidCoord(-16.5, -68.15), true);
    assert.equal(isValidCoord(999, 0), false);
    assert.equal(isValidCoord(0, -200), false);
    assert.equal(isValidCoord(Number.NaN, 0), false);
  });
});

describe('shouldAcceptLocation (throttle)', () => {
  it('acepta el primero y rechaza si no pasó el intervalo', () => {
    assert.equal(shouldAcceptLocation(undefined, 1000), true);
    assert.equal(shouldAcceptLocation(1000, 1000 + LOCATION_THROTTLE_MS - 1), false);
    assert.equal(shouldAcceptLocation(1000, 1000 + LOCATION_THROTTLE_MS), true);
  });
});

describe('SUPERVISORY_ROLES', () => {
  it('incluye a quienes pueden asignar rutas y excluye al cobrador', () => {
    assert.ok(SUPERVISORY_ROLES.includes(RoleType.SUPERVISOR));
    assert.ok(SUPERVISORY_ROLES.includes(RoleType.MANAGER));
    assert.ok(SUPERVISORY_ROLES.includes(RoleType.ACCOUNT_ADMIN));
    assert.ok(!SUPERVISORY_ROLES.includes(RoleType.COLLECTOR));
  });
});
