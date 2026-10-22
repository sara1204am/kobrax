import { Injectable, Logger } from '@nestjs/common';
import type { AccountRequest, Prisma, PrismaClient } from '@prisma/client';
import type { AccountRequestInfo } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../common/mail/mail.service';
import { CreateAccountRequestDto } from './dto/account-request.dto';
import {
  accountNotFound,
  requestAlreadyPending,
  requestConfirmMismatch,
  requestNotFound,
  requestPlanInvalid,
} from './accounts.errors';

const PLAN_NAME: Record<string, string> = { FREE: 'Free', PROFESSIONAL: 'Professional', BUSINESS: 'Business', ENTERPRISE: 'Enterprise' };

type Payload = { plan?: unknown; note?: unknown };
const asPayload = (v: unknown): Payload => (v && typeof v === 'object' ? (v as Payload) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function serializeRequest(r: AccountRequest): AccountRequestInfo {
  const p = asPayload(r.payload);
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    plan: text(p.plan),
    note: text(p.note),
    handledNote: r.handledNote,
    createdAt: r.createdAt.toISOString(),
    handledAt: r.handledAt?.toISOString() ?? null,
  };
}

/**
 * Lo que la cuenta le pide a Kobrax: cambiar de plan o darse de baja (Refactor de Cuenta · F7).
 *
 * El plan lo gestiona Kobrax —no hay cobro ni cambio de plan dentro del producto—, así que esto es un **aviso con
 * estado**: queda registrado, se le manda un correo al equipo y Kobrax lo atiende por consola (`request:handle`). Nada
 * cambia en la cuenta por pedirlo.
 */
@Injectable()
export class AccountRequestsService {
  private readonly logger = new Logger(AccountRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async list(): Promise<AccountRequestInfo[]> {
    const rows = await this.tx((tx) => tx.accountRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }));
    return rows.map(serializeRequest);
  }

  async create(dto: CreateAccountRequestDto): Promise<AccountRequestInfo> {
    const { created, account } = await this.tx(async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: this.tenant.accountId, deletedAt: null },
        select: { businessName: true, planCode: true },
      });
      if (!account) throw accountNotFound();

      // Se valida acá y no en el DTO porque depende de la cuenta: el plan pedido no puede ser el que ya tiene, y para
      // darse de baja hay que escribir el nombre del negocio (que sólo el servidor sabe).
      if (dto.type === 'PLAN_CHANGE' && dto.plan === account.planCode) throw requestPlanInvalid();
      if (dto.type === 'CLOSURE' && (dto.confirmName ?? '').trim().toLowerCase() !== account.businessName.trim().toLowerCase()) {
        throw requestConfirmMismatch();
      }

      const pending = await tx.accountRequest.findFirst({ where: { type: dto.type, status: 'PENDING' }, select: { id: true } });
      if (pending) throw requestAlreadyPending();

      const payload: Prisma.InputJsonValue = {
        ...(dto.type === 'PLAN_CHANGE' ? { plan: dto.plan } : {}),
        ...(dto.note?.trim() ? { note: dto.note.trim() } : {}),
      };
      try {
        const created = await tx.accountRequest.create({
          data: { accountId: this.tenant.accountId, type: dto.type, payload, requestedBy: this.tenant.userId ?? '' },
        });
        return { created, account };
      } catch (err) {
        // Otro administrador la pidió en el mismo instante: el único parcial de la base lo frena.
        if ((err as { code?: string }).code === 'P2002') throw requestAlreadyPending();
        throw err;
      }
    });

    await this.audit.record({ entity: 'account_request', entityId: created.id, action: 'CREATE', after: { type: created.type, payload: created.payload } });
    await this.notifyKobrax(created, account);
    return serializeRequest(created);
  }

  /** El aviso al equipo es un correo; si no se puede mandar, el pedido igual quedó registrado y se ve con `request:handle`. */
  private async notifyKobrax(r: AccountRequest, account: { businessName: string; planCode: string }): Promise<void> {
    const to = this.config.mailFrom ?? this.config.smtpUser;
    if (!to) {
      this.logger.warn(`Sin casilla interna configurada: ${account.businessName} pidió ${r.type} (${r.id})`);
      return;
    }
    const p = asPayload(r.payload);
    const what =
      r.type === 'PLAN_CHANGE'
        ? `cambiar de plan: de ${PLAN_NAME[account.planCode] ?? account.planCode} a ${PLAN_NAME[String(p.plan)] ?? String(p.plan)}`
        : 'darse de baja';
    try {
      await this.mail.send(
        to,
        `[Kobrax] ${account.businessName} pidió ${r.type === 'PLAN_CHANGE' ? 'cambiar de plan' : 'darse de baja'}`,
        [
          `La cuenta «${account.businessName}» (${this.tenant.accountId}) pidió ${what}.`,
          ...(text(p.note) ? ['', `Nota: ${text(p.note)}`] : []),
          '',
          `Solicitud: ${r.id}`,
          `Para atenderla: pnpm --filter @kobrax/api request:handle -- --account ${this.tenant.accountId} --request ${r.id} --status HANDLED --note "…"`,
        ].join('\n'),
      );
    } catch (err) {
      this.logger.warn(`No se pudo avisar la solicitud ${r.id}: ${(err as Error).message}`);
    }
  }

  /**
   * La atiende (o rechaza) Kobrax, por consola. Corre sin request: usa el alcance de sistema sobre esa cuenta y deja la
   * entrada de auditoría a nombre del dueño, con `via`, igual que el resto de las herramientas de operación.
   */
  async handle(input: { accountId: string; requestId: string; status: 'HANDLED' | 'REJECTED'; note?: string }): Promise<AccountRequestInfo> {
    const updated = await this.prisma.withSystemTenant(input.accountId, async (tx) => {
      const found = await tx.accountRequest.findFirst({ where: { id: input.requestId, accountId: input.accountId } });
      if (!found) throw requestNotFound();
      if (found.status !== 'PENDING') throw requestNotFound();

      const updated = await tx.accountRequest.update({
        where: { id: found.id },
        data: { status: input.status, handledNote: input.note?.trim() || null, handledAt: new Date() },
      });
      const owner = await tx.userAccount.findFirst({ where: { isOwner: true }, select: { userId: true } });
      if (owner) {
        await tx.auditLog.create({
          data: {
            accountId: input.accountId,
            userId: owner.userId,
            action: 'UPDATE',
            entity: 'account_request',
            entityId: found.id,
            before: { status: found.status } as never,
            after: { status: updated.status, via: 'request:handle' } as never,
          },
        });
      }
      return updated;
    });
    return serializeRequest(updated);
  }
}
