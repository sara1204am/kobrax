import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { usageLevel } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { TenantContextService } from '../context/tenant-context.service';
import { TenantClockService } from '../context/tenant-clock.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { PlanLimitsService, type MonthlyCounter } from './plan-limits.service';

const LABEL: Record<MonthlyCounter, string> = {
  photosPerMonth: 'fotos',
  actionsPerMonth: 'gestiones de campo',
};

/**
 * El aviso de los topes mensuales (LIMITES-BUILD-PLAN §L2). **Nunca frena nada**: la foto y la
 * visita ya ocurrieron en la calle (R1); esto sólo cuenta y avisa a quien puede decidir.
 *
 * - Al **80%**, una notificación al administrador de la cuenta. **Una vez por mes y por tope**
 *   (Pregunta 36): la marca vive en `accounts.settings.planAlerts`, el cajón de estado que ya
 *   guarda `trialEndsAt`.
 * - Al **100%**, un correo **hacia adentro** (la casilla de Kobrax): lo que sigue es una
 *   conversación de venta, no un cartel más al usuario.
 *
 * Lo llaman `createVisit` y `addEvidence` **después de su transacción y sin esperar**: un fallo
 * acá se loguea y jamás toca la visita registrada.
 *
 * ponytail: dos visitas simultáneas pueden leer «sin marca» a la vez y duplicar el aviso del mes.
 * Lo peor posible es un cartel repetido; un lock por cuenta no se paga para eso.
 */
@Injectable()
export class PlanUsageAlertsService {
  private readonly logger = new Logger(PlanUsageAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly clock: TenantClockService,
    private readonly plan: PlanLimitsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  async check(kind: MonthlyCounter): Promise<void> {
    const accountId = this.tenant.accountId;
    const r = await this.prisma.withTenant(accountId, async (tx) => {
      const [limits, used, account] = await Promise.all([
        this.plan.limitsOf(tx),
        this.plan.monthlyUsage(kind, tx),
        tx.account.findFirst({
          where: { id: accountId },
          select: { settings: true, businessName: true, planCode: true },
        }),
      ]);
      const max = limits[kind];
      if (max === null || !account) return null;
      const level = usageLevel(used, max);
      if (level === 'ok') return null;

      const month = (await this.clock.monthStart()).toISOString().slice(0, 7);
      const settings = { ...(account.settings as Record<string, unknown>) };
      const alerts = {
        ...((settings.planAlerts ?? {}) as Record<string, { month?: string; level?: string }>),
      };
      const prev = alerts[kind];
      const yaAvisado = prev?.month === month;
      // El 80% se avisa una vez por mes — también cuando el mes saltó directo al 100% y el
      // administrador nunca escuchó el primer cartel.
      const avisarAdmins = !yaAvisado;
      const avisarVentas = level === 'full' && (!yaAvisado || prev?.level !== 'full');
      if (!avisarAdmins && !avisarVentas) return null;

      alerts[kind] = { month, level };
      await tx.account.update({
        where: { id: accountId },
        data: { settings: { ...settings, planAlerts: alerts } },
      });

      const adminIds = avisarAdmins
        ? (
            await tx.userAccount.findMany({
              where: { isActive: true, role: { name: 'ACCOUNT_ADMIN' } },
              select: { userId: true },
            })
          ).map((x) => x.userId)
        : [];
      return {
        used,
        max,
        level,
        adminIds: [...new Set(adminIds)],
        avisarVentas,
        businessName: account.businessName,
        planCode: account.planCode,
      };
    });
    if (!r) return;

    const label = LABEL[kind];
    for (const userId of r.adminIds) {
      await this.notifications.notifyUser(accountId, userId, {
        type: NotificationType.SYSTEM,
        title:
          r.level === 'full'
            ? `Se llegó al tope de ${label} del mes`
            : `Cerca del tope de ${label} del mes`,
        body: `Van ${r.used} de ${r.max} este mes. Nada se bloquea: el equipo sigue trabajando igual. El contador se reinicia el 1.`,
      });
    }
    if (r.avisarVentas) {
      const to = this.config.mailFrom ?? this.config.smtpUser;
      if (!to) {
        this.logger.warn(`Sin casilla interna configurada: ${r.businessName} llegó al tope de ${label}`);
        return;
      }
      await this.mail.send(
        to,
        `[Kobrax] ${r.businessName} llegó al tope de ${label} (${r.used}/${r.max}, plan ${r.planCode})`,
        [
          `La cuenta «${r.businessName}» (plan ${r.planCode}) llegó al tope de ${label} del mes: ${r.used} de ${r.max}.`,
          '',
          'No se le bloqueó nada. Es el momento de la conversación de ampliación, antes de que la sorpresa sea de ellos.',
        ].join('\n'),
      );
    }
  }
}
