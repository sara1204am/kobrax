import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AccountStatus, PrismaClient } from '@prisma/client';
import { PLANS, effectiveLimits, type PlanCode } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';

/**
 * La palanca de operación (LIMITES-BUILD-PLAN §L3): cambiar el plan, la excepción negociada y la
 * suspensión de una cuenta **sin SQL a mano**. La consume `plan-cli.ts`
 * (`pnpm --filter @kobrax/api plan:set` / `account:suspend`).
 *
 * ponytail: script, no pantalla interna. Un panel de administración de Kobrax es otro producto,
 * con su login y sus permisos, para algo que hoy pasa una vez por semana.
 */
@Injectable()
export class PlanToolsService {
  private readonly logger = new Logger(PlanToolsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cambia el plan y/o la excepción negociada. `override`:
   * - un JSON con los topes propios (`{"users":40}`) — **reemplaza** la excepción entera, no
   *   mezcla: lo que rige tiene que poder leerse de un solo lugar, no reconstruirse de capas;
   * - la palabra `null` — la borra y la cuenta vuelve a los topes puros de su plan.
   */
  async setPlan(input: { accountId: string; plan?: string; override?: string }) {
    const { accountId } = input;
    if (input.plan === undefined && input.override === undefined) {
      throw new Error('Nada que cambiar: pasá --plan y/o --override.');
    }

    let plan: PlanCode | undefined;
    if (input.plan !== undefined) {
      if (!(input.plan in PLANS)) {
        throw new Error(`Plan desconocido: ${input.plan}. Válidos: ${Object.keys(PLANS).join(', ')}.`);
      }
      plan = input.plan as PlanCode;
    }

    // `undefined` = no tocar; `null` = borrar la excepción. Son cosas distintas.
    let override: Record<string, number | null> | null | undefined;
    if (input.override !== undefined) override = parseOverride(input.override);

    return this.prisma.withTenant(accountId, async (tx) => {
      const before = await this.find(tx, accountId);
      const updated = await tx.account.update({
        where: { id: accountId },
        data: {
          ...(plan !== undefined ? { planCode: plan } : {}),
          // `Prisma.DbNull` y no `null`: para un campo Json, `null` a secas es ambiguo y Prisma
          // lo rechaza — el NULL de SQL se pide con nombre y apellido.
          ...(override !== undefined
            ? { limitsOverride: override === null ? Prisma.DbNull : override }
            : {}),
        },
      });
      await this.auditar(tx, accountId, 'plan:set', {
        before: { planCode: before.planCode, limitsOverride: before.limitsOverride },
        after: { planCode: updated.planCode, limitsOverride: updated.limitsOverride },
      });
      return {
        accountId,
        businessName: before.businessName,
        planCode: updated.planCode,
        limitsOverride: updated.limitsOverride,
        limits: effectiveLimits(updated.planCode, updated.limitsOverride),
      };
    });
  }

  /**
   * Suspende (o con `lift`, levanta la suspensión de) una cuenta. La suspensión corta el login
   * entero (`auth.service` rechaza cuentas no activas); la caída a FREE del que no paga es de L4,
   * no de acá — el corte seco queda para quien ya no responde.
   */
  async suspend(accountId: string, opts: { lift?: boolean } = {}) {
    const status: AccountStatus = opts.lift ? 'ACTIVE' : 'SUSPENDED';
    return this.prisma.withTenant(accountId, async (tx) => {
      const before = await this.find(tx, accountId);
      if (before.status === status) {
        this.logger.warn(`La cuenta ya estaba ${status}; no se escribió nada.`);
        return { accountId, businessName: before.businessName, status: before.status };
      }
      const updated = await tx.account.update({ where: { id: accountId }, data: { status } });
      await this.auditar(tx, accountId, opts.lift ? 'account:suspend --lift' : 'account:suspend', {
        before: { status: before.status },
        after: { status: updated.status },
      });
      return { accountId, businessName: before.businessName, status: updated.status };
    });
  }

  private async find(tx: PrismaClient, accountId: string) {
    const account = await tx.account.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { planCode: true, limitsOverride: true, status: true, businessName: true },
    });
    if (!account) throw new Error(`No existe la cuenta ${accountId} (o está borrada).`);
    return account;
  }

  private auditar(
    tx: PrismaClient,
    accountId: string,
    via: string,
    change: { before: unknown; after: unknown },
  ): Promise<void> {
    return auditAsOwner(tx, this.logger, accountId, via, change);
  }
}

/**
 * `audit_logs.user_id` es NOT NULL y en una tarea de sistema no hay request: la entrada va
 * **a nombre del dueño** de la cuenta, con `via` diciendo que la mano fue el CLI o el job. Sin
 * dueño (no debería pasar) se loguea y no se audita — la operación vale más que su rastro.
 * La usan la palanca (L3) y el job de vencimientos (L4).
 */
export async function auditAsOwner(
  tx: PrismaClient,
  logger: Logger,
  accountId: string,
  via: string,
  change: { before: unknown; after: unknown },
): Promise<void> {
  const owner = await tx.userAccount.findFirst({ where: { isOwner: true }, select: { userId: true } });
  if (!owner) {
    logger.warn(`Cuenta ${accountId} sin dueño: el cambio quedó sin entrada de auditoría.`);
    return;
  }
  await tx.auditLog.create({
    data: {
      accountId,
      userId: owner.userId,
      action: 'UPDATE',
      entity: 'account',
      entityId: accountId,
      before: change.before as never,
      after: { ...(change.after as Record<string, unknown>), via } as never,
    },
  });
}

/** El JSON del operador es entrada de teclado: se valida acá, con el error diciendo qué corregir. */
export function parseOverride(raw: string): Record<string, number | null> | null {
  if (raw.trim() === 'null') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`--override no es JSON válido: ${raw}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('--override tiene que ser un objeto ({"users":40}) o null para borrarlo.');
  }
  const validKeys = Object.keys(PLANS.FREE.limits);
  for (const [key, value] of Object.entries(parsed)) {
    // Una clave con typo que `effectiveLimits` ignoraría en silencio es una trampa para el
    // operador: creería que negoció 40 usuarios y la cuenta seguiría con 1.
    if (!validKeys.includes(key)) {
      throw new Error(`--override: clave desconocida «${key}». Válidas: ${validKeys.join(', ')}.`);
    }
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new Error(`--override: «${key}» tiene que ser un número ≥ 0 o null.`);
    }
  }
  return parsed as Record<string, number | null>;
}
