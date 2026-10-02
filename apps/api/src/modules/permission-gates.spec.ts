import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission, ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { ROLES_KEY } from './auth/decorators/roles.decorator';
import { AgendaController } from './agenda/agenda.controller';
import { CasesController } from './cases/cases.controller';
import { MoraController } from './mora/mora.controller';
import { ExportsController } from './exports/exports.controller';
import { CatalogsController } from './catalogs/catalogs.controller';
import { ClientsController } from './clients/clients.controller';
import { CreditsController } from './credits/credits.controller';
import { FieldController } from './field-ops/field.controller';
import { PaymentsController } from './payments/payments.controller';
import { PortfolioImportController } from './imports/portfolio-import.controller';
import { RoutesController } from './routes/routes.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { ClientImportController } from './clients/import/client-import.controller';

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
  // La Central de Mora: sus créditos en mora (el service lo acota a sus casos).
  ['mora', MoraController, ['list', 'findOne', 'byCase', 'branches', 'episodes', 'metrics', 'promises', 'notes', 'addNote', 'addActivity', 'exportCsv', 'exportPdf']],
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

/**
 * 🔴 Exportar Mora lo puede todo rol que ve Mora, pero **no** a través de `report:export`: ese permiso abre
 * los exports de la cuenta (`/exports/cases|clients|locations|backup`), que no filtran por alcance y
 * entregan datos personales en claro. Si alguien "unifica" los dos permisos, el cobrador baja la cartera
 * entera — este spec lo frena.
 */
describe('Exportar Mora (case:export)', () => {
  const ROLES_CON_MORA = [RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR, RoleType.VIEWER];

  for (const role of ROLES_CON_MORA) {
    it(`${role} ve Mora y puede exportarla`, () => {
      const perms = ROLE_PERMISSIONS[role] as string[];
      assert.ok(perms.includes(Permission.CASE_READ) && perms.includes(Permission.CASE_EXPORT));
    });
  }

  it('el cobrador y el supervisor siguen SIN report:export (los exports de la cuenta)', () => {
    assert.ok(!(ROLE_PERMISSIONS[RoleType.COLLECTOR] as string[]).includes(Permission.REPORT_EXPORT));
    assert.ok(!(ROLE_PERMISSIONS[RoleType.SUPERVISOR] as string[]).includes(Permission.REPORT_EXPORT));
  });

  it('los exports de Mora exigen case:read Y case:export; los de la cuenta siguen en report:export', () => {
    for (const metodo of ['exportCsv', 'exportPdf']) {
      const handler = (MoraController.prototype as unknown as Record<string, unknown>)[metodo];
      const requeridos = (Reflect.getMetadata(ROLES_KEY, handler as object) as string[]) ?? [];
      assert.deepEqual([...requeridos].sort(), [Permission.CASE_EXPORT, Permission.CASE_READ].sort());
    }
    const cuenta = (Reflect.getMetadata(ROLES_KEY, ExportsController) as string[]) ?? [];
    assert.deepEqual(cuenta, [Permission.REPORT_EXPORT]);
  });
});

/**
 * La puerta del dashboard (W8).
 *
 * Va aparte porque su `@Roles` está en la **clase** y no en cada método: el `RolesGuard` los lee con
 * `getAllAndOverride([handler, class])`, así que protege igual — pero un spec que mirara sólo el
 * método daría verde sobre un controlador completamente abierto.
 *
 * Verifica las dos mitades: que la gerencia entre y que el cobrador no. Un tablero con la cartera
 * entera del tenant, el ranking de sus compañeros y lo recaudado por cada uno **no es una pantalla
 * de campo**.
 */
describe('Puerta del dashboard', () => {
  const requeridos = (Reflect.getMetadata(ROLES_KEY, AnalyticsController) as string[] | undefined) ?? [];

  it('analytics exige report:read a nivel de clase', () => {
    assert.deepEqual(requeridos, ['report:read']);
  });

  it('el cobrador NO entra al tablero de la gerencia', () => {
    assert.ok(!(ROLE_PERMISSIONS[RoleType.COLLECTOR] as string[]).includes('report:read'));
  });

  for (const rol of [RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.AUDITOR, RoleType.VIEWER]) {
    it(`${rol} sí entra`, () => {
      // Si un día alguien le saca `report:read` a uno de estos cuatro, la pantalla entera se le
      // vuelve un 403 y el síntoma aparece lejos de la causa.
      const permisos = ROLE_PERMISSIONS[rol] as string[];
      assert.deepEqual(
        requeridos.filter((p) => !permisos.includes(p)),
        [],
      );
    });
  }
});

/**
 * Quién asigna y quién importa (decisiones del 2026-09-30).
 *
 * `assignment:write` es lo que separa elegir el responsable de un crédito de sólo cobrarlo. El
 * cobrador importa su cartera sin él; el supervisor importa y reparte. Las dos puertas de abajo son
 * las que se abrieron al darle `client:import` al supervisor, y no tenían que abrirse.
 */
describe('Asignación e importación por rol', () => {
  const tiene = (rol: RoleType, p: Permission) => (ROLE_PERMISSIONS[rol] as string[]).includes(p);
  const puerta = (ctrl: new (...args: never[]) => object, metodo: string) =>
    (Reflect.getMetadata(ROLES_KEY, (ctrl.prototype as Record<string, object>)[metodo]!) as string[] | undefined) ?? [];

  it('el cobrador importa pero NO asigna', () => {
    assert.ok(tiene(RoleType.COLLECTOR, Permission.CLIENT_IMPORT));
    assert.ok(!tiene(RoleType.COLLECTOR, Permission.ASSIGNMENT_WRITE));
  });

  for (const rol of [RoleType.SUPERVISOR, RoleType.MANAGER, RoleType.ACCOUNT_ADMIN]) {
    it(`${rol} importa y asigna`, () => {
      assert.ok(tiene(rol, Permission.CLIENT_IMPORT));
      assert.ok(tiene(rol, Permission.ASSIGNMENT_WRITE));
    });
  }

  it('P10 · el documento crudo de una corrida pide además client:pii:read (el supervisor no lo baja)', () => {
    assert.deepEqual(puerta(PortfolioImportController, 'runFile'), [Permission.CLIENT_IMPORT, Permission.CLIENT_PII_READ]);
    assert.ok(!tiene(RoleType.SUPERVISOR, Permission.CLIENT_PII_READ));
  });

  it('P11 · el import de clientes pide además client:write (el supervisor no lo usa)', () => {
    assert.deepEqual(puerta(ClientImportController, 'run'), [Permission.CLIENT_IMPORT, Permission.CLIENT_WRITE]);
    assert.ok(!tiene(RoleType.SUPERVISOR, Permission.CLIENT_WRITE));
  });
});
