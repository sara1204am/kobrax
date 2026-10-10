/**
 * Datos de prueba para el wizard «Planificar ruta» y el mapa de la ruta (cuenta DEMO).
 *
 *   pnpm --filter @kobrax/database exec tsx --env-file=../../.env prisma/seed-demo-rutas.ts
 *
 * Qué deja (todo identificable por el prefijo `DEMO-DM-`):
 *   · 9 clientes de Diego Mamani (cobrador `cobrador6@kobrax.demo`) con 10 créditos EN MORA (3–90 días), su
 *     asignación PRINCIPAL y 2–3 ubicaciones con coordenadas en La Paz / El Alto (dos sin coordenadas).
 *   · 5 clientes con crédito en mora de Carlos Collector, SIN ruta y SIN visita, a 200–900 m de las paradas de
 *     la ruta de pruebas (para las sugerencias de visita preventiva).
 *   · 2 visitas agendadas de Diego para MAÑANA (una a las 10:00, otra sin hora fija).
 *
 * Idempotente: clientes por documento (blind index), créditos por `code`, agenda por (crédito, fecha, tipo).
 * Re-ejecutarlo no duplica nada. No borra ni modifica datos existentes. Conecta como superusuario (DATABASE_URL),
 * como el seed principal, así que RLS no estorba; todo lleva `account_id` de la cuenta DEMO.
 */
import { randomUUID } from 'node:crypto';
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
} from '@prisma/client';
import { validateAgendaDetails } from '@kobrax/shared';
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
  /** Garante: se crea como persona relacionada y la ubicación cuelga de ella (`owner_name`). */
  owner?: string;
  isDefault?: boolean;
}
interface Spec {
  doc: string;
  first: string;
  last: string;
  phone: string;
  /** Códigos de créditos: [code, principal, dpd, owner]. */
  credits: { code: string; principal: number; dpd: number; n?: number }[];
  locs: Loc[];
}

const H = LocationType.HOME;
const W = LocationType.WORK;
const G = LocationType.GUARANTOR;

// ── Diego Mamani: 9 clientes, 10 créditos ─────────────────────────────────────
const DIEGO: Spec[] = [
  { doc: 'DM-4521873', first: 'Rufino', last: 'Quispe Condori', phone: '71234501', credits: [{ code: 'DEMO-DM-001', principal: 9000, dpd: 3 }], locs: [
    { type: H, zone: 'Sopocachi', address: 'Av. 20 de Octubre #2210, esq. Rosendo Gutiérrez', lat: -16.5112, lng: -68.1269, ref: 'Edificio con portón verde', isDefault: true },
    { type: W, zone: 'Centro', address: 'Calle Comercio #1150, entre Loayza y Colón', lat: -16.4958, lng: -68.1339, ref: 'Local de repuestos' },
  ] },
  { doc: 'DM-6098214', first: 'Marleny', last: 'Choque Apaza', phone: '72234502', credits: [{ code: 'DEMO-DM-002', principal: 15000, dpd: 12 }], locs: [
    { type: H, zone: 'Miraflores', address: 'Calle Belisario Salinas #640, Miraflores', lat: -16.5036, lng: -68.1187, isDefault: true },
    { type: W, zone: 'Miraflores', address: 'Av. Busch #1523, frente al Hospital de Clínicas', lat: -16.5071, lng: -68.1229 },
    { type: G, zone: 'San Pedro', address: 'Calle Luis Lara #512, San Pedro', lat: -16.5001, lng: -68.1396, owner: 'Hilda Apaza Mamani' },
  ] },
  { doc: 'DM-3367745', first: 'Wilfredo', last: 'Mamani Huanca', phone: '73234503', credits: [{ code: 'DEMO-DM-003', principal: 22000, dpd: 25 }, { code: 'DEMO-DM-004', principal: 5000, dpd: 8, n: 6 }], locs: [
    { type: H, zone: 'El Alto', address: 'Av. Juan Pablo II #4120, Villa Adela, El Alto', lat: -16.5105, lng: -68.1712, ref: 'Frente a la tienda Doña Elva', isDefault: true },
    { type: W, zone: 'El Alto', address: 'Av. 6 de Marzo #318, Ceja de El Alto', lat: -16.5057, lng: -68.1655 },
  ] },
  { doc: 'DM-7712930', first: 'Brígida', last: 'Flores Yujra', phone: '76234504', credits: [{ code: 'DEMO-DM-005', principal: 12500, dpd: 41 }], locs: [
    { type: H, zone: 'San Miguel', address: 'Calle 21 de Calacoto #8230, San Miguel', lat: -16.5378, lng: -68.0861, isDefault: true },
    { type: W, zone: 'Calacoto', address: 'Av. Ballivián #1020, Calacoto', lat: -16.5421, lng: -68.0812 },
    { type: G, zone: 'Obrajes', address: 'Calle 3 de Obrajes #455, Obrajes', lat: -16.5195, lng: -68.1088, owner: 'Nicolás Yujra Tola' },
  ] },
  { doc: 'DM-5589021', first: 'Edgar', last: 'Villca Nina', phone: '77234505', credits: [{ code: 'DEMO-DM-006', principal: 30000, dpd: 58 }], locs: [
    { type: H, zone: 'Calacoto', address: 'Calle 15 de Calacoto #7530, edificio Los Pinos', lat: -16.5402, lng: -68.0795, isDefault: true },
    { type: W, zone: 'Centro', address: 'Av. Camacho #1485, piso 3, oficina 7', lat: -16.4989, lng: -68.1355 },
  ] },
  { doc: 'DM-8820156', first: 'Teodora', last: 'Condori Laura', phone: '68234506', credits: [{ code: 'DEMO-DM-007', principal: 7500, dpd: 77 }], locs: [
    // Domicilio SIN coordenadas: prueba «falta el punto en el mapa».
    { type: H, zone: 'Sopocachi', address: 'Calle Fernando Guachalla #380, Sopocachi', ref: 'Casa de dos pisos, reja negra', isDefault: true },
    { type: W, zone: 'San Pedro', address: 'Mercado Rodríguez, puesto 112', lat: -16.4991, lng: -68.1376 },
  ] },
  { doc: 'DM-2903318', first: 'Freddy', last: 'Ticona Mendoza', phone: '60234507', credits: [{ code: 'DEMO-DM-008', principal: 18000, dpd: 90 }], locs: [
    { type: H, zone: 'El Alto', address: 'Calle 2 #135, Urbanización Ballivián, El Alto', lat: -16.5002, lng: -68.1587, isDefault: true },
    { type: G, zone: 'Miraflores', address: 'Calle Landaeta #1022, Miraflores', lat: -16.5048, lng: -68.1241, owner: 'Rosario Mendoza Chura' },
  ] },
  { doc: 'DM-9145672', first: 'Gladys', last: 'Aliaga Poma', phone: '79234508', credits: [{ code: 'DEMO-DM-009', principal: 11000, dpd: 19 }], locs: [
    { type: H, zone: 'Miraflores', address: 'Av. Saavedra #1890, Miraflores', lat: -16.5009, lng: -68.1148, isDefault: true },
    { type: W, zone: 'Sopocachi', address: 'Plaza Avaroa, Av. 16 de Julio local 5', lat: -16.5097, lng: -68.1304 },
    // Garante SIN coordenadas.
    { type: G, zone: 'Centro', address: 'Calle Yanacocha #721, zona central', owner: 'Jaime Poma Ríos' },
  ] },
  { doc: 'DM-1678405', first: 'Hernán', last: 'Salazar Cussi', phone: '75234509', credits: [{ code: 'DEMO-DM-010', principal: 26000, dpd: 34 }], locs: [
    { type: H, zone: 'Calacoto', address: 'Calle 9 de Calacoto #7114, San Miguel', lat: -16.5361, lng: -68.0832, isDefault: true },
    { type: W, zone: 'San Miguel', address: 'Av. Montenegro #210, San Miguel', lat: -16.5392, lng: -68.0877 },
  ] },
];

// ── Clientes de Carlos Collector cerca de las paradas de la ruta de pruebas ──
// (distancia aproximada a la parada indicada: 360–720 m)
const CARLOS: Spec[] = [
  { doc: 'DM-3011987', first: 'Ramiro', last: 'Cáceres Luna', phone: '71334601', credits: [{ code: 'DEMO-DM-C01', principal: 8000, dpd: 14 }], locs: [
    { type: H, zone: 'Miraflores', address: 'Calle Hugo Ernst #1120 (cerca de parada 2)', lat: -16.499, lng: -68.1395, isDefault: true },
    { type: W, zone: 'Miraflores', address: 'Calle Juan José Pérez #355 (cerca de parada 2)', lat: -16.4984, lng: -68.1402 },
  ] },
  { doc: 'DM-4412765', first: 'Lourdes', last: 'Rojas Paco', phone: '72334602', credits: [{ code: 'DEMO-DM-C02', principal: 13500, dpd: 29 }], locs: [
    { type: H, zone: 'Sopocachi', address: 'Calle Pedro Salazar #915 (cerca de parada 3)', lat: -16.5155, lng: -68.174, isDefault: true },
    { type: G, zone: 'Sopocachi', address: 'Calle Guerrilleros Lanza #204 (cerca de parada 3)', lat: -16.5161, lng: -68.1731, owner: 'Esteban Paco Limachi' },
  ] },
  { doc: 'DM-5523410', first: 'Marcelino', last: 'Gutiérrez Tarqui', phone: '73334603', credits: [{ code: 'DEMO-DM-C03', principal: 6000, dpd: 52 }], locs: [
    { type: H, zone: 'Centro', address: 'Calle Sagárnaga #330 (cerca de parada 6)', lat: -16.4935, lng: -68.175, isDefault: true },
    { type: W, zone: 'Centro', address: 'Calle Illampu #690 (cerca de parada 6)', lat: -16.4927, lng: -68.1762 },
  ] },
  { doc: 'DM-6634251', first: 'Estela', last: 'Vargas Colque', phone: '76334604', credits: [{ code: 'DEMO-DM-C04', principal: 19000, dpd: 7 }], locs: [
    { type: H, zone: 'San Miguel', address: 'Calle 14 de Calacoto #6890 (cerca de parada 4)', lat: -16.519, lng: -68.1235, isDefault: true },
    { type: W, zone: 'Obrajes', address: 'Av. Hernando Siles #5430 (cerca de parada 4)', lat: -16.5183, lng: -68.1246 },
  ] },
  { doc: 'DM-7745592', first: 'Oscar', last: 'Mollo Blanco', phone: '77334605', credits: [{ code: 'DEMO-DM-C05', principal: 10500, dpd: 66 }], locs: [
    { type: H, zone: 'Miraflores', address: 'Av. Periférica #1450 (cerca de parada 1)', lat: -16.4975, lng: -68.1415, isDefault: true },
    { type: W, zone: 'Miraflores', address: 'Calle Sucre #280 (cerca de parada 1)', lat: -16.4969, lng: -68.1424 },
  ] },
];

const priorityOf = (dpd: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' => (dpd > 180 ? 'CRITICAL' : dpd > 60 ? 'HIGH' : dpd > 15 ? 'MEDIUM' : 'LOW');

async function seedPerson(acc: string, branchId: string | null, ownerId: string, grantedBy: string | null, s: Spec): Promise<{ clientId: string; created: boolean; credits: { id: string; code: string }[]; homeId: string | null }> {
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
        metadata: json({ origin: 'manual', demoTag: 'DEMO-DM' }),
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
          data: { id: relationId, accountId: acc, clientId, relatedName: l.owner, relationshipType: RelationshipType.GUARANTOR, notes: 'Garante (datos de prueba DEMO-DM)' },
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
        metadata: json({ frequency: 'MONTHLY', origin: 'manual', installmentAmount: amount, nextDueDate: D(dueOf(firstUnpaid)).toISOString().slice(0, 10), demoTag: 'DEMO-DM' }),
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
  const home = await prisma.clientLocation.findFirst({ where: { accountId: acc, clientId, relationId: null, locationType: LocationType.HOME }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return { clientId, created, credits, homeId: home?.id ?? null };
}

async function main(): Promise<void> {
  const acc = await prisma.account.findUniqueOrThrow({ where: { code: 'DEMO' }, select: { id: true } });
  const userByEmail = async (email: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, profile: { select: { supervisorUserId: true } } } });
    const m = await prisma.userAccount.findUniqueOrThrow({ where: { userId_accountId: { userId: u.id, accountId: acc.id } }, select: { branchId: true } });
    return { id: u.id, supervisor: u.profile?.supervisorUserId ?? null, branchId: m.branchId };
  };
  const diego = await userByEmail('cobrador6@kobrax.demo'); // Diego Mamani
  const carlos = await userByEmail('collector@kobrax.demo'); // Carlos Collector

  const mine: { clientId: string; created: boolean; credits: { id: string; code: string }[]; homeId: string | null }[] = [];
  for (const s of DIEGO) mine.push(await seedPerson(acc.id, diego.branchId, diego.id, diego.supervisor, s));
  const carlosRes: typeof mine = [];
  for (const s of CARLOS) carlosRes.push(await seedPerson(acc.id, carlos.branchId, carlos.id, carlos.supervisor, s));

  // ── Agenda de mañana (hoy + 1 día civil de La Paz) ──
  const tomorrow = D(1);
  const visits: { code: string; time?: string }[] = [
    { code: 'DEMO-DM-001', time: '10:00' },
    { code: 'DEMO-DM-002' },
  ];
  let agendaNew = 0;
  for (const v of visits) {
    const person = mine.find((p) => p.credits.some((c) => c.code === v.code))!;
    const credit = person.credits.find((c) => c.code === v.code)!;
    const dup = await prisma.agendaItem.findFirst({
      where: { accountId: acc.id, creditId: credit.id, assigneeId: diego.id, type: AgendaItemType.VISIT, scheduledDate: tomorrow, deletedAt: null },
      select: { id: true },
    });
    if (dup) continue;
    const check = validateAgendaDetails(AgendaItemType.VISIT, { locationId: person.homeId });
    if (!check.ok) throw new Error(`details inválidos: ${check.errors.join('; ')}`);
    await prisma.agendaItem.create({
      data: {
        accountId: acc.id,
        clientId: person.clientId,
        creditId: credit.id,
        assigneeId: diego.id,
        type: AgendaItemType.VISIT,
        status: AgendaItemStatus.SCHEDULED,
        priorityCode: 'HIGH',
        expectedResultCode: 'COLLECT',
        scheduledDate: tomorrow,
        timeMode: ScheduleTimeMode.FIXED,
        scheduledTime: v.time ?? null,
        observations: v.time ? 'Visita con hora fija (datos de prueba DEMO-DM)' : 'Visita sin hora (datos de prueba DEMO-DM)',
        details: json(check.value),
        createdBy: diego.supervisor ?? diego.id,
      },
    });
    agendaNew++;
  }

  console.log(`Diego Mamani userId=${diego.id}  Carlos Collector userId=${carlos.id}`);
  console.log(`Clientes nuevos: Diego ${mine.filter((m) => m.created).length}/${DIEGO.length}, Carlos ${carlosRes.filter((m) => m.created).length}/${CARLOS.length}`);
  console.log(`Visitas agendadas nuevas para ${tomorrow.toISOString().slice(0, 10)}: ${agendaNew}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
