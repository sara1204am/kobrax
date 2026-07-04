/**
 * Seed idempotente de Kobrax.
 * Carga el catálogo de permisos, los roles del sistema con sus permisos base,
 * y un tenant demo con un usuario owner.
 *
 *   pnpm db:seed
 *
 * Re-ejecutar NO duplica datos (usa upsert / claves naturales).
 */
import {
  PrismaClient,
  AccountType,
  AccountStatus,
  PlanCode,
  UserStatus,
  ClientType,
  CreditStatus,
  InstallmentStatus,
  CaseStatus,
  CasePriority,
  CaseActivityType,
  RouteStatus,
  RouteStopStatus,
  VisitOutcome,
  EvidenceType,
  PaymentMethod,
  ContactType,
  LocationType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

// ── PII: cifrado AES-256-GCM + blind index HMAC (F4 Fase 0) ──────────────────
// El seed siembra la PII ya cifrada y con su hash, igual que lo hará la API.
// Las claves se leen en cada llamada (process.env ya poblado tras instanciar Prisma).
function encKey(): Buffer {
  const k = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'hex');
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY (32 bytes hex) requerida para sembrar PII cifrada');
  return k;
}
function blindKey(): Buffer {
  const k = Buffer.from(process.env.APP_BLIND_INDEX_KEY ?? '', 'hex');
  if (k.length !== 32) throw new Error('APP_BLIND_INDEX_KEY (32 bytes hex) requerida para el blind index');
  return k;
}
/** Cifra a `iv.tag.ct` (mismo formato que CryptoService de la API). */
function encryptPII(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}
/** Blind index determinista (mismo algoritmo/normalización que BlindIndexService). */
function blindHash(value: string): string {
  const norm = value.trim().toUpperCase().replace(/[\s.\-/]/g, '');
  return createHmac('sha256', blindKey()).update(norm).digest('hex');
}

// Catálogo de permisos: code = `{recurso}:{acción}`.
const PERMISSIONS = [
  ['case:read', 'cases', 'READ', 'ACCOUNT'],
  ['case:write', 'cases', 'UPDATE', 'ACCOUNT'],
  ['case:assign', 'cases', 'UPDATE', 'BRANCH'],
  ['case:close', 'cases', 'UPDATE', 'ACCOUNT'],
  ['payment:read', 'payments', 'READ', 'ACCOUNT'],
  ['payment:write', 'payments', 'CREATE', 'OWN'],
  ['payment:approve', 'payments', 'APPROVE', 'ACCOUNT'],
  ['route:read', 'routes', 'READ', 'ACCOUNT'],
  ['route:write', 'routes', 'UPDATE', 'BRANCH'],
  ['route:assign', 'routes', 'UPDATE', 'BRANCH'],
  ['route:execute', 'routes', 'EXECUTE', 'OWN'],
  ['client:read', 'clients', 'READ', 'ACCOUNT'],
  ['client:write', 'clients', 'UPDATE', 'ACCOUNT'],
  ['client:pii:read', 'clients', 'READ', 'ACCOUNT'],
  ['client:import', 'clients', 'CREATE', 'ACCOUNT'],
  ['client:import:replace', 'clients', 'DELETE', 'ACCOUNT'],
  ['credit:read', 'credits', 'READ', 'ACCOUNT'],
  ['credit:write', 'credits', 'UPDATE', 'ACCOUNT'],
  ['credit:pii:read', 'credits', 'READ', 'ACCOUNT'],
  ['report:read', 'reports', 'READ', 'ACCOUNT'],
  ['report:export', 'reports', 'EXECUTE', 'ACCOUNT'],
  ['user:read', 'users', 'READ', 'ACCOUNT'],
  ['user:write', 'users', 'UPDATE', 'ACCOUNT'],
  ['user:invite', 'users', 'CREATE', 'ACCOUNT'],
  ['role:read', 'roles', 'READ', 'ACCOUNT'],
  ['role:write', 'roles', 'UPDATE', 'ACCOUNT'],
  ['audit:read', 'audit', 'READ', 'ACCOUNT'],
] as const;

// Roles del sistema → permisos base. '*' = todos.
const ROLES: Record<string, { level: number; perms: string[] | '*' }> = {
  SUPER_ADMIN: { level: 100, perms: '*' },
  ACCOUNT_ADMIN: { level: 90, perms: PERMISSIONS.map((p) => p[0]).filter((c) => c !== 'audit:read') },
  MANAGER: {
    level: 70,
    perms: ['case:read', 'case:write', 'case:assign', 'case:close', 'payment:read', 'payment:approve', 'route:read', 'route:write', 'route:assign', 'client:read', 'client:write', 'client:pii:read', 'client:import', 'credit:read', 'credit:write', 'credit:pii:read', 'report:read', 'report:export', 'user:read'],
  },
  SUPERVISOR: {
    level: 50,
    perms: ['case:read', 'case:write', 'case:assign', 'payment:read', 'route:read', 'route:write', 'route:assign', 'client:read', 'credit:read', 'report:read'],
  },
  COLLECTOR: {
    level: 30,
    perms: ['case:read', 'case:write', 'payment:read', 'payment:write', 'route:read', 'route:execute', 'client:read', 'credit:read'],
  },
  AUDITOR: {
    level: 20,
    perms: ['case:read', 'payment:read', 'route:read', 'client:read', 'client:pii:read', 'credit:read', 'credit:pii:read', 'report:read', 'report:export', 'audit:read'],
  },
  VIEWER: { level: 10, perms: ['case:read', 'payment:read', 'route:read', 'client:read', 'report:read'] },
};

async function main() {
  console.log('🌱 Seeding Kobrax...');

  // 1) Permisos
  for (const [code, module, action, scope] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { module, action: action as any, scope: scope as any },
      create: { code, name: code, module, action: action as any, scope: scope as any },
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permisos`);

  // 2) Roles + role_permissions
  for (const [name, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { level: def.level, isSystem: true },
      create: { name, level: def.level, isSystem: true },
    });
    const codes = def.perms === '*' ? PERMISSIONS.map((p) => p[0]) : def.perms;
    const perms = await prisma.permission.findMany({ where: { code: { in: codes as string[] } } });
    for (const perm of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(`  ✓ ${Object.keys(ROLES).length} roles`);

  // 3) Tenant demo + owner
  const account = await prisma.account.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: {
      code: 'DEMO',
      businessName: 'Kobrax Demo',
      accountType: AccountType.INDEPENDENT,
      status: AccountStatus.ACTIVE,
      planCode: PlanCode.STARTER,
      countryCode: 'BO',
      currencyCode: 'BOB',
      timezone: 'America/La_Paz',
      maxUsers: 5,
    },
  });

  // Helper idempotente: usuario global + perfil + membresía al tenant con un rol.
  const passwordHash = await bcrypt.hash('Kobrax123!', 12);
  async function ensureUser(
    email: string,
    firstName: string,
    lastName: string,
    roleName: string,
    opts: { isOwner?: boolean; isDefault?: boolean } = {},
  ) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const u = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        status: UserStatus.ACTIVE,
        requiresPasswordChange: false,
        profile: { create: { firstName, lastName } },
      },
    });
    await prisma.userAccount.upsert({
      where: { userId_accountId: { userId: u.id, accountId: account.id } },
      update: {},
      create: {
        userId: u.id,
        accountId: account.id,
        roleId: role.id,
        isOwner: !!opts.isOwner,
        isDefault: !!opts.isDefault,
      },
    });
    return u;
  }

  const owner = await ensureUser('owner@kobrax.demo', 'Owner', 'Demo', 'ACCOUNT_ADMIN', {
    isOwner: true,
    isDefault: true,
  });
  await ensureUser('supervisor@kobrax.demo', 'Sandra', 'Supervisor', 'SUPERVISOR');
  const collector = await ensureUser('collector@kobrax.demo', 'Carlos', 'Collector', 'COLLECTOR');
  // MANAGER (rol no crítico → sin MFA): tiene client:write + client:pii:read, útil para operar cartera.
  await ensureUser('manager@kobrax.demo', 'Mónica', 'Manager', 'MANAGER');
  void owner;

  console.log('  ✓ tenant demo + 4 usuarios (owner/supervisor/collector/manager @kobrax.demo · pass: Kobrax123!)');

  // 3b) Segundo tenant + usuario multi-empresa (para probar select-account en F2a).
  const account2 = await prisma.account.upsert({
    where: { code: 'DEMO2' },
    update: { status: AccountStatus.ACTIVE },
    create: {
      code: 'DEMO2',
      businessName: 'Kobrax Demo Norte',
      accountType: AccountType.INDEPENDENT,
      status: AccountStatus.ACTIVE,
      planCode: PlanCode.STARTER,
      countryCode: 'BO',
      currencyCode: 'BOB',
      timezone: 'America/La_Paz',
      maxUsers: 5,
    },
  });

  // multi@kobrax.demo: miembro de DEMO (SUPERVISOR, default) y DEMO2 (ACCOUNT_ADMIN).
  const multi = await ensureUser('multi@kobrax.demo', 'María', 'Multi', 'SUPERVISOR', {
    isDefault: true,
  });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ACCOUNT_ADMIN' } });
  await prisma.userAccount.upsert({
    where: { userId_accountId: { userId: multi.id, accountId: account2.id } },
    update: {},
    create: { userId: multi.id, accountId: account2.id, roleId: adminRole.id },
  });

  console.log('  ✓ tenant DEMO2 + multi@kobrax.demo (2 empresas · pass: Kobrax123!)');

  // 4) Cadena operativa demo (idempotente por el blind index del documento del cliente).
  const acc = account.id;
  const demoDocHash = blindHash('DEMO-0001');
  const existing = await prisma.client.findFirst({
    where: { accountId: acc, OR: [{ nationalIdHash: demoDocHash }, { nationalId: 'DEMO-0001' }] },
  });

  // Fila sembrada antes de F4 (documento en claro, sin hash) → migrar a cifrado + hash in situ.
  if (existing && existing.nationalIdHash !== demoDocHash) {
    await prisma.client.update({
      where: { id: existing.id },
      data: { nationalId: encryptPII('DEMO-0001'), nationalIdHash: demoDocHash },
    });
    console.log('  ↻ cliente demo migrado a PII cifrada (national_id)');
  }

  if (!existing) {
    const client = await prisma.client.create({
      data: {
        accountId: acc,
        firstName: 'Juan',
        lastName: 'Pérez',
        clientType: ClientType.PERSON,
        nationalId: encryptPII('DEMO-0001'), // ciphertext en reposo
        nationalIdHash: demoDocHash, // blind index para búsqueda/unicidad
        riskSegment: 'HIGH',
        contacts: {
          create: { accountId: acc, contactType: ContactType.PHONE, value: encryptPII('70000000'), isPrimary: true },
        },
        locations: {
          create: {
            accountId: acc,
            locationType: LocationType.HOME,
            address: encryptPII('Av. Demo 123'),
            zone: 'Centro',
            latitude: -16.5,
            longitude: -68.15,
          },
        },
      },
    });

    const credit = await prisma.credit.create({
      data: {
        accountId: acc,
        clientId: client.id,
        code: 'CRD-DEMO-1',
        principalAmount: 10000,
        outstandingBalance: 6000,
        interestRate: 0.025,
        currency: 'BOB',
        installmentsCount: 12,
        status: CreditStatus.ACTIVE,
        daysPastDue: 35,
        installments: {
          create: [
            { accountId: acc, number: 1, dueDate: new Date('2026-04-15'), amount: 1000, paidAmount: 1000, status: InstallmentStatus.PAID, paidAt: new Date('2026-04-14') },
            { accountId: acc, number: 2, dueDate: new Date('2026-05-15'), amount: 1000, status: InstallmentStatus.OVERDUE },
          ],
        },
        arrears: {
          create: { accountId: acc, daysOverdue: 35, overdueAmount: 1000, interest: 50, penalty: 20 },
        },
      },
    });

    const collectionCase = await prisma.collectionCase.create({
      data: {
        accountId: acc,
        creditId: credit.id,
        clientId: client.id,
        assigneeId: collector.id,
        status: CaseStatus.ACTIVE,
        priority: CasePriority.HIGH,
        activities: {
          create: { accountId: acc, userId: collector.id, type: CaseActivityType.ASSIGNMENT, notes: 'Caso asignado (seed)' },
        },
      },
    });

    const route = await prisma.routePlan.create({
      data: {
        accountId: acc,
        collectorId: collector.id,
        plannedDate: new Date('2026-06-15'),
        status: RouteStatus.PLANNED,
        totalCases: 1,
        stops: {
          create: {
            accountId: acc,
            clientId: client.id,
            caseId: collectionCase.id,
            sequenceOrder: 1,
            status: RouteStopStatus.PENDING,
          },
        },
      },
      include: { stops: true },
    });

    const visit = await prisma.fieldVisit.create({
      data: {
        accountId: acc,
        caseId: collectionCase.id,
        routeStopId: route.stops[0]!.id,
        collectorId: collector.id,
        latitude: -16.5,
        longitude: -68.15,
        accuracy: 8.5,
        outcome: VisitOutcome.PROMISE_TO_PAY,
        notes: 'Compromiso de pago para fin de mes (seed)',
        capturedAt: new Date('2026-06-15T14:30:00Z'),
        evidences: {
          create: {
            accountId: acc,
            type: EvidenceType.PHOTO,
            fileUrl: 'https://demo.kobrax/evidence/seed-photo.jpg',
            fileHash: createHash('sha256').update('seed-photo').digest('hex'),
            latitude: -16.5,
            longitude: -68.15,
            capturedAt: new Date('2026-06-15T14:30:00Z'),
          },
        },
      },
    });

    await prisma.payment.create({
      data: {
        accountId: acc,
        creditId: credit.id,
        caseId: collectionCase.id,
        amount: 500,
        method: PaymentMethod.CASH,
        receiptNumber: 1,
        registeredBy: collector.id,
        paymentDate: new Date('2026-06-15T14:35:00Z'),
      },
    });

    console.log(`  ✓ cadena operativa demo (cliente→crédito→caso→ruta→visita ${visit.id.slice(0, 8)}→pago)`);
  } else {
    // Re-asignar la cadena demo al collector (idempotente) por si fue creada
    // por una versión anterior del seed que asignaba al owner.
    await prisma.collectionCase.updateMany({
      where: { accountId: acc, assigneeId: { not: collector.id } },
      data: { assigneeId: collector.id },
    });
    await prisma.routePlan.updateMany({
      where: { accountId: acc, collectorId: { not: collector.id } },
      data: { collectorId: collector.id },
    });
    console.log('  ↺ cadena operativa demo ya existe; re-asignada al collector');
  }

  console.log('✅ Seed completo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
