import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { ROLES_KEY } from './auth/decorators/roles.decorator';
import { AgendaController } from './agenda/agenda.controller';
import { CasesController } from './cases/cases.controller';
import { CatalogsController } from './catalogs/catalogs.controller';
import { ClientsController } from './clients/clients.controller';
import { CreditsController } from './credits/credits.controller';
import { FieldController } from './field-ops/field.controller';
import { PaymentsController } from './payments/payments.controller';
import { PortfolioImportController } from './imports/portfolio-import.controller';
import { RoutesController } from './routes/routes.controller';

/**
 * Las puertas (`@Roles`) del camino del cobrador, contra los permisos que realmente tiene.
 *
 * Nace del bug del 2026-08-06: el endpoint POST de routes exigía ROUTE_WRITE, que el COLLECTOR no
 * tiene, y armar la ruta desde el mapa moría en 403 — con el service correcto, el scope correcto y
 * los 462 tests en verde. Ningún spec miraba el decorador, sólo el service.
 *
 * Es lo mínimo que hace falta para que la clase entera de bug no vuelva: si alguien pone una puerta
 * que el cobrador no puede pasar en algo que el cobrador usa todos los días, falla acá y no en el
 * teléfono de la usuaria. El scope fino (para quién, sobre qué fila) lo siguen decidiendo los
 * services — esto sólo verifica que la puerta deje entrar.
 */

/** Lo que el móvil del cobrador llama. Un método acá = una pantalla que se rompe si la puerta sube. */
const CAMINO_DEL_COBRADOR: [string, new (...args: never[]) => object, string[]][] = [
  // Su jornada: la arma desde el mapa, la mide, la ordena y la ejecuta.
  ['routes', RoutesController, ['create', 'generate', 'list', 'findOne', 'preview', 'optimize', 'addStop', 'removeStop', 'updateStop', 'updateStatus']],
  // Su agenda del día: crear, ver, ejecutar, editar, reagendar, cancelar, eliminar.
  ['agenda', AgendaController, ['list', 'overdue', 'findOne', 'create', 'update', 'complete', 'postpone', 'cancel', 'reschedule', 'remove']],
  // Los casos que gestiona y la actividad que registra sobre ellos.
  ['cases', CasesController, ['list', 'findOne', 'addActivity']],
  // Su cartera: la ve, la da de alta en campo y le corrige datos.
  ['clients', ClientsController, ['list', 'findOne', 'create', 'update']],
  ['credits', CreditsController, ['list', 'findOne', 'create', 'update']],
  // Cobra en campo y consulta lo cobrado (incluye el cobro por QR/link, que aún no usa el móvil).
  ['payments', PaymentsController, ['register', 'list', 'findOne', 'createRequest', 'getRequest']],
  // Medios de pago y bancos para registrar el pago (los lee, no los administra).
  ['catalogs', CatalogsController, ['list']],
  // La visita y su evidencia.
  ['field', FieldController, ['createVisit', 'addEvidence']],
  // El import del día: el cobrador independiente es su propio dueño.
  ['imports', PortfolioImportController, ['getConfig', 'patchConfig', 'run']],
];

describe('Puertas del camino del cobrador', () => {
  const collector = ROLE_PERMISSIONS[RoleType.COLLECTOR] as string[];

  for (const [modulo, controller, metodos] of CAMINO_DEL_COBRADOR) {
    for (const metodo of metodos) {
      it(`COLLECTOR pasa ${modulo}.${metodo}`, () => {
        const handler = (controller.prototype as Record<string, unknown>)[metodo];
        assert.ok(handler, `${modulo}.${metodo} no existe — el spec quedó viejo`);
        const requeridos = (Reflect.getMetadata(ROLES_KEY, handler as object) as string[] | undefined) ?? [];
        assert.deepEqual(
          requeridos.filter((p) => !collector.includes(p)),
          [],
          `${modulo}.${metodo} exige ${requeridos.join(', ')} y el cobrador no lo tiene`,
        );
      });
    }
  }
});

/**
 * La otra mitad: lo que el cobrador NO debe poder hacer. Sin esto, "arreglar" un 403 dándole el
 * permiso al rol pasaría inadvertido — y administrar la cuenta o aprobar pagos propios no es
 * autoservicio, es un agujero.
 */
describe('Puertas que el cobrador NO debe pasar', () => {
  const collector = ROLE_PERMISSIONS[RoleType.COLLECTOR] as string[];

  const VEDADAS: [string, new (...args: never[]) => object, string][] = [
    ['cases', CasesController, 'assign'], // asignar cartera es del supervisor
    ['cases', CasesController, 'close'], // cerrar un caso no lo decide quien cobra
    ['payments', PaymentsController, 'confirmRequest'], // confirmar el cobro que uno mismo pidió
    ['catalogs', CatalogsController, 'create'], // el ABM de catálogos es de la cuenta
  ];

  for (const [modulo, controller, metodo] of VEDADAS) {
    it(`COLLECTOR NO pasa ${modulo}.${metodo}`, () => {
      const handler = (controller.prototype as Record<string, unknown>)[metodo];
      assert.ok(handler, `${modulo}.${metodo} no existe — el spec quedó viejo`);
      const requeridos = (Reflect.getMetadata(ROLES_KEY, handler as object) as string[] | undefined) ?? [];
      assert.ok(
        requeridos.some((p) => !collector.includes(p)),
        `${modulo}.${metodo} quedó abierto al cobrador`,
      );
    });
  }
});
