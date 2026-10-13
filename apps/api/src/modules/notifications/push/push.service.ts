import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { FCM_SENDER, type FcmResult, type FcmSender } from './fcm.client';

/**
 * Qué avisos salen como push (D-4). **Lista cerrada**: un tipo nuevo de notificación NO sale por push hasta que alguien lo
 * agrega acá a propósito, con su texto genérico.
 */
const GENERIC_COPY: Partial<Record<NotificationType, string>> = {
  ROUTE_ASSIGNED: 'Tienes una ruta nueva.',
  ROUTE_CHANGE_REQUESTED: 'Tienes un pedido de cambio de ruta.',
  ROUTE_CHANGE_DECIDED: 'Respondieron tu pedido de cambio de ruta.',
  AGENDA_ASSIGNED: 'Tienes una gestión nueva en tu agenda.',
  AGENDA_CHANGED: 'Una gestión de tu agenda cambió.',
  PROMISE_DUE: 'Tienes una promesa de pago por vencer.',
};

export const PUSH_TITLE = 'Kobrax';
export const PUSH_CHANNEL_ID = 'kobrax-avisos';
/** Fallos de envío seguidos tras los cuales un dispositivo se da de baja (token muerto que FCM no marcó). */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** Reintentos por dispositivo ante fallos transitorios (red, 5xx, 429). */
const SEND_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;
/** Sin verse en tanto tiempo, un token se borra (la app lo renueva en cada arranque). */
export const STALE_AFTER_DAYS = 60;

export interface PushInput {
  accountId: string;
  userId: string;
  notificationId: string;
  type: NotificationType;
  routeId?: string | null;
  agendaItemId?: string | null;
  creditId?: string | null;
}

export interface PushSummary {
  sent: number;
  failed: number;
  deactivated: number;
  /** Por qué no se intentó nada. */
  skipped?: 'disabled' | 'type' | 'no-devices';
}

/**
 * Envía push remoto a los dispositivos de un usuario.
 *
 * Reglas (todas probadas):
 * - **Nunca lanza.** Un fallo de FCM no pierde la notificación interna ni la operación de negocio que la originó.
 * - **Contenido genérico**: ni nombres, ni montos, ni datos del cliente. En el `data` viajan solo ids opacos para navegar;
 *   la app trae el detalle de la API (el push no es fuente de verdad) y descarta el aviso si `uid` no es el usuario de la sesión.
 * - **Sin duplicar**: `tag = id de la notificación`: si el mismo aviso llega dos veces, el teléfono lo reemplaza.
 * - **Token muerto** (UNREGISTERED…): se desactiva. Fallo transitorio: reintento acotado y, tras varios seguidos, baja.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FCM_SENDER) private readonly fcm: FcmSender,
  ) {}

  /** ¿Sale este tipo por push? */
  static isPushable(type: NotificationType): boolean {
    return type in GENERIC_COPY;
  }

  async sendToUser(input: PushInput): Promise<PushSummary> {
    const summary: PushSummary = { sent: 0, failed: 0, deactivated: 0 };
    try {
      const body = GENERIC_COPY[input.type];
      if (!body) return { ...summary, skipped: 'type' };
      if (!this.fcm.isConfigured()) return { ...summary, skipped: 'disabled' };

      const devices = await this.prisma.withTenant(input.accountId, (tx) =>
        tx.devicePushToken.findMany({
          where: { accountId: input.accountId, userId: input.userId, isActive: true },
          select: { id: true, token: true, failureCount: true },
        }),
      );
      if (devices.length === 0) return { ...summary, skipped: 'no-devices' };

      const data: Record<string, string> = { type: input.type, nid: input.notificationId, uid: input.userId };
      if (input.routeId) data.rid = input.routeId;
      if (input.agendaItemId) data.aid = input.agendaItemId;
      if (input.creditId) data.cid = input.creditId;

      for (const device of devices) {
        const result = await this.sendWithRetry(device.token, { title: PUSH_TITLE, body, data, tag: input.notificationId });
        await this.record(input.accountId, device, result, summary);
      }
    } catch (err) {
      // Defensa en profundidad: nada de acá puede romper a quien llamó.
      this.logger.warn(`Push falló sin romper el flujo: ${err instanceof Error ? err.message : err}`);
    }
    return summary;
  }

  private async sendWithRetry(
    token: string,
    msg: { title: string; body: string; data: Record<string, string>; tag: string },
  ): Promise<FcmResult> {
    let last: FcmResult = { ok: false, permanent: false, code: 'UNKNOWN', message: '' };
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
      last = await this.fcm.send({ token, ...msg, channelId: PUSH_CHANNEL_ID });
      if (last.ok || last.permanent) return last;
      if (attempt < SEND_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    return last;
  }

  private async record(
    accountId: string,
    device: { id: string; failureCount: number },
    result: FcmResult,
    summary: PushSummary,
  ): Promise<void> {
    try {
      await this.prisma.withTenant(accountId, async (tx) => {
        if (result.ok) {
          summary.sent++;
          await tx.devicePushToken.update({
            where: { id: device.id },
            data: { failureCount: 0, lastError: null, lastPushedAt: new Date() },
          });
          return;
        }
        summary.failed++;
        const failures = device.failureCount + 1;
        const dead = result.permanent || failures >= MAX_CONSECUTIVE_FAILURES;
        if (dead) summary.deactivated++;
        // Del error se guarda el código, no el mensaje completo: diagnóstico sin ruido ni datos.
        await tx.devicePushToken.update({
          where: { id: device.id },
          data: { failureCount: failures, lastError: result.code, ...(dead ? { isActive: false } : {}) },
        });
        this.logger.warn(`Push no entregado (dispositivo ${device.id}): ${result.code}${dead ? ' → dado de baja' : ''}`);
      });
    } catch (err) {
      this.logger.warn(`No se pudo registrar el resultado del push: ${err instanceof Error ? err.message : err}`);
    }
  }
}
