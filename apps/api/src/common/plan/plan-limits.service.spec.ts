import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlanLimitsService } from './plan-limits.service';
import { rejectsWithCode } from '../../modules/auth/auth-test-utils';

/** Qué le pregunta el servicio a la base, para poder afirmar sobre las consultas y no sólo sobre el resultado. */
interface Espia {
  creditWhere?: Record<string, unknown>;
  clientWhere?: Record<string, unknown>;
}

function makeService(
  opts: {
    planCode?: string;
    override?: unknown;
    credits?: number;
    clients?: number;
    users?: number;
  } = {},
) {
  const espia: Espia = {};
  const tx = {
    account: {
      findFirst: async () => ({
        planCode: opts.planCode ?? 'FREE',
        limitsOverride: opts.override ?? null,
      }),
    },
    credit: {
      count: async (args: { where: Record<string, unknown> }) => {
        espia.creditWhere = args.where;
        return opts.credits ?? 0;
      },
    },
    client: {
      count: async (args: { where: Record<string, unknown> }) => {
        espia.clientWhere = args.where;
        return opts.clients ?? 0;
      },
    },
    userAccount: { count: async () => opts.users ?? 0 },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const service = new PlanLimitsService(prisma as never, { accountId: 'acc-A' } as never);
  return { service, tx: tx as never, espia };
}

describe('PlanLimitsService.limitsOf', () => {
  it('los topes salen del plan de la cuenta', async () => {
    const { service, tx } = makeService({ planCode: 'PROFESSIONAL' });
    assert.equal((await service.limitsOf(tx)).credits, 1000);
  });

  it('la excepción negociada le gana al plan', async () => {
    const { service, tx } = makeService({ planCode: 'FREE', override: { credits: 500 } });
    const limits = await service.limitsOf(tx);
    assert.equal(limits.credits, 500);
    assert.equal(limits.users, 1, 'lo que no se negoció sigue siendo el del plan');
  });
});

describe('PlanLimitsService.usage', () => {
  it('🔴 el crédito cobrado NO ocupa lugar', async () => {
    // Si contara, el cliente que cobra bien sería castigado por su propio éxito (LIMITES §5.2).
    const { service, tx, espia } = makeService();
    await service.usage('credits', tx);
    assert.deepEqual(espia.creditWhere, {
      deletedAt: null,
      status: { in: ['ACTIVE', 'DEFAULTED', 'RESTRUCTURED'] },
    });
  });

  it('el cliente borrado tampoco', async () => {
    const { service, tx, espia } = makeService();
    await service.usage('clients', tx);
    assert.deepEqual(espia.clientWhere, { deletedAt: null });
  });
});

describe('PlanLimitsService.assertRoom', () => {
  it('deja pasar mientras entre', async () => {
    const { service, tx } = makeService({ credits: 19 }); // FREE: 20
    await service.assertRoom('credits', tx);
  });

  it('frena en el tope, con el número adentro para que la pantalla lo diga', async () => {
    const { service, tx } = makeService({ credits: 20 });
    await rejectsWithCode(service.assertRoom('credits', tx), 'PLAN_LIMIT_REACHED');
  });

  it('🔴 el lote se rechaza ENTERO, no hasta llenar', async () => {
    // Importar «hasta donde entre» deja al cobrador saliendo a la calle con una cartera
    // incompleta sin enterarse (LIMITES §5.2, Pregunta 10).
    const { service, tx } = makeService({ credits: 15 }); // quedan 5 de 20
    await rejectsWithCode(service.assertRoom('credits', tx, { cuantos: 6 }), 'PLAN_LIMIT_REACHED');
    await service.assertRoom('credits', tx, { cuantos: 5 });
  });

  it('🔴 `soft` no rechaza lo que ya ocurrió en la calle', async () => {
    // El préstamo se acordó frente al deudor y llega al reconectar: rechazarlo es borrar trabajo
    // hecho, y el cobrador se entera por un renglón rojo horas después.
    const { service, tx } = makeService({ credits: 999 });
    await service.assertRoom('credits', tx, { soft: true });
  });

  it('sin tope no frena nada', async () => {
    const { service, tx } = makeService({ override: { credits: null }, credits: 10_000 });
    await service.assertRoom('credits', tx, { cuantos: 5000 });
  });
});

describe('PlanLimitsService.roomLeft', () => {
  it('dice cuántos entran todavía, para poder avisar antes de confirmar', async () => {
    const { service, tx } = makeService({ credits: 15 });
    assert.equal(await service.roomLeft('credits', tx), 5);
  });

  it('nunca es negativo: una cuenta por encima del tope tiene cero lugar, no menos', async () => {
    // Pasa de verdad al bajar de plan (LIMITES §8.1): se congela, y el número no puede mentir.
    const { service, tx } = makeService({ credits: 50 });
    assert.equal(await service.roomLeft('credits', tx), 0);
  });

  it('sin tope no hay número que dar', async () => {
    const { service, tx } = makeService({ override: { credits: null } });
    assert.equal(await service.roomLeft('credits', tx), null);
  });
});
