import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Zona por país, para las cuentas que no tienen `timezone` cargada.
 *
 * ⚠️ **Un país no es una zona.** Brasil, México y Chile tienen varias, y acá se elige la del huso
 * donde vive la mayoría. Es un default, no una verdad: la cuenta que necesite otra la carga en su
 * configuración y este mapa deja de mirarla. Sin él, toda cuenta creada por registro —que no pregunta
 * la zona— caería a UTC, que es exactamente el caso que rompe.
 */
const TZ_BY_COUNTRY: Record<string, string> = {
  BO: 'America/La_Paz',
  PE: 'America/Lima',
  EC: 'America/Guayaquil',
  CO: 'America/Bogota',
  VE: 'America/Caracas',
  CL: 'America/Santiago',
  AR: 'America/Argentina/Buenos_Aires',
  UY: 'America/Montevideo',
  PY: 'America/Asuncion',
  BR: 'America/Sao_Paulo',
  MX: 'America/Mexico_City',
  GT: 'America/Guatemala',
  SV: 'America/El_Salvador',
  HN: 'America/Tegucigalpa',
  NI: 'America/Managua',
  CR: 'America/Costa_Rica',
  PA: 'America/Panama',
  DO: 'America/Santo_Domingo',
  PR: 'America/Puerto_Rico',
};

/**
 * El ancla UTC de medianoche de la fecha civil `tz`. Exportada suelta para poder probarla sin Nest.
 *
 * `en-CA` no es capricho: es el locale que formatea `YYYY-MM-DD`, así que la fecha sale ya partida
 * en año, mes y día sin parsear un texto localizado. Una zona inválida guardada a mano en la base
 * haría explotar `Intl`, y por eso el catch: una cuenta mal configurada no puede tumbar la agenda.
 */
export function civilTodayUTC(tz: string, now: Date = new Date()): Date {
  try {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(now)
      .split('-')
      .map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}

/**
 * Qué día es **para el tenant**.
 *
 * 🔴 **Existe porque "hoy" en UTC no es hoy para nadie en América.** La agenda anclaba su día a la
 * medianoche UTC, así que en Bolivia (UTC−4) a las 20:00 el servidor ya estaba en mañana: las
 * gestiones que quedaban del día se pintaban vencidas, y agendar para hoy daba
 * «No se puede agendar en una fecha pasada». No era un borde raro — pasaba todas las noches.
 *
 * El resultado es siempre la medianoche **UTC** del día civil del tenant, que es como la base guarda
 * `scheduledDate`: el ancla, no la hora local. Comparar contra otra cosa mezclaría dos relojes.
 *
 * ponytail: la zona se cachea por proceso y no se invalida — cambiarla es una vez en la vida de una
 * cuenta, y el reinicio del deploy alcanza. Si algún día se puede cambiar en caliente, borrar la
 * entrada del mapa al guardar la configuración.
 */
@Injectable()
export class TenantClockService {
  private readonly tzByAccount = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** La zona del tenant: la que cargó, o la de su país, o UTC. */
  async timezone(): Promise<string> {
    const accountId = this.tenant.accountId;
    const cached = this.tzByAccount.get(accountId);
    if (cached) return cached;

    const account = await this.prisma.withTenant(accountId, (tx) =>
      tx.account.findFirst({ where: { id: accountId }, select: { timezone: true, countryCode: true } }),
    );
    const tz = account?.timezone || TZ_BY_COUNTRY[account?.countryCode ?? ''] || 'UTC';
    this.tzByAccount.set(accountId, tz);
    return tz;
  }

  /** Medianoche UTC del día civil del tenant — la referencia de "hoy" para vencidos y para el pasado. */
  async today(): Promise<Date> {
    return civilTodayUTC(await this.timezone());
  }
}
