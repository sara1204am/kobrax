import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardsService } from './dashboards.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { current?: Record<string, unknown>; userId?: string; permissions?: string[] } = {}) {
  const calls = {
    updateMany: [] as Record<string, unknown>[],
    deleteWidgets: [] as unknown[],
    createWidgets: [] as Record<string, unknown>[][],
    update: [] as Record<string, unknown>[],
  };
  const dashboard = {
    id: 'd1',
    name: 'Vista general',
    description: null,
    isDefault: false,
    createdBy: 'u1',
    deletedAt: null,
    widgets: [],
    ...opts.current,
  };
  // Lo último creado gana en la relectura: el service crea y vuelve a leer para devolver el
  // tablero con sus widgets, y un doble que devolviera siempre el original taparía justo lo que
  // estas pruebas miran (el nombre de la copia, el predeterminado apagado).
  let created: Record<string, unknown> | null = null;
  const tx = {
    dashboard: {
      findFirst: async () => (opts.current === null ? null : dashboard),
      findFirstOrThrow: async () => created ?? dashboard,
      findMany: async () => [dashboard],
      create: async (args: { data: Record<string, unknown> }) => {
        created = { ...dashboard, ...args.data, id: 'nuevo', widgets: [] };
        return created;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        calls.update.push(args.data);
        return dashboard;
      },
      updateMany: async (args: { where: Record<string, unknown> }) => {
        calls.updateMany.push(args.where);
        return { count: 1 };
      },
    },
    dashboardWidget: {
      deleteMany: async (args: unknown) => {
        calls.deleteWidgets.push(args);
        return { count: 0 };
      },
      createMany: async (args: { data: Record<string, unknown>[] }) => {
        calls.createWidgets.push(args.data);
        return { count: args.data.length };
      },
    },
  };
  const prisma = { withTenant: <T>(_a: string, fn: (t: unknown) => Promise<T>) => fn(tx) };
  const tenant = {
    accountId: 'acc-1',
    userId: opts.userId ?? 'u1',
    can: (p: string) => (opts.permissions ?? []).includes(p),
  };
  const audit = { record: async () => undefined };
  return { service: new DashboardsService(prisma as never, tenant as never, audit as never), calls };
}

describe('quién puede modificar un tablero', () => {
  it('🔴 el que NO lo creó no lo toca, aunque pueda verlo', async () => {
    // `report:read` lo tienen VIEWER y AUDITOR, que son roles de sólo lectura: sin esta regla
    // podrían borrar el tablero que abre toda la empresa.
    const { service } = makeService({ userId: 'otro' });
    await rejectsWithCode(() => service.update('d1', { name: 'mío ahora' }), 'AUTH_002');
    await rejectsWithCode(() => service.remove('d1'), 'AUTH_002');
  });

  it('el admin de la cuenta sí, aunque no lo haya creado', async () => {
    const { service } = makeService({ userId: 'otro', permissions: ['account:write'] });
    await service.update('d1', { name: 'ordenado' });
  });

  it('quien lo creó, siempre', async () => {
    const { service, calls } = makeService({ userId: 'u1' });
    await service.update('d1', { name: 'mi tablero' });
    assert.equal(calls.update[0]!.name, 'mi tablero');
  });
});

describe('el layout se reemplaza entero', () => {
  it('borra los widgets viejos antes de escribir los nuevos', async () => {
    // Un arrastre mueve varios widgets a la vez: actualizarlos uno por uno deja estados
    // intermedios con dos widgets pisándose.
    const { service, calls } = makeService();
    await service.update('d1', {
      widgets: [{ type: 'kpi', x: 0, y: 0, w: 2, h: 2 }, { type: 'donut_chart', x: 2, y: 0, w: 4, h: 4 }],
    });
    assert.equal(calls.deleteWidgets.length, 1);
    assert.equal(calls.createWidgets[0]!.length, 2);
    assert.equal(calls.createWidgets[0]![0]!.accountId, 'acc-1');
  });
});

describe('predeterminado', () => {
  it('🔴 marcar uno apaga al anterior, en la misma transacción', async () => {
    // Dos predeterminados y la pantalla abre el que la base devuelva primero: un tablero distinto
    // cada día sin que nadie haya tocado nada.
    const { service, calls } = makeService();
    await service.update('d1', { isDefault: true });
    assert.deepEqual(calls.updateMany[0], { isDefault: true, id: { not: 'd1' } });
  });

  it('una copia nunca nace predeterminada', async () => {
    // Duplicar es partir de algo que sirve, no cambiarle el tablero a toda la empresa.
    const { service } = makeService();
    const copy = await service.duplicate('d1');
    assert.equal(copy.isDefault, false);
    assert.match(copy.name, /copia/);
  });
});

describe('tablero inexistente', () => {
  it('404 y no 500', async () => {
    const { service } = makeService({ current: null as never });
    await rejectsWithCode(() => service.findOne('nope'), 'RESOURCE_NOT_FOUND');
  });
});
