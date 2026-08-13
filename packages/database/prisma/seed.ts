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
  AgendaItemType,
  AgendaItemStatus,
  ScheduleTimeMode,
  CatalogType,
} from '@prisma/client';
import { ROLE_PERMISSIONS, RoleType, validateAgendaDetails } from '@kobrax/shared';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { blindHash, encryptPII } from './pii';

const prisma = new PrismaClient();

// ── PII: cifrado AES-256-GCM + blind index HMAC (F4 Fase 0) ──────────────────
// El seed siembra la PII ya cifrada y con su hash, igual que lo hará la API. El algoritmo vive en
// `pii.ts` porque lo comparten los tres seeds.

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
  ['agenda:read', 'agenda', 'READ', 'OWN'],
  ['agenda:write', 'agenda', 'CREATE', 'OWN'],
  ['agenda:assign', 'agenda', 'UPDATE', 'BRANCH'],
  ['catalog:read', 'catalogs', 'READ', 'ACCOUNT'],
  ['catalog:write', 'catalogs', 'UPDATE', 'ACCOUNT'],
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
  ['account:read', 'accounts', 'READ', 'ACCOUNT'],
  ['account:write', 'accounts', 'UPDATE', 'ACCOUNT'],
  ['user:read', 'users', 'READ', 'ACCOUNT'],
  ['user:write', 'users', 'UPDATE', 'ACCOUNT'],
  ['user:invite', 'users', 'CREATE', 'ACCOUNT'],
  ['role:read', 'roles', 'READ', 'ACCOUNT'],
  ['role:write', 'roles', 'UPDATE', 'ACCOUNT'],
  ['audit:read', 'audit', 'READ', 'ACCOUNT'],
] as const;

/**
 * Roles del sistema → nivel. **Los permisos NO se listan acá**: salen de `ROLE_PERMISSIONS` de
 * `@kobrax/shared`, que es la fuente única. Hasta 2026-08-06 este archivo tenía su propia lista y
 * las dos se separaron en silencio (shared quedó sin agenda/catálogos/import/credit:write). El JWT
 * sale de la DB, así que la app andaba y la divergencia sólo se veía en `realtime.helpers.ts`.
 */
const ROLES: Record<RoleType, { level: number }> = {
  [RoleType.SUPER_ADMIN]: { level: 100 },
  [RoleType.ACCOUNT_ADMIN]: { level: 90 },
  [RoleType.MANAGER]: { level: 70 },
  [RoleType.SUPERVISOR]: { level: 50 },
  [RoleType.COLLECTOR]: { level: 30 },
  [RoleType.AUDITOR]: { level: 20 },
  [RoleType.VIEWER]: { level: 10 },
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
    const codes = ROLE_PERMISSIONS[name as RoleType] as string[];
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

  // 5) Módulo Agenda (F10): catálogos + deudores ricos + agendados de la semana.
  await seedAgenda(acc, collector.id);

  console.log('✅ Seed completo.');
}

/** Catálogos por defecto + clientes con múltiples tel/dirección/crédito + agendados de la semana. */
async function seedAgenda(acc: string, collectorId: string): Promise<void> {
  // Catálogos (idempotente por el unique (accountId, catalog, code)).
  const catalogs: { catalog: CatalogType; code: string; label: string; sortOrder: number; metadata?: object }[] = [
    { catalog: CatalogType.PAYMENT_METHOD, code: 'CASH', label: 'Efectivo', sortOrder: 1 },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'DEPOSIT', label: 'Depósito', sortOrder: 2, metadata: { requiresBank: true } },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'TRANSFER', label: 'Transferencia', sortOrder: 3, metadata: { requiresBank: true } },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'QR', label: 'QR', sortOrder: 4 },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'CHECK', label: 'Cheque', sortOrder: 5, metadata: { requiresBank: true } },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'MOBILE', label: 'Pago móvil', sortOrder: 6 },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'AGENCY', label: 'Agencia', sortOrder: 7 },
    { catalog: CatalogType.PAYMENT_METHOD, code: 'COLLECTOR', label: 'Cobrador', sortOrder: 8 },
    { catalog: CatalogType.BANK, code: 'BNB', label: 'Banco Nacional de Bolivia', sortOrder: 1 },
    { catalog: CatalogType.BANK, code: 'BCP', label: 'BCP', sortOrder: 2 },
    { catalog: CatalogType.BANK, code: 'BMSC', label: 'Banco Mercantil Santa Cruz', sortOrder: 3 },
    { catalog: CatalogType.BANK, code: 'BISA', label: 'Banco BISA', sortOrder: 4 },
    { catalog: CatalogType.BANK, code: 'UNION', label: 'Banco Unión', sortOrder: 5 },
    { catalog: CatalogType.BANK, code: 'FIE', label: 'Banco FIE', sortOrder: 6 },
    { catalog: CatalogType.BANK, code: 'SOL', label: 'Banco Sol', sortOrder: 7 },
    { catalog: CatalogType.BANK, code: 'ECOFUTURO', label: 'EcoFuturo', sortOrder: 8 },
    { catalog: CatalogType.PRIORITY, code: 'VERY_HIGH', label: 'Muy alta', sortOrder: 1 },
    { catalog: CatalogType.PRIORITY, code: 'HIGH', label: 'Alta', sortOrder: 2 },
    { catalog: CatalogType.PRIORITY, code: 'MEDIUM', label: 'Media', sortOrder: 3 },
    { catalog: CatalogType.PRIORITY, code: 'LOW', label: 'Baja', sortOrder: 4 },
    { catalog: CatalogType.EXPECTED_RESULT, code: 'COLLECT', label: 'Cobrar', sortOrder: 1 },
    { catalog: CatalogType.EXPECTED_RESULT, code: 'REMIND', label: 'Recordar', sortOrder: 2 },
    { catalog: CatalogType.EXPECTED_RESULT, code: 'CONFIRM_VISIT', label: 'Confirmar visita', sortOrder: 3 },
    { catalog: CatalogType.EXPECTED_RESULT, code: 'CONFIRM_PAYMENT', label: 'Confirmar pago', sortOrder: 4 },
    { catalog: CatalogType.EXPECTED_RESULT, code: 'NEGOTIATE', label: 'Negociar', sortOrder: 5 },
    { catalog: CatalogType.PHONE_TYPE, code: 'MOBILE', label: 'Celular', sortOrder: 1 },
    { catalog: CatalogType.PHONE_TYPE, code: 'OFFICE', label: 'Oficina', sortOrder: 2 },
    { catalog: CatalogType.PHONE_TYPE, code: 'HOME', label: 'Casa', sortOrder: 3 },
    { catalog: CatalogType.PHONE_TYPE, code: 'REFERENCE', label: 'Referencia', sortOrder: 4 },
    { catalog: CatalogType.ADDRESS_TYPE, code: 'HOME', label: 'Casa', sortOrder: 1 },
    { catalog: CatalogType.ADDRESS_TYPE, code: 'WORK', label: 'Trabajo', sortOrder: 2 },
    { catalog: CatalogType.ADDRESS_TYPE, code: 'BUSINESS', label: 'Negocio', sortOrder: 3 },
    { catalog: CatalogType.REMINDER_CATEGORY, code: 'PAYMENT', label: 'Pago', sortOrder: 1 },
    { catalog: CatalogType.REMINDER_CATEGORY, code: 'DOCUMENT', label: 'Documento', sortOrder: 2 },
    { catalog: CatalogType.REMINDER_CATEGORY, code: 'FOLLOWUP', label: 'Seguimiento', sortOrder: 3 },
    { catalog: CatalogType.CANCEL_REASON, code: 'CLIENT_UNAVAILABLE', label: 'Cliente no disponible', sortOrder: 1 },
    { catalog: CatalogType.CANCEL_REASON, code: 'WRONG_DATA', label: 'Datos incorrectos', sortOrder: 2 },
    { catalog: CatalogType.RESCHEDULE_REASON, code: 'CLIENT_REQUEST', label: 'A pedido del cliente', sortOrder: 1 },
    { catalog: CatalogType.RESCHEDULE_REASON, code: 'NO_ANSWER', label: 'Sin respuesta', sortOrder: 2 },
    { catalog: CatalogType.CURRENCY, code: 'BOB', label: 'Boliviano', sortOrder: 1 },
    { catalog: CatalogType.CURRENCY, code: 'USD', label: 'Dólar', sortOrder: 2 },
    // Plantillas de WhatsApp (S4): el cuerpo va en `metadata.body` con variables {{cliente}}/{{saldo}}.
    { catalog: CatalogType.WHATSAPP_TEMPLATE, code: 'INITIAL', label: 'Cobro inicial', sortOrder: 1, metadata: { body: 'Hola {{cliente}}, le escribimos de Kobrax para recordarle su saldo pendiente de {{saldo}}. Puede coordinar su pago con nosotros.' } },
    { catalog: CatalogType.WHATSAPP_TEMPLATE, code: 'REMINDER', label: 'Recordatorio', sortOrder: 2, metadata: { body: 'Hola {{cliente}}, le recordamos que su pago de {{saldo}} vence pronto. Quedamos atentos.' } },
    { catalog: CatalogType.WHATSAPP_TEMPLATE, code: 'LAST_NOTICE', label: 'Último aviso', sortOrder: 3, metadata: { body: 'Hola {{cliente}}, su deuda de {{saldo}} se encuentra vencida. Le pedimos regularizar su pago a la brevedad para evitar cargos adicionales.' } },
    // Gestión especial en campo (S5 · RT-6): situaciones que sacan el caso del cobro normal.
    { catalog: CatalogType.SPECIAL_CATEGORY, code: 'DECEASED', label: 'Fallecimiento', sortOrder: 1 },
    { catalog: CatalogType.SPECIAL_CATEGORY, code: 'SERIOUS_ILLNESS', label: 'Enfermedad grave', sortOrder: 2 },
    { catalog: CatalogType.SPECIAL_CATEGORY, code: 'LONG_TRIP', label: 'Viaje prolongado', sortOrder: 3 },
    { catalog: CatalogType.SPECIAL_CATEGORY, code: 'LEGAL_DISPUTE', label: 'Conflicto legal', sortOrder: 4 },
    { catalog: CatalogType.SPECIAL_CATEGORY, code: 'OTHER', label: 'Otro', sortOrder: 5 },
  ];
  await prisma.catalogItem.createMany({
    data: catalogs.map((c) => ({ accountId: acc, catalog: c.catalog, code: c.code, label: c.label, sortOrder: c.sortOrder, metadata: c.metadata ?? {} })),
    skipDuplicates: true,
  });

  // Idempotencia del resto: si ya hay agendados, no re-sembrar deudores/agendados.
  if ((await prisma.agendaItem.count({ where: { accountId: acc } })) > 0) {
    console.log('  ↺ agenda ya sembrada; solo catálogos verificados');
    return;
  }

  // Deudor con caso, múltiples teléfonos y direcciones. Devuelve el caso creado y los ids de sus
  // contactos/direcciones: los `details` de un agendado referencian esos ids, no el texto del teléfono.
  async function makeDebtor(opts: {
    doc: string; firstName: string; lastName: string; balance: number; phones: [string, string][]; addresses: [string, string][];
  }): Promise<{ caseId: string; clientId: string; creditId: string; contactIds: string[]; locationIds: string[] }> {
    // Idempotente por deudor: una corrida anterior pudo dejar los clientes creados y morir antes de
    // los agendados (el `count` de arriba da 0 y no frena nada). Sin esto, re-sembrar tira P2002.
    const prev = await prisma.client.findFirst({
      where: { accountId: acc, nationalIdHash: blindHash(opts.doc) },
      include: { contacts: true, locations: true, cases: true, credits: true },
    });
    if (prev?.cases[0] && prev.credits[0]) {
      return {
        caseId: prev.cases[0].id,
        clientId: prev.id,
        creditId: prev.credits[0].id,
        contactIds: prev.contacts.map((c) => c.id),
        locationIds: prev.locations.map((l) => l.id),
      };
    }
    const client = await prisma.client.create({
      data: {
        accountId: acc,
        firstName: opts.firstName,
        lastName: opts.lastName,
        clientType: ClientType.PERSON,
        nationalId: encryptPII(opts.doc),
        nationalIdHash: blindHash(opts.doc),
        riskSegment: 'MEDIUM',
        contacts: { create: opts.phones.map(([value, label], i) => ({ accountId: acc, contactType: ContactType.PHONE, value: encryptPII(value), isPrimary: i === 0, notes: label })) },
        locations: { create: opts.addresses.map(([address, zone]) => ({ accountId: acc, locationType: LocationType.HOME, address: encryptPII(address), zone })) },
      },
      include: { contacts: true, locations: true },
    });
    const credit = await prisma.credit.create({
      data: { accountId: acc, clientId: client.id, code: `CRD-${opts.doc}`, principalAmount: opts.balance * 1.5, outstandingBalance: opts.balance, interestRate: 0.025, currency: 'BOB', installmentsCount: 12, status: CreditStatus.ACTIVE, daysPastDue: 20 },
    });
    const kase = await prisma.collectionCase.create({
      data: { accountId: acc, creditId: credit.id, clientId: client.id, assigneeId: collectorId, status: CaseStatus.ACTIVE, priority: CasePriority.HIGH },
    });
    return {
      caseId: kase.id,
      clientId: client.id,
      creditId: credit.id,
      contactIds: client.contacts.map((c) => c.id),
      locationIds: client.locations.map((l) => l.id),
    };
  }

  const ana = await makeDebtor({ doc: 'AGN-0002', firstName: 'Ana', lastName: 'Ruiz', balance: 4200, phones: [['70000101', 'Celular'], ['22222201', 'Oficina']], addresses: [['Calle 1 #100', 'Sopocachi'], ['Av. Trabajo 200', 'Miraflores']] });
  const maria = await makeDebtor({ doc: 'AGN-0003', firstName: 'María', lastName: 'Gómez', balance: 8900, phones: [['70000102', 'Celular'], ['70000112', 'Referencia']], addresses: [['Calle 2 #200', 'Centro']] });
  const pedro = await makeDebtor({ doc: 'AGN-0004', firstName: 'Pedro', lastName: 'Flores', balance: 1500, phones: [['70000103', 'Celular']], addresses: [['Zona Sur #300', 'Calacoto'], ['Negocio 400', 'Mercado']] });

  // Juan (demo existente) → 2º crédito para probar "¿cuál crédito?".
  const juan = await prisma.client.findFirst({ where: { accountId: acc, nationalIdHash: blindHash('DEMO-0001') }, select: { id: true } });
  const juanCase = juan ? await prisma.collectionCase.findFirst({ where: { accountId: acc, clientId: juan.id }, select: { id: true, clientId: true, creditId: true } }) : null;
  if (juan && !(await prisma.credit.findFirst({ where: { accountId: acc, code: 'CRD-DEMO-2' }, select: { id: true } }))) {
    const credit2 = await prisma.credit.create({ data: { accountId: acc, clientId: juan.id, code: 'CRD-DEMO-2', principalAmount: 3000, outstandingBalance: 2500, interestRate: 0.03, currency: 'BOB', installmentsCount: 6, status: CreditStatus.ACTIVE, daysPastDue: 10 } });
    // Sin caso abierto, un crédito no es agendable (§8.1) → sin este caso, Juan nunca mostraría
    // el selector de crédito, que es justo lo que este 2º crédito viene a probar.
    await prisma.collectionCase.create({
      data: { accountId: acc, creditId: credit2.id, clientId: juan.id, assigneeId: collectorId, status: CaseStatus.ACTIVE, priority: CasePriority.MEDIUM },
    });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const day = (n: number): Date => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return d; };
  const isoDay = (n: number): string => day(n).toISOString().slice(0, 10);

  // ── Cartera (spec docs/flows/Cliente_Prestamo.pdf) ──────────────────────────────────────────
  // Créditos SIN cronograma: la cuota va congelada en `metadata`, que es como nacen en el móvil.
  // Cubren los 3 modos de captura (§4) y los estados derivados de la tarjeta (§5.3).
  // PROMESA no se siembra: su fuente es una promesa vigente en `agenda_items`, y de dónde leerla se
  // decide en S1 (ver D6 del README de cartera). Los otros 4 estados salen solos de estos datos.
  async function makeLoan(opts: {
    doc: string; firstName: string; lastName: string; phone: string; address: string; zone: string;
    principal: number; balance: number; installmentAmount: number; frequency: string; origin: string;
    /** Días hasta la próxima cuota (negativo = vencida). */ dueIn: number;
    daysPastDue: number; installmentsCount?: number; status?: CreditStatus; externalRef?: string; notes?: string;
  }): Promise<void> {
    if (await prisma.client.findFirst({ where: { accountId: acc, nationalIdHash: blindHash(opts.doc) }, select: { id: true } })) return;
    const client = await prisma.client.create({
      data: {
        accountId: acc,
        firstName: opts.firstName,
        lastName: opts.lastName,
        clientType: ClientType.PERSON,
        nationalId: encryptPII(opts.doc),
        nationalIdHash: blindHash(opts.doc),
        metadata: { origin: opts.origin }, // §3: el origen también se registra en el cliente
        contacts: { create: [{ accountId: acc, contactType: ContactType.PHONE, value: encryptPII(opts.phone), isPrimary: true, notes: 'Celular' }] },
        locations: { create: [{ accountId: acc, locationType: LocationType.HOME, address: encryptPII(opts.address), zone: opts.zone }] },
      },
    });
    const credit = await prisma.credit.create({
      data: {
        accountId: acc,
        clientId: client.id,
        code: `CRD-${opts.doc}`,
        principalAmount: opts.principal,
        outstandingBalance: opts.balance,
        interestRate: 0, // informativa: con cuota congelada no recalcula nada (§4.3)
        currency: 'BOB',
        installmentsCount: opts.installmentsCount ?? 0, // 0 = préstamo abierto (§4.1)
        status: opts.status ?? CreditStatus.ACTIVE,
        daysPastDue: opts.daysPastDue,
        metadata: {
          frequency: opts.frequency,
          origin: opts.origin,
          installmentAmount: opts.installmentAmount,
          nextDueDate: isoDay(opts.dueIn),
          ...(opts.externalRef ? { externalRef: opts.externalRef } : {}),
          ...(opts.notes ? { notes: opts.notes } : {}),
        },
      },
    });
    const priority = opts.daysPastDue <= 0 ? CasePriority.LOW : opts.daysPastDue <= 30 ? CasePriority.MEDIUM : opts.daysPastDue <= 90 ? CasePriority.HIGH : CasePriority.CRITICAL;
    await prisma.collectionCase.create({
      data: { accountId: acc, creditId: credit.id, clientId: client.id, assigneeId: collectorId, status: CaseStatus.ACTIVE, priority },
    });
  }

  // AL DÍA — préstamo semanal del cobrador, próxima cuota lejos.
  await makeLoan({ doc: 'CAR-0001', firstName: 'Lucía', lastName: 'Mamani', phone: '70000201', address: 'Av. Busch 120', zone: 'Miraflores', principal: 3000, balance: 2400, installmentAmount: 300, frequency: 'WEEKLY', origin: 'manual', dueIn: 10, daysPastDue: 0, installmentsCount: 10 });
  // POR VENCER — gota a gota diario, vence en 2 días (umbral del §5.3 = 3).
  await makeLoan({ doc: 'CAR-0002', firstName: 'Rubén', lastName: 'Choque', phone: '70000202', address: 'Mercado Rodríguez p. 4', zone: 'Centro', principal: 1000, balance: 400, installmentAmount: 50, frequency: 'DAILY', origin: 'manual', dueIn: 2, daysPastDue: 0, installmentsCount: 20 });
  // PRÉSTAMO ABIERTO (§4.1) — sin número de cuotas: interés recurrente, el caso que el backend no podía expresar.
  await makeLoan({ doc: 'CAR-0003', firstName: 'Delia', lastName: 'Quispe', phone: '70000203', address: 'Calle Illampu 55', zone: 'Rosario', principal: 2000, balance: 2000, installmentAmount: 200, frequency: 'MONTHLY', origin: 'manual', dueIn: 5, daysPastDue: 0, notes: 'Renovable mientras pague el interés' });
  // EN MORA + IMPORTADO (§4.3) — la mora la manda el archivo; el recálculo NO debe pisarla.
  await makeLoan({ doc: 'CAR-0004', firstName: 'Barbara', lastName: 'Rios', phone: '70000204', address: 'Av. Ballivián 900', zone: 'Calacoto', principal: 859743.98, balance: 841370.06, installmentAmount: 12500, frequency: 'MONTHLY', origin: 'import', dueIn: -37, daysPastDue: 37, installmentsCount: 60, externalRef: '3332088' });
  // IMPORTADO SIN CUOTA — el archivo no la trajo: la ficha muestra saldo y mora, sin cuota (§4.3).
  await makeLoan({ doc: 'CAR-0005', firstName: 'Hugo', lastName: 'Vargas', phone: '70000205', address: 'Villa Fátima s/n', zone: 'Villa Fátima', principal: 15000, balance: 9800, installmentAmount: 0, frequency: 'MONTHLY', origin: 'import', dueIn: -95, daysPastDue: 95, externalRef: '3332099' });
  // PAGADO — saldo 0; se archiva del filtro "Todos" a los 30 días (§5.3).
  await makeLoan({ doc: 'CAR-0006', firstName: 'Nadia', lastName: 'Poma', phone: '70000206', address: 'El Alto, Ceja', zone: 'El Alto', principal: 1200, balance: 0, installmentAmount: 100, frequency: 'MONTHLY', origin: 'manual', dueIn: -3, daysPastDue: 0, installmentsCount: 12, status: CreditStatus.PAID });

  // Agendados: hoy (incl. 1 ejecutado), futuros, y 3 vencidos. Cubren los 5 tipos.
  // `details` sigue el contrato de `validateAgendaDetails` (@kobrax/shared): los tipos con teléfono o
  // dirección referencian el **id** del contacto/ubicación, no su texto — es lo que el detalle (S3)
  // resuelve para los botones Llamar/Navegar. Con las claves equivocadas, el demo se ve roto.
  const items: {
    ref: { caseId: string; clientId: string; creditId: string }; type: AgendaItemType; status: AgendaItemStatus;
    dayOffset: number; time?: string; details: object; observations?: string; priorityCode?: string; expectedResultCode?: string;
  }[] = [
    { ref: ana, type: AgendaItemType.CALL, status: AgendaItemStatus.SCHEDULED, dayOffset: 0, time: '09:30', priorityCode: 'HIGH', expectedResultCode: 'COLLECT', details: { contactId: ana.contactIds[0] }, observations: 'Recordar cuota vencida' },
    { ref: maria, type: AgendaItemType.VISIT, status: AgendaItemStatus.SCHEDULED, dayOffset: 0, time: '11:00', priorityCode: 'VERY_HIGH', expectedResultCode: 'CONFIRM_VISIT', details: { locationId: maria.locationIds[0] } },
    { ref: pedro, type: AgendaItemType.WHATSAPP, status: AgendaItemStatus.EXECUTED, dayOffset: 0, time: '08:15', expectedResultCode: 'REMIND', details: { contactId: pedro.contactIds[0], message: 'Hola, le recordamos su saldo pendiente.' } },
    { ref: ana, type: AgendaItemType.REMINDER, status: AgendaItemStatus.SCHEDULED, dayOffset: 1, time: '10:00', priorityCode: 'MEDIUM', details: { description: 'Adjuntar comprobante de depósito' } },
    { ref: maria, type: AgendaItemType.PROMISE_TO_PAY, status: AgendaItemStatus.SCHEDULED, dayOffset: 2, time: '15:00', expectedResultCode: 'CONFIRM_PAYMENT', details: { amount: 500, paymentMethodCode: 'TRANSFER', bankCode: 'BNB', promiseDate: day(2).toISOString().slice(0, 10) } },
    { ref: pedro, type: AgendaItemType.CALL, status: AgendaItemStatus.SCHEDULED, dayOffset: 3, time: '16:30', priorityCode: 'LOW', details: { contactId: pedro.contactIds[0] } },
    { ref: ana, type: AgendaItemType.CALL, status: AgendaItemStatus.SCHEDULED, dayOffset: -1, time: '09:00', priorityCode: 'HIGH', details: { contactId: ana.contactIds[0] } },
    // Dirección libre: el otro camino de `VisitDetails`, para que el detalle lo ejercite también.
    { ref: maria, type: AgendaItemType.VISIT, status: AgendaItemStatus.SCHEDULED, dayOffset: -2, time: '14:00', priorityCode: 'HIGH', details: { customAddress: { address: 'Feria 16 de Julio, puesto 12', zone: 'El Alto' } } },
    { ref: pedro, type: AgendaItemType.PROMISE_TO_PAY, status: AgendaItemStatus.SCHEDULED, dayOffset: -3, time: '10:30', details: { amount: 300, paymentMethodCode: 'CASH', promiseDate: day(-3).toISOString().slice(0, 10) } },
  ];
  const juanContact = juan ? await prisma.clientContact.findFirst({ where: { clientId: juan.id }, select: { id: true } }) : null;
  if (juanCase && juanContact) {
    items.push({ ref: { caseId: juanCase.id, clientId: juanCase.clientId, creditId: juanCase.creditId }, type: AgendaItemType.WHATSAPP, status: AgendaItemStatus.SCHEDULED, dayOffset: 0, time: '17:00', details: { contactId: juanContact.id, message: 'Hola, ¿coordinamos el pago de esta semana?' } });
  }

  for (const it of items) {
    // El seed escribe `details` directo en la DB, salteándose el DTO del POST. Sin esta guarda, una
    // clave equivocada (`phone` en vez de `contactId`) pasa desapercibida y el demo se ve roto recién
    // en la pantalla de detalle. Mismo validador que corre el server.
    const check = validateAgendaDetails(it.type, it.details);
    if (!check.ok) throw new Error(`seed: details inválidos para ${it.type}: ${check.errors.join('; ')}`);

    await prisma.agendaItem.create({
      data: {
        accountId: acc, caseId: it.ref.caseId, clientId: it.ref.clientId, creditId: it.ref.creditId, assigneeId: collectorId,
        type: it.type, status: it.status, priorityCode: it.priorityCode, expectedResultCode: it.expectedResultCode,
        scheduledDate: day(it.dayOffset), timeMode: ScheduleTimeMode.FIXED, scheduledTime: it.time,
        observations: it.observations, details: it.details, createdBy: collectorId,
      },
    });
  }

  console.log(`  ✓ agenda: ${catalogs.length} catálogos, 3 deudores nuevos, ${items.length} agendados (hoy/futuro/vencidos)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
