import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardsService } from './dashboards.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(
  opts: { current?: Record<string, unknown>; userId?: string; permissions?: string[]; widgetIds?: string[]; existing?: number } = {},
) {
  const calls = {
    updateMany: [] as Record<string, unknown>[],
    deleteWidgets: [] as unknown[],
    createWidgets: [] as Record<string, unknown>[][],
    update: [] as Record<string, unknown>[],
    lock: [] as unknown[],
    creates: [] as Record<string, unknown>[],
    sampleLock: [] as unknown[],
  };
  const dashboard = {
    id: 'd1',
    name: 'Vista general',
    description: null,
    isDefault: false,
    createdBy: 'u1',
    ownerUserId: 'u1',
    deletedAt: null,
    widgets: [],
    ...opts.current,
  };
  // Lo último creado gana en la relectura: el service crea y vuelve a leer para devolver el
  // tablero con sus widgets, y un doble que devolviera siempre el original taparía justo lo que
  // estas pruebas miran (el nombre de la copia, el predeterminado apagado).
  let created: Record<string, unknown> | null = null;
  const tx = {
    // El `select ... for update` que traba el tablero antes de reemplazarle el layout.
    $queryRaw: async (...args: unknown[]) => {
      calls.lock.push(args);
      return [];
    },
    // La traba por persona de los tableros de ejemplo (`pg_advisory_xact_lock`): va por `$executeRaw`.
    $executeRaw: async (...args: unknown[]) => {
      calls.sampleLock.push(args);
      return 0;
    },
    dashboard: {
      // Honra el filtro de dueño igual que la base: el tablero de otra persona NO aparece.
      findFirst: async (args?: { where?: { ownerUserId?: string } }) => {
        if (opts.current === null) return null;
        if (args?.where?.ownerUserId !== dashboard.ownerUserId) return null;
        return dashboard;
      },
      count: async () => opts.existing ?? 1,
      findFirstOrThrow: async () => created ?? dashboard,
      findMany: async () => [dashboard],
      create: async (args: { data: Record<string, unknown> }) => {
        calls.creates.push(args.data);
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
      // Los ids que el tablero YA tiene: son los únicos que un pedido puede conservar.
      findMany: async () => (opts.widgetIds ?? []).map((id) => ({ id })),
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
  void opts.permissions;
  const audit = { record: async () => undefined };
  return { service: new DashboardsService(prisma as never, tenant as never, audit as never), calls };
}

describe('los tableros son de cada persona', () => {
  it('🔴 el tablero de otra persona no existe para ti: 404, no 403, y ni el admin lo toca', async () => {
    // Cada quien arma sus pestañas con sus indicadores. Confirmar con un 403 que el tablero existe ya es contar de más.
    const { service } = makeService({ userId: 'otro', permissions: ['account:write'] });
    await rejectsWithCode(() => service.findOne('d1'), 'RESOURCE_NOT_FOUND');
    await rejectsWithCode(() => service.update('d1', { name: 'mío ahora' }), 'RESOURCE_NOT_FOUND');
    await rejectsWithCode(() => service.remove('d1'), 'RESOURCE_NOT_FOUND');
    await rejectsWithCode(() => service.duplicate('d1'), 'RESOURCE_NOT_FOUND');
  });

  it('quien es el dueño, sí', async () => {
    const { service, calls } = makeService({ userId: 'u1' });
    await service.update('d1', { name: 'mi tablero' });
    assert.equal(calls.update[0]!.name, 'mi tablero');
  });

  it('lo que se crea nace con su dueño', async () => {
    const { service, calls } = makeService({ userId: 'u1' });
    await service.create({ name: 'Cobranza' });
    assert.equal(calls.creates[0]!.ownerUserId, 'u1');
    await service.duplicate('d1');
    assert.equal(calls.creates[1]!.ownerUserId, 'u1');
  });
});

describe('los tres tableros de ejemplo', () => {
  it('quien no tiene ninguno recibe Indicadores, Gráficos y Agenda, suyos y con widgets', async () => {
    const { service, calls } = makeService({ existing: 0 });
    await service.list();
    assert.deepEqual(calls.creates.map((c) => c.name), ['Indicadores', 'Gráficos', 'Agenda']);
    assert.ok(calls.creates.every((c) => c.ownerUserId === 'u1'));
    // El primero es el predeterminado; los demás no.
    assert.deepEqual(calls.creates.map((c) => c.isDefault), [true, false, false]);
    assert.equal(calls.createWidgets.length, 3);
    assert.ok(calls.createWidgets.every((w) => w.length > 0 && w.every((x) => x.accountId === 'acc-1')));
    // Con traba por persona: dos pedidos a la vez no los duplican.
    assert.equal(calls.sampleLock.length, 1);
  });

  it('quien ya tiene (o borró los suyos) no los ve reaparecer', async () => {
    const { service, calls } = makeService({ existing: 2 });
    await service.list();
    assert.equal(calls.creates.length, 0);
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

  it('el widget conserva su id, y uno ajeno no se cuela', async () => {
    // Los ids son la `key` de la grilla del panel. Si cambian en cada guardado, un refresh caído en
    // mitad de un arrastre deja a la grilla sin posiciones y NO dibuja ni un widget.
    const { service, calls } = makeService({ widgetIds: ['w-mio'] });
    await service.update('d1', {
      widgets: [
        { id: 'w-mio', type: 'kpi', x: 0, y: 0, w: 2, h: 2 },
        { id: 'w-de-otro-tablero', type: 'kpi', x: 2, y: 0, w: 2, h: 2 },
      ],
    });
    assert.equal(calls.createWidgets[0]![0]!.id, 'w-mio');
    // Sin id propio: lo pone la base. Que un pedido pudiera fijarlo sería chocar la clave primaria
    // —o pisar el widget de otro tablero— desde afuera.
    assert.equal(calls.createWidgets[0]![1]!.id, undefined);
  });

  it('traba el tablero antes de reemplazarlo', async () => {
    // Sin la traba, dos parches del mismo tablero a la vez borran cada uno las filas viejas sin ver
    // las del otro, y las dos tandas quedan: el tablero se ve DUPLICADO entero.
    const { service, calls } = makeService();
    await service.update('d1', { widgets: [{ type: 'kpi', x: 0, y: 0, w: 2, h: 2 }] });
    assert.equal(calls.lock.length, 1);
  });
});

describe('predeterminado', () => {
  it('🔴 marcar uno apaga al anterior, en la misma transacción', async () => {
    // Dos predeterminados y la pantalla abre el que la base devuelva primero: un tablero distinto
    // cada día sin que nadie haya tocado nada.
    const { service, calls } = makeService();
    await service.update('d1', { isDefault: true });
    // Y sólo el de ESTA persona: el predeterminado de otra no se toca.
    assert.deepEqual(calls.updateMany[0], { isDefault: true, ownerUserId: 'u1', id: { not: 'd1' } });
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
