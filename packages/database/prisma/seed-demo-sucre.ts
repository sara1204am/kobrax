/**
 * Datos de prueba: un cobrador de SUCRE con visitas a clientes en mora, y sus ubicaciones variadas (cuenta DEMO).
 *
 *   pnpm --filter @kobrax/database exec tsx --env-file=../../.env prisma/seed-demo-sucre.ts
 *
 * Qué deja (todo identificable por el prefijo `DEMO-SU-`):
 *   · El cobrador Álvaro Terrazas (`cobrador.sucre@kobrax.demo`, contraseña del seed principal), de la Agencia Central.
 *   · 8 clientes suyos con crédito EN MORA (5–95 días), TODOS con direcciones en Sucre (Chuquisaca), y entre 2 y 4
 *     ubicaciones por cliente: propias (hogar, trabajo) y de otras personas (garante, familiar), para probar la elección
 *     de ubicación al agregar una parada.
 *   · 6 visitas agendadas para MAÑANA, cada una a una ubicación distinta del cliente (no siempre el hogar).
 *
 * Idempotente: usuario por email, clientes por documento (blind index), créditos por `code`, agenda por (crédito,
 * fecha, tipo). Re-ejecutarlo no duplica nada. No modifica datos existentes.
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  AgendaItemStatus,
  AgendaItemType,
  ClientType,
  ContactType,
  CreditAssignmentKind,
  CreditDataOrigin,
  CreditStatus,
  InstallmentStatus,
  LocationType,
  Prisma,
  PrismaClient,
  RelationshipType,
  ScheduleTimeMode,
  UserStatus,
} from '@prisma/client';
import { RoleType, validateAgendaDetails } from '@kobrax/shared';
import { blindHash, encryptPII } from './pii';

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;
const TODAY_ISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());
const TODAY = new Date(`${TODAY_ISO}T00:00:00.000Z`);
const D = (n: number): Date => new Date(TODAY.getTime() + n * DAY_MS);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

interface Loc {
  type: LocationType;
  zone: string;
  address: string;
  lat?: number;
  lng?: number;
  ref?: string;
  /** Garante o familiar: se crea como persona relacionada y la ubicación cuelga de ella. */
  owner?: string;
  isDefault?: boolean;
}
interface Spec {
  doc: string;
  first: string;
  last: string;
  phone: string;
  credits: { code: string; principal: number; dpd: number; n?: number }[];
  locs: Loc[];
}

const H = LocationType.HOME;
const W = LocationType.WORK;
const G = LocationType.GUARANTOR;
const F = LocationType.FAMILY;

// ── 8 clientes de Sucre (9 créditos). Puntos aproximados: Plaza 25 de Mayo ≈ (-19.0333, -65.2627) ──
const SUCRE: Spec[] = [
  { doc: 'SU-5012873', first: 'Wálter', last: 'Mamani Cruz', phone: '71450101', credits: [{ code: 'DEMO-SU-001', principal: 14000, dpd: 5 }], locs: [
    { type: H, zone: 'Centro', address: 'Calle Bolívar #512, a una cuadra de la Plaza 25 de Mayo', lat: -19.0338, lng: -65.2619, ref: 'Portón de madera, junto a la farmacia', isDefault: true },
    { type: W, zone: 'Centro', address: 'Calle Nicolás Ortiz #78, local 3', lat: -19.0327, lng: -65.2641, ref: 'Tienda de abarrotes' },
    { type: F, zone: 'La Recoleta', address: 'Calle Polanco #230, La Recoleta', lat: -19.0408, lng: -65.2569, owner: 'Carmen Cruz de Mamani' },
  ] },
  { doc: 'SU-6234019', first: 'Dora', last: 'Choque Vargas', phone: '72450102', credits: [{ code: 'DEMO-SU-002', principal: 9500, dpd: 18 }], locs: [
    { type: H, zone: 'Barrio Aranjuez', address: 'Calle Aniceto Arce #1140, Aranjuez', lat: -19.0472, lng: -65.2518, isDefault: true },
    { type: W, zone: 'Mercado Central', address: 'Mercado Central, pasillo 4, puesto 36', lat: -19.0446, lng: -65.2598, ref: 'Venta de frutas' },
    { type: G, zone: 'Centro', address: 'Calle Calvo #305, entre Arenales y Junín', lat: -19.0355, lng: -65.2609, owner: 'Eulogio Vargas Lima' },
  ] },
  { doc: 'SU-3398127', first: 'Rubén', last: 'Salazar Torrico', phone: '73450103', credits: [{ code: 'DEMO-SU-003', principal: 28000, dpd: 33 }, { code: 'DEMO-SU-004', principal: 6000, dpd: 12, n: 6 }], locs: [
    { type: H, zone: 'Av. Ostria Gutiérrez', address: 'Av. Ostria Gutiérrez #890, zona Parque Bolívar', lat: -19.0302, lng: -65.2561, isDefault: true },
    { type: W, zone: 'Av. Hernando Siles', address: 'Av. Hernando Siles #1450, taller mecánico El Rápido', lat: -19.0489, lng: -65.2641 },
    { type: F, zone: 'Villa Armonía', address: 'Calle Los Pinos #44, Villa Armonía', lat: -19.0561, lng: -65.2702, owner: 'Isabel Torrico Rojas' },
    { type: G, zone: 'Centro', address: 'Calle Ravelo #217, segundo piso', lat: -19.0349, lng: -65.2633, owner: 'Hugo Salazar Pinto' },
  ] },
  { doc: 'SU-7781205', first: 'Nilda', last: 'Quispe Ramos', phone: '76450104', credits: [{ code: 'DEMO-SU-005', principal: 11500, dpd: 47 }], locs: [
    { type: H, zone: 'Zona Sur', address: 'Av. Jaime Mendoza #2310, Zona Sur', lat: -19.0617, lng: -65.2589, ref: 'Frente al colegio Santa Ana', isDefault: true },
    { type: F, zone: 'Barrio Petrolero', address: 'Calle Petrolera #118, Barrio Petrolero', lat: -19.0523, lng: -65.2454, owner: 'Basilio Quispe Mollo' },
  ] },
  { doc: 'SU-4467390', first: 'Henry', last: 'Llanos Gutiérrez', phone: '77450105', credits: [{ code: 'DEMO-SU-006', principal: 33000, dpd: 63 }], locs: [
    { type: H, zone: 'San Matías', address: 'Calle San Alberto #670, San Matías', lat: -19.0371, lng: -65.2682, isDefault: true },
    { type: W, zone: 'Centro', address: 'Calle Dalence #402, oficina 5, edificio Charcas', lat: -19.0321, lng: -65.2608, ref: 'Estudio contable' },
    { type: G, zone: 'Av. Venezuela', address: 'Av. Venezuela #1033, esq. Calle Loa', lat: -19.0404, lng: -65.2735, owner: 'Rosario Gutiérrez Aillón' },
  ] },
  { doc: 'SU-8890342', first: 'Mery', last: 'Ayllón Pérez', phone: '68450106', credits: [{ code: 'DEMO-SU-007', principal: 7200, dpd: 78 }], locs: [
    // Domicilio SIN coordenadas: prueba «falta el punto en el mapa».
    { type: H, zone: 'Barrio Lajastambo', address: 'Calle Destacamento 111 #95, Lajastambo', ref: 'Casa celeste con reja negra', isDefault: true },
    { type: W, zone: 'Centro', address: 'Calle Junín #260, panadería La Plaza', lat: -19.0344, lng: -65.2625 },
    { type: F, zone: 'Barrio Aranjuez', address: 'Calle Potosí #488, Aranjuez', lat: -19.0466, lng: -65.2527, owner: 'Teodora Pérez Cuéllar' },
  ] },
  { doc: 'SU-2215568', first: 'Jhonny', last: 'Cuéllar Flores', phone: '60450107', credits: [{ code: 'DEMO-SU-008', principal: 19500, dpd: 95 }], locs: [
    { type: H, zone: 'Av. Germán Mendoza', address: 'Av. Germán Mendoza #1760, urbanización Los Álamos', lat: -19.0575, lng: -65.2486, isDefault: true },
    { type: W, zone: 'Mercado Campesino', address: 'Mercado Campesino, calle 3, puesto 112', lat: -19.0393, lng: -65.2771, ref: 'Venta de verduras' },
    { type: G, zone: 'Centro', address: 'Calle Colón #190, a media cuadra de la Casa de la Libertad', lat: -19.0348, lng: -65.2614, owner: 'Gregorio Flores Mamani' },
    { type: F, zone: 'La Recoleta', address: 'Calle Pedro de Anzúrez #75, La Recoleta', lat: -19.0414, lng: -65.2574, owner: 'Lidia Cuéllar Vda. de Flores' },
  ] },
  { doc: 'SU-9903471', first: 'Patricia', last: 'Tapia Soliz', phone: '79450108', credits: [{ code: 'DEMO-SU-009', principal: 16000, dpd: 26 }], locs: [
    { type: H, zone: 'Barrio Méndez', address: 'Calle Frías #330, Barrio Méndez', lat: -19.0289, lng: -65.2667, isDefault: true },
    { type: W, zone: 'Av. Ostria Gutiérrez', address: 'Av. Ostria Gutiérrez #455, clínica Santa Bárbara', lat: -19.0316, lng: -65.2574, ref: 'Recepción, planta baja' },
  ] },
];

const priorityOf = (dpd: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' => (dpd > 180 ? 'CRITICAL' : dpd > 60 ? 'HIGH' : dpd > 15 ? 'MEDIUM' : 'LOW');

async function seedPerson(acc: string, branchId: string | null, ownerId: string, grantedBy: string | null, s: Spec): Promise<{ clientId: string; created: boolean; credits: { id: string; code: string }[]; locs: { id: string; type: LocationType }[] }> {
  const hash = blindHash(s.doc);
  const existing = await prisma.client.findFirst({ where: { accountId: acc, nationalIdHash: hash }, select: { id: true } });
  let clientId = existing?.id ?? '';
  let created = false;
  if (!existing) {
    created = true;
    clientId = randomUUID();
    await prisma.client.create({
      data: {
        id: clientId,
        accountId: acc,
        clientType: ClientType.PERSON,
        firstName: s.first,
        lastName: s.last,
        nationalId: encryptPII(s.doc),
        nationalIdHash: hash,
        preferredContactChannel: 'PHONE',
        metadata: json({ origin: 'manual', demoTag: 'DEMO-SU' }),
      },
    });
    await prisma.clientContact.create({
      data: { accountId: acc, clientId, contactType: ContactType.PHONE, value: encryptPII(s.phone), isPrimary: true, isVerified: true, notes: 'Celular' },
    });
    for (const l of s.locs) {
      let relationId: string | undefined;
      if (l.owner) {
        relationId = randomUUID();
        await prisma.clientRelation.create({
          data: { id: relationId, accountId: acc, clientId, relatedName: l.owner, relationshipType: l.type === LocationType.FAMILY ? RelationshipType.FAMILY : RelationshipType.GUARANTOR, notes: `${l.type === LocationType.FAMILY ? 'Familiar' : 'Garante'} (datos de prueba DEMO-SU)` },
        });
      }
      await prisma.clientLocation.create({
        data: {
          accountId: acc,
          clientId,
          relationId,
          locationType: l.type,
          address: encryptPII(l.address),
          zone: l.zone,
          ...(l.lat !== undefined && l.lng !== undefined ? { latitude: l.lat, longitude: l.lng } : {}),
          referenceNotes: l.ref,
          // La «predeterminada» es la primera ubicación HOME del cliente (la más antigua): se crea de primera.
        },
      });
    }
  }

  const credits: { id: string; code: string }[] = [];
  for (const c of s.credits) {
    const found = await prisma.credit.findFirst({ where: { accountId: acc, code: c.code, deletedAt: null }, select: { id: true } });
    if (found) {
      credits.push({ id: found.id, code: c.code });
      continue;
    }
    const id = randomUUID();
    const n = c.n ?? 12;
    const amount = round2((c.principal * (1 + 0.012 * n * 0.6)) / n);
    const principalPart = round2(c.principal / n);
    const step = 30;
    const overdueCount = Math.min(n, Math.max(1, Math.ceil(c.dpd / step)));
    const paid = Math.max(0, Math.min(n - overdueCount, 3)); // cuotas pagadas antes de caer en mora
    const firstUnpaid = paid + 1;
    const dueOf = (j: number): number => -c.dpd + (j - firstUnpaid) * step;
    const installments: Prisma.CreditInstallmentCreateManyInput[] = [];
    let overdueAmount = 0;
    for (let j = 1; j <= n; j++) {
      const due = dueOf(j);
      const isPaid = j <= paid;
      const overdue = !isPaid && due < 0;
      if (overdue) overdueAmount += amount;
      installments.push({
        id: randomUUID(),
        accountId: acc,
        creditId: id,
        number: j,
        dueDate: D(due),
        amount,
        principal: principalPart,
        interest: round2(amount - principalPart),
        paidAmount: isPaid ? amount : 0,
        status: isPaid ? InstallmentStatus.PAID : overdue ? InstallmentStatus.OVERDUE : InstallmentStatus.PENDING,
        paidAt: isPaid ? new Date(D(due).getTime() + 15 * 3_600_000) : null,
      });
    }
    const balance = round2(Math.max(0, c.principal - paid * principalPart));
    await prisma.credit.create({
      data: {
        id,
        accountId: acc,
        clientId,
        branchId,
        code: c.code,
        typeCode: 'CONSUMER',
        principalAmount: c.principal,
        outstandingBalance: balance,
        interestRate: 0.012,
        currency: 'BOB',
        installmentsCount: n,
        status: CreditStatus.ACTIVE,
        daysPastDue: c.dpd,
        assignedManagerId: ownerId,
        disbursedAt: D(dueOf(1) - step),
        origin: CreditDataOrigin.MANUAL,
        metadata: json({ frequency: 'MONTHLY', origin: 'manual', installmentAmount: amount, nextDueDate: D(dueOf(firstUnpaid)).toISOString().slice(0, 10), demoTag: 'DEMO-SU' }),
      },
    });
    await prisma.creditInstallment.createMany({ data: installments });
    await prisma.arrear.create({
      data: { accountId: acc, creditId: id, daysOverdue: c.dpd, overdueAmount: round2(overdueAmount), interest: round2(overdueAmount * 0.02), penalty: round2(overdueAmount * 0.01) },
    });
    await prisma.creditAssignment.create({
      data: { accountId: acc, creditId: id, userId: ownerId, kind: CreditAssignmentKind.PRINCIPAL, startsAt: new Date(D(-(c.dpd + 20)).getTime() + 13 * 3_600_000), grantedBy },
    });
    // El trigger de `credits` abre el episodio; se alinea con el día civil de La Paz y se le pone la prioridad.
    await prisma.$executeRaw`
      UPDATE credit_arrear_episodes
         SET started_at = ${TODAY}::date - ${c.dpd}::int,
             priority = ${priorityOf(c.dpd)}::collection_priority
       WHERE credit_id = ${id} AND ended_at IS NULL`;
    credits.push({ id, code: c.code });
  }
  const locs = await prisma.clientLocation.findMany({ where: { accountId: acc, clientId }, orderBy: { createdAt: 'asc' }, select: { id: true, locationType: true } });
  return { clientId, created, credits, locs: locs.map((l) => ({ id: l.id, type: l.locationType })) };
}

async function main(): Promise<void> {
  const acc = await prisma.account.findUniqueOrThrow({ where: { code: 'DEMO' }, select: { id: true } });

  // ── El cobrador: usuario, membresía como COLLECTOR en la Agencia Central, y su supervisora ──
  const sandra = await prisma.user.findUniqueOrThrow({ where: { email: 'supervisor@kobrax.demo' }, select: { id: true } });
  const cen = await prisma.branch.findFirstOrThrow({ where: { accountId: acc.id, code: 'CEN', deletedAt: null }, select: { id: true } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: RoleType.COLLECTOR }, select: { id: true } });
  const email = 'cobrador.sucre@kobrax.demo';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await bcrypt.hash('Kobrax123!', 12),
      status: UserStatus.ACTIVE,
      requiresPasswordChange: false,
      profile: { create: { firstName: 'Álvaro', lastName: 'Terrazas', supervisorUserId: sandra.id } },
    },
    select: { id: true },
  });
  await prisma.userAccount.upsert({
    where: { userId_accountId: { userId: user.id, accountId: acc.id } },
    update: { roleId: role.id, branchId: cen.id },
    create: { userId: user.id, accountId: acc.id, roleId: role.id, branchId: cen.id },
  });

  const people: Awaited<ReturnType<typeof seedPerson>>[] = [];
  for (const s of SUCRE) people.push(await seedPerson(acc.id, cen.id, user.id, sandra.id, s));

  // ── Agenda de mañana: seis visitas, cada una a una ubicación DISTINTA del cliente ──
  const plan: { code: string; at: LocationType; time?: string }[] = [
    { code: 'DEMO-SU-001', at: LocationType.WORK, time: '09:00' },
    { code: 'DEMO-SU-002', at: LocationType.WORK },
    { code: 'DEMO-SU-003', at: LocationType.FAMILY },
    { code: 'DEMO-SU-006', at: LocationType.GUARANTOR, time: '14:30' },
    { code: 'DEMO-SU-008', at: LocationType.HOME },
    { code: 'DEMO-SU-005', at: LocationType.FAMILY },
  ];
  const tomorrow = D(1);
  let agendaNew = 0;
  for (const v of plan) {
    const person = people.find((p) => p.credits.some((c) => c.code === v.code))!;
    const credit = person.credits.find((c) => c.code === v.code)!;
    const loc = person.locs.find((l) => l.type === v.at);
    if (!loc) throw new Error(`${v.code}: no tiene ubicación ${v.at}`);
    const dup = await prisma.agendaItem.findFirst({
      where: { accountId: acc.id, creditId: credit.id, assigneeId: user.id, type: AgendaItemType.VISIT, scheduledDate: tomorrow, deletedAt: null },
      select: { id: true },
    });
    if (dup) continue;
    const check = validateAgendaDetails(AgendaItemType.VISIT, { locationId: loc.id });
    if (!check.ok) throw new Error(`details inválidos: ${check.errors.join('; ')}`);
    await prisma.agendaItem.create({
      data: {
        accountId: acc.id,
        clientId: person.clientId,
        creditId: credit.id,
        assigneeId: user.id,
        type: AgendaItemType.VISIT,
        status: AgendaItemStatus.SCHEDULED,
        priorityCode: 'HIGH',
        expectedResultCode: 'COLLECT',
        scheduledDate: tomorrow,
        timeMode: ScheduleTimeMode.FIXED,
        scheduledTime: v.time ?? null,
        observations: `Visita a ${v.at} ${v.time ? `con hora fija ${v.time}` : 'sin hora'} (datos de prueba DEMO-SU)`,
        details: json(check.value),
        createdBy: sandra.id,
      },
    });
    agendaNew++;
  }

  console.log(`Álvaro Terrazas userId=${user.id}  (${email} / Kobrax123!)`);
  console.log(`Clientes nuevos: ${people.filter((p) => p.created).length}/${SUCRE.length}`);
  console.log(`Visitas agendadas nuevas para ${tomorrow.toISOString().slice(0, 10)}: ${agendaNew}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
