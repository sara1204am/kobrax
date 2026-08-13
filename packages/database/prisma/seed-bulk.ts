/**
 * Una cartera GRANDE de verdad, en Sucre, para mirar el panel con volumen.
 *
 *   pnpm --filter @kobrax/database db:seed:bulk
 *
 * El seed principal arma el contrato y `seed-day` un día de campo mirable. Ninguno de los dos
 * responde la pregunta que aparece con la cartera cargada: **¿esto aguanta y se lee con mil
 * deudores?** Paginación, orden por mora, la agenda de un día lleno, una ruta de verdad.
 *
 * Lo que deja:
 *   · 1200 deudores en Sucre, cada uno con 2-3 teléfonos y su ubicación con punto
 *   · ~1750 créditos (algunos tienen 2 o 3), TODOS en mora: de 1 a 450 días
 *   · un caso de cobranza por crédito, con prioridad según la mora
 *   · ~5500 agendados repartidos 80/20 entre visitas y llamadas, sobre 50 días hábiles
 *   · una ruta por cobrador y por día, de EXACTAMENTE 8 paradas
 *
 * **Es aditivo e idempotente**: si ya hay créditos `BLK-`, no hace nada. No toca lo que sembraron
 * los otros dos.
 *
 * ponytail: `createMany` por lotes y los uuid generados acá. Con `create` fila por fila esto son
 * ~31.000 viajes a la base; así son unas decenas.
 */
import { randomUUID } from 'node:crypto';
import {
  AgendaItemStatus,
  AgendaItemType,
  CasePriority,
  CaseStatus,
  ClientType,
  ContactType,
  CreditStatus,
  InstallmentStatus,
  LocationType,
  Prisma,
  PrismaClient,
  RouteStatus,
  RouteStopStatus,
  ScheduleTimeMode,
  UserStatus,
} from '@prisma/client';

import { blindHash, encryptPII } from './pii';

const prisma = new PrismaClient();

// ── Parámetros ───────────────────────────────────────────────────────────────
const CLIENTS = 1200;
/** Cobradores del tenant. Uno solo con 4000 visitas no es una cartera, es un chiste. */
const COLLECTORS = 11;
const PAST_DAYS = 45;
const FUTURE_DAYS = 5;
/** Pedido explícito: **cada ruta que se arme es de 8 visitas**. */
const STOPS_PER_ROUTE = 8;
/** Una llamada cada cuatro visitas → las visitas quedan en el 80 % de la agenda. */
const CALLS_PER_VISIT = 0.25;

// ── Aleatoriedad reproducible ────────────────────────────────────────────────
// Sembrada y determinista: dos corridas dan la misma cartera, así un número raro en pantalla se
// puede volver a mirar en vez de desaparecer con el próximo seed.
let state = 0x9e3779b9;
function rnd(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}
const int = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;

// ── Sucre ────────────────────────────────────────────────────────────────────
/** Barrios reales con su punto aproximado. El jitter los reparte por la manzana. */
const ZONES = [
  { name: 'Centro', lat: -19.0478, lng: -65.2592 },
  { name: 'La Recoleta', lat: -19.0561, lng: -65.256 },
  { name: 'Alto Delicias', lat: -19.0342, lng: -65.2661 },
  { name: 'Villa Armonía', lat: -19.0625, lng: -65.2711 },
  { name: 'Aranjuez', lat: -19.0396, lng: -65.2489 },
  { name: 'Barrio Petrolero', lat: -19.0289, lng: -65.2745 },
  { name: 'Mercado Campesino', lat: -19.0311, lng: -65.2612 },
  { name: 'San Matías', lat: -19.0402, lng: -65.2803 },
  { name: 'Lajastambo', lat: -19.0658, lng: -65.2447 },
  { name: 'Tucsupaya', lat: -19.0231, lng: -65.2495 },
  { name: 'Los Pinos', lat: -19.0509, lng: -65.2712 },
  { name: 'Garcilazo', lat: -19.0442, lng: -65.2686 },
] as const;

const STREETS = [
  'Calle Junín', 'Calle Bolívar', 'Av. Hernando Siles', 'Calle Ravelo', 'Av. Jaime Mendoza',
  'Calle Loa', 'Calle Camargo', 'Av. Del Maestro', 'Calle Destacamento 111', 'Av. Ostria Gutiérrez',
  'Calle Colón', 'Calle Grau', 'Av. Marcelo Quiroga', 'Calle Arenales', 'Pasaje Tarapacá',
] as const;

const FIRST_NAMES = [
  'María', 'Juana', 'Rosa', 'Carmen', 'Elena', 'Gladys', 'Silvia', 'Teresa', 'Norma', 'Lucía',
  'Juan', 'Carlos', 'Luis', 'José', 'Pedro', 'Marco', 'Freddy', 'Ramiro', 'Wilson', 'Grover',
  'Ana', 'Vilma', 'Delia', 'Sonia', 'Rocío', 'Mario', 'Édgar', 'Nelson', 'Hugo', 'Rubén',
] as const;

const LAST_NAMES = [
  'Mamani', 'Quispe', 'Flores', 'Choque', 'Condori', 'Vargas', 'Rojas', 'Apaza', 'Nina', 'Colque',
  'Poma', 'Arancibia', 'Zeballos', 'Cruz', 'Villarroel', 'Guzmán', 'Ledezma', 'Ayaviri', 'Calvimontes',
  'Padilla', 'Serrudo', 'Tapia', 'Ovando', 'Barrientos', 'Camacho', 'Sandoval', 'Terrazas',
] as const;

const BUSINESS = [
  'Tienda', 'Ferretería', 'Panadería', 'Librería', 'Carpintería', 'Taller', 'Distribuidora', 'Sastrería',
] as const;

const OBS_VISIT = [
  'Pasar por la mañana, después sale a la feria.',
  'Vive al fondo del pasaje, portón verde.',
  'Preguntar por la señora, el esposo no atiende.',
  'Está poniendo la cuota los viernes.',
  'Perro suelto, tocar bocina.',
] as const;

const OBS_CALL = [
  'Contestó y pidió llamar el lunes.',
  'Buzón de voz, insistir a la tarde.',
  'Confirmó que deposita esta semana.',
  'Número apagado, probar el segundo.',
] as const;

// ── Fechas ───────────────────────────────────────────────────────────────────
const TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
const isWeekday = (d: Date): boolean => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** Días hábiles alrededor de hoy: la agenda de sábado y domingo no existe. */
function workDays(): Date[] {
  const all: Date[] = [];
  for (let i = -PAST_DAYS * 2; i <= FUTURE_DAYS * 2; i++) {
    const d = addDays(TODAY, i);
    if (isWeekday(d)) all.push(d);
  }
  return [
    ...all.filter((d) => d < TODAY).slice(-PAST_DAYS),
    ...all.filter((d) => d >= TODAY).slice(0, FUTURE_DAYS + 1),
  ];
}

/**
 * La mora, de 1 a 450 días y **con la forma que tiene de verdad**: la mayoría joven y una cola
 * larga de irrecuperables. Los dos extremos van fijos para que el rango pedido esté siempre.
 */
function daysPastDue(i: number): number {
  if (i === 0) return 450;
  if (i === 1) return 1;
  const r = rnd();
  if (r < 0.55) return int(1, 30);
  if (r < 0.8) return int(31, 90);
  if (r < 0.93) return int(91, 180);
  if (r < 0.98) return int(181, 300);
  return int(301, 450);
}

const priorityOf = (dpd: number): CasePriority =>
  dpd > 180 ? CasePriority.CRITICAL : dpd > 60 ? CasePriority.HIGH : dpd > 15 ? CasePriority.MEDIUM : CasePriority.LOW;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const chunks = <T>(rows: T[], size = 1000): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size));

async function main(): Promise<void> {
  const account = await prisma.account.findFirst({ where: { code: 'DEMO' } });
  if (!account) throw new Error('No existe el tenant DEMO. Corré primero `pnpm db:seed`.');
  const acc = account.id;

  const already = await prisma.credit.findFirst({ where: { accountId: acc, code: { startsWith: 'BLK-' } } });
  if (already) {
    console.log('  ↷ la cartera grande ya está sembrada (créditos BLK-). Nada que hacer.');
    return;
  }

  // ── Cobradores ─────────────────────────────────────────────────────────────
  // Reusan el hash de contraseña del cobrador demo en vez de calcular uno: todos los usuarios de
  // prueba comparten `Kobrax123!`, y así el seed no necesita bcrypt.
  const carlos = await prisma.user.findUnique({ where: { email: 'collector@kobrax.demo' } });
  if (!carlos) throw new Error('No existe collector@kobrax.demo. Corré primero `pnpm db:seed`.');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'COLLECTOR' } });

  const collectorIds = [carlos.id];
  for (let i = 1; i < COLLECTORS; i++) {
    const email = `cobrador${i}@kobrax.demo`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash: carlos.passwordHash,
        status: UserStatus.ACTIVE,
        requiresPasswordChange: false,
        profile: { create: { firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES) } },
      },
    });
    await prisma.userAccount.upsert({
      where: { userId_accountId: { userId: user.id, accountId: acc } },
      update: {},
      create: { userId: user.id, accountId: acc, roleId: role.id },
    });
    collectorIds.push(user.id);
  }

  // ── Deudores, teléfonos y ubicación ────────────────────────────────────────
  const clients: { id: string; zone: (typeof ZONES)[number] }[] = [];
  // Tipadas con los `CreateManyInput` de Prisma: un campo mal escrito se ve acá y no después de
  // insertar treinta mil filas.
  const clientRows: Prisma.ClientCreateManyInput[] = [];
  const contactRows: Prisma.ClientContactCreateManyInput[] = [];
  const locationRows: Prisma.ClientLocationCreateManyInput[] = [];

  for (let i = 0; i < CLIENTS; i++) {
    const id = randomUUID();
    const zone = pick(ZONES);
    const isBusiness = rnd() < 0.12;
    const lastName = `${pick(LAST_NAMES)} ${pick(LAST_NAMES)}`;
    const firstName = pick(FIRST_NAMES);
    const doc = `BLK${String(10_000 + i)}`;

    clientRows.push({
      id,
      accountId: acc,
      clientType: isBusiness ? ClientType.COMPANY : ClientType.PERSON,
      firstName: isBusiness ? null : firstName,
      lastName: isBusiness ? null : lastName,
      businessName: isBusiness ? `${pick(BUSINESS)} ${lastName.split(' ')[0]}` : null,
      nationalId: encryptPII(doc),
      nationalIdHash: blindHash(doc),
      riskSegment: rnd() < 0.25 ? 'HIGH' : rnd() < 0.6 ? 'MEDIUM' : 'LOW',
      preferredContactChannel: rnd() < 0.6 ? 'PHONE' : 'WHATSAPP',
    });

    // Pedido explícito: **más de un teléfono**. Uno es el propio y el otro el de referencia, que
    // es como funciona en campo — cuando el primero no contesta, se llama al segundo.
    const phones = int(2, 3);
    for (let p = 0; p < phones; p++) {
      contactRows.push({
        accountId: acc,
        clientId: id,
        contactType: p === phones - 1 && rnd() < 0.4 ? ContactType.WHATSAPP : ContactType.PHONE,
        value: rnd() < 0.75 ? `7${int(1_000_000, 9_999_999)}` : `4${int(600_000, 699_999)}`,
        isPrimary: p === 0,
        isVerified: rnd() < 0.7,
        notes: p === 0 ? null : pick(['Referencia', 'Vecina', 'Hijo', 'Trabajo']),
      });
    }

    locationRows.push({
      accountId: acc,
      clientId: id,
      locationType: LocationType.HOME,
      address: encryptPII(`${pick(STREETS)} N° ${int(10, 1990)}`),
      zone: zone.name,
      // El jitter va en el punto y no en la dirección: sin coordenadas propias el mapa apila a
      // todo el barrio en un mismo pin y la ruta no se puede leer.
      latitude: round6(zone.lat + (rnd() - 0.5) * 0.008),
      longitude: round6(zone.lng + (rnd() - 0.5) * 0.008),
      referenceNotes: rnd() < 0.5 ? pick(['Frente a la cancha', 'Al lado de la tienda', 'Portón azul']) : null,
    });

    clients.push({ id, zone });
  }

  await write('deudores', clientRows, (c) => prisma.client.createMany({ data: c }));
  await write('teléfonos', contactRows, (c) => prisma.clientContact.createMany({ data: c }));
  await write('ubicaciones', locationRows, (c) => prisma.clientLocation.createMany({ data: c }));

  // ── Créditos, cronogramas y casos ──────────────────────────────────────────
  const creditRows: Prisma.CreditCreateManyInput[] = [];
  const installmentRows: Prisma.CreditInstallmentCreateManyInput[] = [];
  const caseRows: Prisma.CollectionCaseCreateManyInput[] = [];
  /** Los casos, para repartirlos después entre agenda y rutas. */
  const cases: { id: string; clientId: string; creditId: string; dpd: number }[] = [];
  let code = 0;

  for (const [ci, client] of clients.entries()) {
    // Algunos deudores tienen dos o tres préstamos: es lo normal cuando el crédito se renueva
    // antes de terminar el anterior.
    const howMany = rnd() < 0.72 ? 1 : rnd() < 0.85 ? 2 : 3;

    for (let k = 0; k < howMany; k++) {
      const creditId = randomUUID();
      const caseId = randomUUID();
      const dpd = daysPastDue(code);
      const installments = pick([6, 12, 12, 18, 24] as const);
      const principal = int(8, 600) * 50;
      const installmentAmount = round2((principal * 1.18) / installments);
      const paid = int(0, Math.max(0, installments - 2));
      const outstanding = round2(Math.max(installmentAmount, installmentAmount * (installments - paid)));
      /** La cuota más vieja sin pagar vence hace `dpd` días: es lo que hace que la mora sea real. */
      const oldestDue = addDays(TODAY, -dpd);
      /*
       * 🔴 Sólo el 60 % lleva cronograma, y no es pereza: un crédito nacido en el móvil **no
       * tiene cuotas**, lleva la cuota congelada en `metadata` (C14). Sembrar los dos casos es lo
       * único que deja ver si una pantalla asume que la tabla siempre está.
       */
      const hasSchedule = rnd() < 0.6;

      creditRows.push({
        id: creditId,
        accountId: acc,
        clientId: client.id,
        code: `BLK-${String(++code).padStart(6, '0')}`,
        principalAmount: principal,
        outstandingBalance: outstanding,
        interestRate: round2(int(15, 42) / 10) / 100,
        currency: 'BOB',
        installmentsCount: installments,
        status: CreditStatus.ACTIVE,
        daysPastDue: dpd,
        disbursedAt: addDays(oldestDue, -30 * paid - 30),
        metadata: {
          frequency: 'MONTHLY',
          installmentAmount,
          nextDueDate: oldestDue.toISOString().slice(0, 10),
          origin: hasSchedule ? 'OFFICE' : 'MOBILE',
        },
      });

      if (hasSchedule) {
        for (let n = 1; n <= installments; n++) {
          // Las `paid` primeras están pagadas; la siguiente es la vencida de hace `dpd` días.
          const dueDate = addDays(oldestDue, (n - 1 - paid) * 30);
          const isPaid = n <= paid;
          const isOverdue = !isPaid && dueDate <= TODAY;
          installmentRows.push({
            accountId: acc,
            creditId,
            number: n,
            dueDate,
            amount: installmentAmount,
            principal: round2(principal / installments),
            interest: round2(installmentAmount - principal / installments),
            paidAmount: isPaid ? installmentAmount : 0,
            status: isPaid ? InstallmentStatus.PAID : isOverdue ? InstallmentStatus.OVERDUE : InstallmentStatus.PENDING,
            paidAt: isPaid ? addDays(dueDate, int(-3, 5)) : null,
          });
        }
      }

      caseRows.push({
        id: caseId,
        accountId: acc,
        creditId,
        clientId: client.id,
        assigneeId: collectorIds[ci % collectorIds.length]!,
        status: rnd() < 0.6 ? CaseStatus.ACTIVE : rnd() < 0.7 ? CaseStatus.IN_NEGOTIATION : CaseStatus.PROMISE_TO_PAY,
        priority: priorityOf(dpd),
        slaDueAt: addDays(TODAY, int(1, 10)),
        lastActionAt: addDays(TODAY, -int(0, 20)),
      });

      cases.push({ id: caseId, clientId: client.id, creditId, dpd });
    }
  }

  await write('créditos', creditRows, (c) => prisma.credit.createMany({ data: c }));
  await write('cuotas', installmentRows, (c) => prisma.creditInstallment.createMany({ data: c }));
  await write('casos', caseRows, (c) => prisma.collectionCase.createMany({ data: c }));

  // ── Agenda y rutas ─────────────────────────────────────────────────────────
  // Una ruta por cobrador y por día, de 8 paradas. Cada parada nace de un agendado de VISITA: la
  // ruta es la forma que toma la agenda del día cuando hay que salir a la calle.
  const days = workDays();
  const agendaRows: Prisma.AgendaItemCreateManyInput[] = [];
  const routeRows: Prisma.RoutePlanCreateManyInput[] = [];
  const stopRows: Prisma.RouteStopCreateManyInput[] = [];
  let cursor = 0;

  for (const day of days) {
    const past = day < TODAY;
    const isToday = day.getTime() === TODAY.getTime();

    for (const collectorId of collectorIds) {
      const routeId = randomUUID();
      const picked = Array.from({ length: STOPS_PER_ROUTE }, () => cases[cursor++ % cases.length]!);

      routeRows.push({
        id: routeId,
        accountId: acc,
        collectorId,
        plannedDate: day,
        status: past ? RouteStatus.COMPLETED : isToday ? RouteStatus.IN_PROGRESS : RouteStatus.PLANNED,
        totalCases: STOPS_PER_ROUTE,
        totalDistanceKm: round2(6 + rnd() * 14),
        estimatedMinutes: int(180, 320),
      });

      picked.forEach((kase, i) => {
        // Hoy la jornada está a medias: sin esto la ruta de hoy se ve en 0 % o en 100 %, y ninguna
        // de las dos es una jornada.
        const visited = past || (isToday && i < int(3, 6));
        stopRows.push({
          accountId: acc,
          routeId,
          clientId: kase.clientId,
          caseId: kase.id,
          sequenceOrder: i + 1,
          status: visited ? RouteStopStatus.VISITED : RouteStopStatus.PENDING,
          visitedAt: visited ? new Date(day.getTime() + (8 + i) * 3_600_000) : null,
        });

        agendaRows.push({
          accountId: acc,
          caseId: kase.id,
          clientId: kase.clientId,
          creditId: kase.creditId,
          assigneeId: collectorId,
          type: AgendaItemType.VISIT,
          status: visited ? AgendaItemStatus.EXECUTED : past ? AgendaItemStatus.CANCELLED : AgendaItemStatus.SCHEDULED,
          scheduledDate: day,
          timeMode: ScheduleTimeMode.FIXED,
          scheduledTime: `${String(8 + i).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`,
          priorityCode: kase.dpd > 180 ? 'CRITICAL' : kase.dpd > 60 ? 'HIGH' : 'MEDIUM',
          observations: rnd() < 0.4 ? pick(OBS_VISIT) : null,
          details: {},
          createdBy: collectorId,
        });
      });

      // Las llamadas no llevan parada: se hacen desde la oficina o entre visita y visita.
      for (let c = 0; c < Math.round(STOPS_PER_ROUTE * CALLS_PER_VISIT); c++) {
        const kase = cases[cursor++ % cases.length]!;
        agendaRows.push({
          accountId: acc,
          caseId: kase.id,
          clientId: kase.clientId,
          creditId: kase.creditId,
          assigneeId: collectorId,
          type: AgendaItemType.CALL,
          status: past
            ? rnd() < 0.75
              ? AgendaItemStatus.EXECUTED
              : AgendaItemStatus.RESCHEDULED
            : AgendaItemStatus.SCHEDULED,
          scheduledDate: day,
          timeMode: ScheduleTimeMode.LAPSE,
          timeSlot: pick(['MORNING', 'AFTERNOON']),
          priorityCode: kase.dpd > 180 ? 'CRITICAL' : 'MEDIUM',
          observations: rnd() < 0.5 ? pick(OBS_CALL) : null,
          details: {},
          createdBy: collectorId,
        });
      }
    }
  }

  await write('rutas', routeRows, (c) => prisma.routePlan.createMany({ data: c }));
  await write('paradas', stopRows, (c) => prisma.routeStop.createMany({ data: c }));
  await write('agendados', agendaRows, (c) => prisma.agendaItem.createMany({ data: c }));

  const visits = agendaRows.filter((a) => a.type === AgendaItemType.VISIT).length;
  console.log('');
  console.log(`  ✓ ${CLIENTS} deudores en Sucre · ${creditRows.length} créditos (mora de 1 a 450 días) · ${caseRows.length} casos`);
  console.log(`  ✓ ${agendaRows.length} agendados: ${visits} visitas (${Math.round((visits / agendaRows.length) * 100)} %) y ${agendaRows.length - visits} llamadas`);
  console.log(`  ✓ ${routeRows.length} rutas de ${STOPS_PER_ROUTE} paradas, ${collectorIds.length} cobradores, ${days.length} días hábiles`);
  console.log('  · los cobradores nuevos son cobrador1..cobrador10@kobrax.demo (pass: Kobrax123!)');
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Inserta por lotes y lo cuenta. Un `createMany` de 30.000 filas se come el límite de parámetros. */
async function write<T>(name: string, rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (const chunk of chunks(rows)) await insert(chunk);
  console.log(`  · ${String(rows.length).padStart(6)} ${name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
