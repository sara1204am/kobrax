import { Injectable } from '@nestjs/common';
import { ResponseDto } from '@kobrax/shared';
import { TenantContextService } from '../../../common/context/tenant-context.service';
import { PrismaService } from '../../../database/prisma.service';
import { STALE_AFTER_DAYS } from './push.service';

export interface RegisterDeviceInput {
  installationId: string;
  token: string;
  platform?: string;
  appVersion?: string;
  deviceName?: string;
}

const DAY_MS = 86_400_000;

/**
 * Los dispositivos del usuario que sesiona. **Siempre del propio usuario**: el `userId` sale de la sesión, nunca del
 * cuerpo ni de la URL, así que no existe forma de registrar, ver o borrar el token de otra persona.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Registra o **renueva** el token de esta instalación (mismo `installationId` = misma fila, token nuevo). Idempotente:
   * la app lo llama en cada arranque y cuando FCM rota el token.
   */
  async register(input: RegisterDeviceInput) {
    const accountId = this.tenant.accountId;
    const userId = this.tenant.userId!;
    const now = new Date();

    await this.prisma.withTenant(accountId, async (tx) => {
      await tx.devicePushToken.upsert({
        where: { accountId_userId_installationId: { accountId, userId, installationId: input.installationId } },
        create: {
          accountId,
          userId,
          installationId: input.installationId,
          token: input.token,
          platform: input.platform ?? 'android',
          appVersion: input.appVersion ?? null,
          deviceName: input.deviceName ?? null,
          lastSeenAt: now,
        },
        update: {
          token: input.token,
          platform: input.platform ?? 'android',
          appVersion: input.appVersion ?? null,
          deviceName: input.deviceName ?? null,
          isActive: true,
          failureCount: 0,
          lastError: null,
          lastSeenAt: now,
        },
      });

      // Un teléfono que cambia de usuario no puede seguir recibiendo los avisos del anterior: el mismo token en otra
      // fila (de esta empresa) se desactiva. Entre empresas distintas la RLS no deja tocar la fila ajena; ahí cubre la
      // revocación al cerrar sesión y el `uid` del push, que la app compara con su sesión.
      await tx.devicePushToken.updateMany({
        where: {
          accountId,
          token: input.token,
          isActive: true,
          NOT: { userId, installationId: input.installationId },
        },
        data: { isActive: false, lastError: 'REASSIGNED' },
      });

      // Limpieza oportunista de tokens abandonados de esta empresa.
      await tx.devicePushToken.deleteMany({
        where: { accountId, lastSeenAt: { lt: new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS) } },
      });
    });

    return ResponseDto.ok({ installationId: input.installationId, active: true });
  }

  /** Revoca esta instalación. Idempotente y sin revelar si existía (borrar lo ajeno no encuentra nada). */
  async revoke(installationId: string): Promise<void> {
    const accountId = this.tenant.accountId;
    const userId = this.tenant.userId!;
    await this.prisma.withTenant(accountId, (tx) =>
      tx.devicePushToken.deleteMany({ where: { accountId, userId, installationId } }),
    );
  }

  /** Los dispositivos del usuario, **sin el token**: para que la app muestre «este teléfono recibe avisos». */
  async listMine() {
    const accountId = this.tenant.accountId;
    const userId = this.tenant.userId!;
    const rows = await this.prisma.withTenant(accountId, (tx) =>
      tx.devicePushToken.findMany({
        where: { accountId, userId },
        orderBy: { lastSeenAt: 'desc' },
        select: { installationId: true, platform: true, appVersion: true, deviceName: true, isActive: true, lastSeenAt: true },
      }),
    );
    return ResponseDto.ok(rows);
  }
}
