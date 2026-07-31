import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { KOBRAX, isPasswordValid } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { weakPassword } from '../auth/auth.errors';
import { serializeAccount } from './accounts.serializer';
import { UpdateAccountDto } from './dto/account.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { accountNotFound, emailTaken, roleCatalogMissing } from './accounts.errors';

/** Mercado inicial. El registro no los pregunta (S4-D8); se cambian en la pantalla de datos. */
const DEFAULT_COUNTRY = 'BO';
const DEFAULT_CURRENCY = 'BOB';

/** Datos del propio tenant (módulo CUENTA · S0) + registro público (S4). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async findMine(): Promise<ReturnType<typeof serializeAccount>> {
    const { account, memberCount } = await this.tx(async (tx) => {
      // El id va en el where además de la RLS (policy `tenant_self`): defensa en profundidad.
      const [account, memberCount] = await Promise.all([
        tx.account.findFirst({ where: { id: this.tenant.accountId, deletedAt: null } }),
        tx.userAccount.count({ where: { isActive: true } }),
      ]);
      return { account, memberCount };
    });
    if (!account) throw accountNotFound();
    return serializeAccount(account, memberCount);
  }

  /**
   * Registro público (S4). Crea tenant + usuario + perfil + membresía de dueño
   * en una sola transacción. **No emite tokens**: el móvil hace `POST /auth/login`
   * justo después y hereda toda la máquina de estados, incluido el MFA obligatorio
   * que le corresponde a `ACCOUNT_ADMIN` (S4-D1, S4-D5).
   */
  async create(
    dto: CreateAccountDto,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ accountId: string; email: string }> {
    if (!isPasswordValid(dto.password)) throw weakPassword();

    const email = dto.email.toLowerCase();
    const role = await this.prisma.role.findUnique({ where: { name: 'ACCOUNT_ADMIN' } });
    if (!role) throw roleCatalogMissing();
    const passwordHash = await hash(dto.password, KOBRAX.BCRYPT_WORK_FACTOR);

    // El id se genera acá y no en la base: la policy `tenant_self` de `accounts`
    // exige `id = app_current_account()`, así que hay que conocerlo para abrir el
    // contexto RLS ANTES del insert. La API es NOBYPASSRLS; sin esto no entra (S4-D2).
    const accountId = randomUUID();
    try {
      await this.prisma.withTenant(accountId, async (tx) => {
        await tx.account.create({
          data: {
            id: accountId,
            businessName: dto.businessName,
            accountType: 'INDEPENDENT',
            status: 'TRIAL',
            planCode: 'STARTER',
            maxUsers: 5,
            countryCode: DEFAULT_COUNTRY,
            currencyCode: DEFAULT_CURRENCY,
          },
        });
        // `status` y `requiresPasswordChange` pisan los defaults del schema a propósito:
        // PENDING haría fallar el login con "credenciales inválidas", y el flag mandaría
        // a cambiar la contraseña recién elegida (S4-D6).
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            status: 'ACTIVE',
            requiresPasswordChange: false,
            profile: { create: { firstName: dto.firstName, lastName: dto.lastName } },
          },
        });
        await tx.userAccount.create({
          data: { userId: user.id, accountId, roleId: role.id, isOwner: true, isDefault: true },
        });
        // Audit a mano, no vía AuditService: sin contexto de request ese servicio
        // no-opea en silencio (audit.service.ts:35). Acá el contexto ya es el correcto (S4-D7).
        await tx.auditLog.create({
          data: {
            accountId,
            userId: user.id,
            action: 'CREATE',
            entity: 'account',
            entityId: accountId,
            after: { businessName: dto.businessName, ownerUserId: user.id },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
        });
      });
    } catch (err) {
      // `users.email` es @unique: el choque es la guarda real contra el alta duplicada,
      // incluso con dos registros simultáneos. No hace falta chequear antes.
      if ((err as { code?: string }).code === 'P2002') throw emailTaken();
      throw err;
    }

    return { accountId, email };
  }

  async update(dto: UpdateAccountDto): Promise<ReturnType<typeof serializeAccount>> {
    const { before, updated } = await this.tx(async (tx) => {
      const before = await tx.account.findFirst({
        where: { id: this.tenant.accountId, deletedAt: null },
      });
      if (!before) throw accountNotFound();
      const updated = await tx.account.update({
        where: { id: before.id },
        data: {
          businessName: dto.businessName,
          taxId: dto.taxId,
          countryCode: dto.countryCode,
          currencyCode: dto.currencyCode,
          timezone: dto.timezone,
        },
      });
      return { before, updated };
    });

    await this.audit.record({
      entity: 'account',
      entityId: updated.id,
      action: 'UPDATE',
      before,
      after: updated,
      redactKeys: ['taxId'],
    });
    return this.findMine();
  }
}
