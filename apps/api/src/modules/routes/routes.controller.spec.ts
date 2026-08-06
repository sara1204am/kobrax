import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RoutesController } from './routes.controller';

/**
 * El cobrador tiene que poder pasar las puertas de SU jornada. Los specs del service no ven esto:
 * el scope real lo decide `collectorFor`, pero `@Roles` corre antes y puede cerrar la puerta igual.
 * Fue exactamente el bug de `POST /routes` (pedía ROUTE_WRITE, que el COLLECTOR no tiene): el flujo
 * de armar la ruta desde el mapa moría en 403 con todo el service correcto y todos los tests verdes.
 */
describe('RoutesController · puertas del cobrador', () => {
  const collector = ROLE_PERMISSIONS[RoleType.COLLECTOR] as string[];

  // Lo que el cobrador hace solo en campo: arma su ruta, la mide, la ordena y la ejecuta.
  const suyas = [
    'create',
    'generate',
    'list',
    'findOne',
    'preview',
    'optimize',
    'addStop',
    'removeStop',
    'updateStop',
    'updateStatus',
  ] as const;

  for (const metodo of suyas) {
    it(`el COLLECTOR puede pasar la puerta de ${metodo}`, () => {
      const handler = RoutesController.prototype[metodo] as unknown as object;
      const requeridos = (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ?? [];
      assert.deepEqual(
        requeridos.filter((p) => !collector.includes(p)),
        [],
      );
    });
  }
});
