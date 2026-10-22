import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';
import { RoleType } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { MfaService } from '../auth/mfa.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { ownerCodeInvalid, ownerNotOwner, ownerPasswordInvalid, ownerTargetInvalid } from './accounts.errors';

const fullName = (u: { email: string; profile: { firstName: string; lastName: string } | null }) =>
  [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ') || u.email;

/**
 * Transferir la propiedad de la cuenta a otro administrador (Refactor de Cuenta · F8).
 *
 * Es la acción más delicada de la pantalla: quien es dueño responde por la cuenta ante Kobrax, y la herramienta de
 * operación atribuye a su nombre lo que hace por consola. Por eso pide **tres cosas a la vez**: ser el dueño actual,
 * la contraseña, y —si tiene verificación en dos pasos— un código válido en ese mismo pedido (no «MFA reciente»: el
 * código se consume acá).
 */
@Injectable()
export class OwnershipService {
  private readonly logger = new Logger(OwnershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
    private readonly notifications: NotificationsService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private get selfId(): string {
    const id = this.tenant.userId;
    if (!id) throw new Error('OwnershipService requiere un request autenticado');
    return id;
  }

  async transfer(dto: TransferOwnershipDto): Promise<{ ok: true }> {
    // 1) Quién pide y quién recibe. Se resuelve todo antes de pedir la contraseña: un destinatario inválido no debe
    //    servir para adivinar nada, pero tampoco hay por qué gastar un intento de contraseña en un pedido imposible.
    const { me, target, accountId, names } = await this.tx(async (tx) => {
      const me = await tx.userAccount.findFirst({ where: { userId: this.selfId }, include: { user: { include: { profile: true } } } });
      if (!me?.isOwner) throw ownerNotOwner();
      if (dto.userId === this.selfId) throw ownerTargetInvalid();

      const target = await tx.userAccount.findFirst({
        where: { userId: dto.userId, isActive: true, role: { name: RoleType.ACCOUNT_ADMIN }, user: { status: 'ACTIVE' } },
        include: { user: { include: { profile: true } } },
      });
      if (!target) throw ownerTargetInvalid();
      return { me, target, accountId: this.tenant.accountId, names: { from: fullName(me.user), to: fullName(target.user) } };
    });

    // 2) Contraseña actual.
    if (!(await compare(dto.password, me.user.passwordHash))) throw ownerPasswordInvalid();

    // 3) Segundo factor, si lo tiene activo. Los administradores lo tienen obligatorio; un dueño sin MFA (período de gracia)
    //    sigue con sólo la contraseña.
    if (me.user.mfaEnabled && !(await this.mfa.challenge(me.userId, dto.code ?? ''))) throw ownerCodeInvalid();

    // 4) El cambio, en una sola transacción: nunca queda la cuenta sin dueño ni con dos.
    await this.tx(async (tx) => {
      await tx.userAccount.update({ where: { id: me.id }, data: { isOwner: false } });
      await tx.userAccount.update({ where: { id: target.id }, data: { isOwner: true } });
    });

    await this.audit.record({
      entity: 'user_account',
      entityId: target.id,
      action: 'OWNERSHIP_TRANSFER',
      before: { ownerUserId: me.userId, ownerName: names.from },
      after: { ownerUserId: target.userId, ownerName: names.to },
    });

    // 5) Aviso a los dos. Es un aviso: si falla, el traspaso ya está hecho y auditado.
    for (const [userId, body] of [
      [target.userId, `${names.from} te transfirió la propiedad de la cuenta. Ahora eres su dueño.`],
      [me.userId, `Transferiste la propiedad de la cuenta a ${names.to}. Sigues siendo administrador.`],
    ] as const) {
      await this.notifications
        .notifyUser(accountId, userId, { type: NotificationType.SYSTEM, title: 'Cambió el dueño de la cuenta', body })
        .catch((err: Error) => this.logger.warn(`No se pudo avisar a ${userId}: ${err.message}`));
    }
    return { ok: true };
  }
}
