import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { NotificationType, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { auditAsOwner } from './plan-tools.service';

/** Corre más seguido que «diario» para que un reinicio no lo saltee. Es idempotente. */
export const PLAN_LIFECYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A los 6 meses sin entrar, el aviso (Pregunta 20). Los 9 meses de sólo lectura son de L5+. */
const DORMANT_MONTHS = 6;

export interface PlanLifecycleResult {
  /** Pruebas vencidas que cayeron a FREE. */
  trialsExpired: number;
  /** Cuentas FREE dormidas avisadas por correo. */
  dormantWarned: number;
}

const EMPTY: PlanLifecycleResult = { trialsExpired: 0, dormantWarned: 0 };

/** «Professional», no «PROFESSIONAL»: es un correo, no un enum. */
const nombreDePlan = (code: string) => code.charAt(0) + code.slice(1).toLowerCase();

/**
 * El ciclo de vida comercial de la cuenta (LIMITES-BUILD-PLAN §L4), un barrido diario:
 *
 * 1. **Prueba vencida → cae a FREE, no se bloquea** (Pregunta 34). El excedente queda congelado —
 *    `assertRoom` ya lo hace gratis (Pregunta 31: nadie se desactiva solo, no se puede sumar).
 *    El dueño recibe la explicación por notificación, y **hacia adentro sale el correo de venta**:
 *    una prueba que venció es la conversación comercial más caliente que tiene Kobrax.
 * 2. **Cuenta FREE dormida** (Pregunta 20): 6 meses sin que nadie entre → un correo al dueño,
 *    una sola vez por siesta (la marca `dormantWarnedAt` vive en `settings` y se limpia sola
 *    cuando alguien vuelve a entrar). El paso a sólo lectura de los 9 meses **no existe todavía**:
 *    necesita un modo lectura que la API no tiene y el archivado de fotos que bloquea L5.
 *
 * La caída a FREE del que **deja de pagar** (Pregunta 35) no vive acá: sin pasarela de cobro no
 * hay señal que detectar — es la palanca de L3 (`plan:set -- --plan FREE`), a mano.
 *
 * Mismo patrón que `ArrearsJobService`: enumera los tenants con `promise_due_account_ids()` y
 * escanea cada uno bajo su propia RLS; un fallo en uno no detiene a los demás.
 */
@Injectable()
export class PlanLifecycleService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlanLifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), PLAN_LIFECYCLE_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<PlanLifecycleResult> {
    let accountIds: string[];
    try {
      const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`SELECT * FROM promise_due_account_ids()`;
      accountIds = rows.map((r) => r.account_id);
    } catch (err) {
      this.logger.warn(`promise_due_account_ids() no disponible — ciclo de planes sin correr: ${this.msg(err)}`);
      return { ...EMPTY };
    }

    const total = { ...EMPTY };
    for (const accountId of accountIds) {
      try {
        const r = await this.scanAccount(accountId, now);
        total.trialsExpired += r.trialsExpired;
        total.dormantWarned += r.dormantWarned;
      } catch (err) {
        this.logger.error(`Ciclo de planes falló en tenant ${accountId}: ${this.msg(err)}`);
      }
    }
    if (total.trialsExpired || total.dormantWarned) {
      this.logger.log(`Planes: ${total.trialsExpired} pruebas vencidas, ${total.dormantWarned} dormidas avisadas`);
    }
    return total;
  }

  async scanAccount(accountId: string, now: Date = new Date()): Promise<PlanLifecycleResult> {
    return this.prisma.withTenant(accountId, async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: accountId, deletedAt: null },
        select: { status: true, planCode: true, settings: true, businessName: true, createdAt: true },
      });
      if (!account) return { ...EMPTY };

      const settings = { ...(account.settings as Record<string, unknown>) };
      const out = { ...EMPTY };

      // ── 1 · La prueba vencida cae a FREE ──────────────────────────────────────────────
      const trialEndsAt = typeof settings.trialEndsAt === 'string' ? new Date(settings.trialEndsAt) : null;
      if (account.status === 'TRIAL' && trialEndsAt && trialEndsAt <= now) {
        // `trialEndsAt` se queda en settings como constancia; el guard es `status`, que deja de
        // ser TRIAL — correr el job dos veces no puede hacer caer dos veces.
        await tx.account.update({
          where: { id: accountId },
          data: { planCode: 'FREE', status: 'ACTIVE' },
        });
        await auditAsOwner(tx, this.logger, accountId, 'plan:lifecycle', {
          before: { planCode: account.planCode, status: account.status },
          after: { planCode: 'FREE', status: 'ACTIVE' },
        });
        out.trialsExpired = 1;
        const plan = nombreDePlan(account.planCode);
        await this.avisarCaidaDePrueba(tx, accountId, account.businessName, plan);
      }

      // ── 2 · La FREE dormida (sólo si no acaba de caer: la que cayó hoy tuvo actividad) ──
      if (out.trialsExpired === 0 && account.planCode === 'FREE' && account.status === 'ACTIVE') {
        out.dormantWarned = await this.revisarSiesta(tx, accountId, account.createdAt, settings, now);
      }

      return out;
    });
  }

  /** El dueño se entera por qué su pantalla dice FREE; ventas se entera de a quién llamar. */
  private async avisarCaidaDePrueba(
    tx: PrismaClient,
    accountId: string,
    businessName: string,
    plan: string,
  ): Promise<void> {
    const admins = await tx.userAccount.findMany({
      where: { isActive: true, role: { name: 'ACCOUNT_ADMIN' } },
      select: { userId: true },
    });
    for (const userId of new Set(admins.map((a) => a.userId))) {
      await this.notifications.notifyUser(accountId, userId, {
        type: NotificationType.SYSTEM,
        title: `Terminó la prueba de ${plan}`,
        body:
          'Tu cuenta pasó al plan Free. Nada se borra: lo que esté por encima del tope queda ' +
          'congelado — se puede seguir cobrando, no sumar. Escribinos para seguir con tu plan.',
      });
    }
    const to = this.config.mailFrom ?? this.config.smtpUser;
    if (!to) return;
    await this.mail.send(
      to,
      `[Kobrax] Venció la prueba de ${businessName} (${plan})`,
      [
        `La cuenta «${businessName}» terminó sus 30 días de ${plan} y cayó a FREE.`,
        '',
        'Usó el producto un mes entero: es la llamada de venta más caliente que hay. El excedente le quedó congelado, no borrado.',
      ].join('\n'),
    );
  }

  /**
   * 6 meses sin que **nadie** de la cuenta entre → un correo al dueño. La marca se limpia sola
   * cuando alguien vuelve, así la próxima siesta avisa de nuevo.
   */
  private async revisarSiesta(
    tx: PrismaClient,
    accountId: string,
    createdAt: Date,
    settings: Record<string, unknown>,
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - DORMANT_MONTHS);

    const members = await tx.userAccount.findMany({
      where: { isActive: true },
      select: { isOwner: true, user: { select: { email: true, lastLoginAt: true } } },
    });
    // Sin ningún login jamás, cuenta la creación: una cuenta recién nacida no está dormida.
    const lastEntry = members.reduce(
      (max, m) => (m.user.lastLoginAt && m.user.lastLoginAt > max ? m.user.lastLoginAt : max),
      createdAt,
    );
    const dormida = lastEntry < cutoff;
    const yaAvisada = typeof settings.dormantWarnedAt === 'string';

    if (!dormida) {
      if (yaAvisada) {
        const { dormantWarnedAt: _, ...rest } = settings;
        await tx.account.update({ where: { id: accountId }, data: { settings: rest as never } });
      }
      return 0;
    }
    if (yaAvisada) return 0;

    await tx.account.update({
      where: { id: accountId },
      data: { settings: { ...settings, dormantWarnedAt: now.toISOString() } },
    });
    const owner = members.find((m) => m.isOwner)?.user.email;
    if (!owner) {
      this.logger.warn(`Cuenta ${accountId} dormida y sin dueño activo: no hay a quién escribirle.`);
      return 1;
    }
    await this.mail.send(
      owner,
      'Tu cuenta de Kobrax lleva 6 meses sin uso',
      [
        'Hace 6 meses que nadie entra a tu cuenta de Kobrax.',
        '',
        'Tu cartera y tus registros siguen ahí. Entrá cuando quieras para mantenerla activa:',
        'pasados 9 meses sin uso, la cuenta puede pasar a sólo lectura.',
      ].join('\n'),
    );
    return 1;
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
