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
 *   · ~1570 créditos (algunos tienen 2 o 3). **Un tercio en mora, de 1 a 450 días; el resto al día**
 *   · un caso por crédito, en los seis estados, con prioridad según la mora
 *   · ~2600 pagos de los últimos 90 días que **bajan el saldo de verdad**
 *   · ~5500 agendados repartidos 80/20 entre visitas y llamadas, sobre 50 días hábiles
 *   · una ruta por cobrador y por día, de EXACTAMENTE 8 paradas
 *
 * **Es aditivo e idempotente**: si ya hay créditos `BLK-`, no hace nada. Con `--reset` borra lo
 * suyo y vuelve a sembrar. No toca lo que sembraron los otros dos.
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
  PaymentMethod,
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
/**
 * Qué parte de la cartera está en mora. El resto está al día.
 *
 * 🔴 No es un número decorativo: **con el 100 % en mora, el KPI «% cartera en mora» daba 99,9 %** y
 * no medía nada. Una cartera real tiene una parte sana, y el tablero existe para ver cuánta no lo
 * está.
 */
const OVERDUE_SHARE = 0.32;
/** Los medios de pago que se ven en campo, con su frecuencia real: el efectivo manda. */
const PAYMENT_MIX = [
  PaymentMethod.CASH,
  PaymentMethod.CASH,
  PaymentMethod.CASH,
  PaymentMethod.CASH,
  PaymentMethod.CASH,
  PaymentMethod.TRANSFER,
  PaymentMethod.TRANSFER,
  PaymentMethod.QR,
  PaymentMethod.QR,
  PaymentMethod.CARD,
] as const;

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

  if (process.argv.includes('--reset')) await reset(acc);

  const already = await prisma.credit.findFirst({ where: { accountId: acc, code: { startsWith: 'BLK-' } } });
  if (already) {
    console.log('  ↷ la cartera grande ya está sembrada (créditos BLK-). Nada que hacer.');
    console.log('    Para volver a sembrarla: `db:seed:bulk --reset` (borra SÓLO lo que sembró este archivo).');
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

  // ── Créditos, cronogramas, casos y pagos ───────────────────────────────────
  const creditRows: Prisma.CreditCreateManyInput[] = [];
  const installmentRows: Prisma.CreditInstallmentCreateManyInput[] = [];
  const caseRows: Prisma.CollectionCaseCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  /** Los casos EN GESTIÓN, que son los que se agendan y se visitan. Un caso pagado no se visita. */
  const cases: { id: string; clientId: string; creditId: string; dpd: number }[] = [];
  let code = 0;
  // El número de comprobante es único por cuenta: se sigue desde el último que exista.
  let receipt = ((await prisma.payment.aggregate({ _max: { receiptNumber: true } }))._max.receiptNumber ?? 0) + 1;

  for (const [ci, client] of clients.entries()) {
    // Algunos deudores tienen dos o tres préstamos: es lo normal cuando el crédito se renueva
    // antes de terminar el anterior.
    const howMany = rnd() < 0.72 ? 1 : rnd() < 0.85 ? 2 : 3;

    for (let k = 0; k < howMany; k++) {
      const creditId = randomUUID();
      const caseId = randomUUID();
      const collectorId = collectorIds[ci % collectorIds.length]!;
      /*
       * 🔴 **La mayoría de la cartera está AL DÍA**, y eso no es un detalle cosmético: con todos
       * los créditos en mora el «% cartera en mora» daba 99,9 % y el KPI no medía nada. Una cartera
       * real tiene una parte sana; el tablero existe justamente para ver qué proporción no lo está.
       * Los que sí están en mora cubren el rango entero, de 1 a 450 días.
       */
      const overdue = rnd() < OVERDUE_SHARE;
      const dpd = overdue ? daysPastDue(code) : 0;
      const installments = pick([6, 12, 12, 18, 24] as const);
      const principal = int(8, 600) * 50;
      const installmentAmount = round2((principal * 1.18) / installments);
      const paidCount = int(0, Math.max(0, installments - 2));
      /** La cuota más vieja sin pagar: vencida hace `dpd` días, o por vencer si está al día. */
      const nextDue = overdue ? addDays(TODAY, -dpd) : addDays(TODAY, int(1, 30));
      /*
       * 🔴 Sólo el 60 % lleva cronograma, y no es pereza: un crédito nacido en el móvil **no
       * tiene cuotas**, lleva la cuota congelada en `metadata` (C14). Sembrar los dos casos es lo
       * único que deja ver si una pantalla asume que la tabla siempre está.
       */
      const hasSchedule = rnd() < 0.6;

      /*
       * Los pagos de este crédito, repartidos en los últimos 90 días. **Bajan el saldo de verdad**:
       * un pago que no descuenta es un ledger que miente, y era justo el número que el dashboard
       * iba a mostrar como «recaudado».
       */
      const base = round2(Math.max(installmentAmount, installmentAmount * (installments - paidCount)));
      let outstanding = base;
      const howManyPayments = overdue ? int(0, 2) : int(0, 4);
      for (let p = 0; p < howManyPayments && outstanding > installmentAmount * 0.5; p++) {
        // Alguno paga la cuota entera y otro paga lo que puede: los dos casos existen en campo.
        const amount = round2(rnd() < 0.7 ? installmentAmount : installmentAmount * (0.2 + rnd() * 0.6));
        if (amount <= 0) continue;
        outstanding = round2(outstanding - amount);
        paymentRows.push({
          accountId: acc,
          creditId,
          caseId,
          amount,
          method: pick(PAYMENT_MIX),
          registeredBy: collectorId,
          receiptNumber: receipt++,
          paymentDate: addDays(TODAY, -int(0, 89)),
        });
      }
      const creditPaid = outstanding <= 0.5;

      creditRows.push({
        id: creditId,
        accountId: acc,
        clientId: client.id,
        code: `BLK-${String(++code).padStart(6, '0')}`,
        principalAmount: principal,
        outstandingBalance: Math.max(0, outstanding),
        interestRate: round2(int(15, 42) / 10) / 100,
        currency: 'BOB',
        installmentsCount: installments,
        status: creditPaid ? CreditStatus.PAID : CreditStatus.ACTIVE,
        daysPastDue: dpd,
        disbursedAt: addDays(nextDue, -30 * paidCount - 30),
        metadata: {
          frequency: 'MONTHLY',
          installmentAmount,
          nextDueDate: nextDue.toISOString().slice(0, 10),
          origin: hasSchedule ? 'OFFICE' : 'MOBILE',
        },
      });

      if (hasSchedule) {
        for (let n = 1; n <= installments; n++) {
          // Las `paidCount` primeras están pagadas; la siguiente es `nextDue`.
          const dueDate = addDays(nextDue, (n - 1 - paidCount) * 30);
          const isPaid = n <= paidCount;
          const isOverdue = !isPaid && dueDate < TODAY;
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

      /*
       * El estado del caso sale de la realidad del crédito, no de un sorteo suelto: el que terminó
       * de pagar queda PAID o CLOSED, el que está al día casi no se trabaja, y el que debe está en
       * alguno de los tres estados de gestión.
       *
       * 🔴 Los cerrados llevan `closed_at` **repartido en los últimos 60 días**, y es lo que hace
       * que «casos activos vs período anterior» compare contra algo: sin fecha de cierre, la
       * reconstrucción de cuántos casos había abiertos hace una semana da siempre lo mismo.
       */
      const status = creditPaid
        ? rnd() < 0.5
          ? CaseStatus.PAID
          : CaseStatus.CLOSED
        : !overdue
          ? rnd() < 0.5
            ? CaseStatus.PENDING
            : CaseStatus.ACTIVE
          : rnd() < 0.55
            ? CaseStatus.ACTIVE
            : rnd() < 0.75
              ? CaseStatus.IN_NEGOTIATION
              : CaseStatus.PROMISE_TO_PAY;
      const closed = status === CaseStatus.PAID || status === CaseStatus.CLOSED;
      /*
       * 🔴 **Cuándo se abrió el caso.** Sin esto `created_at` cae en `now()` para los 1600 casos, y
       * entonces «cuántos casos había abiertos hace una semana» da 0 → `deltaOf` devuelve `null` y
       * el KPI muestra «sin período anterior para comparar». No era el KPI: era el seed.
       * El 6 % de la última semana es lo que hace que la flecha marque un crecimiento creíble en vez
       * de un 0 % plano.
       */
      const openedAt = addDays(TODAY, -(rnd() < 0.06 ? int(0, 6) : int(7, 180)));
      /** El cierre va DESPUÉS de la apertura y nunca en el futuro: un caso cerrado antes de existir
       *  rompe la misma reconstrucción que `created_at` viene a arreglar. */
      const closedAt = new Date(Math.min(TODAY.getTime(), addDays(openedAt, int(3, 60)).getTime()));

      caseRows.push({
        id: caseId,
        accountId: acc,
        creditId,
        clientId: client.id,
        assigneeId: collectorId,
        status,
        priority: priorityOf(dpd),
        createdAt: openedAt,
        slaDueAt: addDays(TODAY, int(1, 10)),
        // Nunca antes de que el caso existiera.
        lastActionAt: new Date(Math.max(openedAt.getTime(), addDays(TODAY, -int(0, 20)).getTime())),
        ...(closed ? { closedAt, closedBy: collectorId, closedReason: 'Crédito cancelado' } : {}),
      });

      // Sólo los que siguen en gestión entran a la agenda y a las rutas: mandar a un cobrador a
      // visitar a alguien que ya pagó es exactamente lo que un tablero tiene que evitar.
      if (!closed) cases.push({ id: caseId, clientId: client.id, creditId, dpd });
    }
  }

  await write('créditos', creditRows, (c) => prisma.credit.createMany({ data: c }));
  await write('cuotas', installmentRows, (c) => prisma.creditInstallment.createMany({ data: c }));
  await write('casos', caseRows, (c) => prisma.collectionCase.createMany({ data: c }));
  await write('pagos', paymentRows, (c) => prisma.payment.createMany({ data: c }));

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
  const saldo = creditRows.reduce((s, c) => s + Number(c.outstandingBalance), 0);
  const mora = creditRows.filter((c) => Number(c.daysPastDue) > 0).reduce((s, c) => s + Number(c.outstandingBalance), 0);
  const cobrado = paymentRows.reduce((s, p) => s + Number(p.amount), 0);

  console.log('');
  console.log(`  ✓ ${CLIENTS} deudores en Sucre · ${creditRows.length} créditos (mora de 1 a 450 días) · ${caseRows.length} casos`);
  console.log(`  ✓ saldo ${saldo.toLocaleString('es-BO', { maximumFractionDigits: 0 })} · en mora ${Math.round((mora / saldo) * 1000) / 10} % · ${paymentRows.length} pagos por ${cobrado.toLocaleString('es-BO', { maximumFractionDigits: 0 })}`);
  console.log(`  ✓ ${agendaRows.length} agendados: ${visits} visitas (${Math.round((visits / agendaRows.length) * 100)} %) y ${agendaRows.length - visits} llamadas`);
  console.log(`  ✓ ${routeRows.length} rutas de ${STOPS_PER_ROUTE} paradas, ${collectorIds.length} cobradores, ${days.length} días hábiles`);
  console.log('  · los cobradores nuevos son cobrador1..cobrador10@kobrax.demo (pass: Kobrax123!)');
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Borra **sólo lo que sembró este archivo**, para poder volver a sembrarlo con otros parámetros.
 *
 * 🔴 El ancla es `credits.code LIKE 'BLK-%'`: de ahí salen los créditos, y de los créditos los
 * clientes, los casos, los pagos y las paradas. Lo que sembraron `seed` y `seed-day` **no se toca**
 * —tienen otros códigos— y los cobradores creados quedan, que no molestan a nadie.
 *
 * El orden importa: primero lo que apunta y al final lo apuntado, o las claves foráneas lo frenan.
 */
async function reset(acc: string): Promise<void> {
  const credits = await prisma.credit.findMany({ where: { accountId: acc, code: { startsWith: 'BLK-' } }, select: { id: true, clientId: true } });
  if (credits.length === 0) return;
  const creditIds = credits.map((c) => c.id);
  const clientIds = [...new Set(credits.map((c) => c.clientId))];
  const cases = await prisma.collectionCase.findMany({ where: { creditId: { in: creditIds } }, select: { id: true } });
  const caseIds = cases.map((c) => c.id);

  await prisma.agendaItem.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.fieldVisit.deleteMany({ where: { caseId: { in: caseIds } } });

  /*
   * 🔴 Las rutas se anotan **antes** de borrar sus paradas. Borrando primero y buscando después las
   * que quedaron vacías, se llevaba puesta cualquier ruta sin paradas del tenant —una de `seed-day`,
   * una de una prueba, una hecha a mano—. «Las vacías eran mías porque nacieron con ocho» es una
   * suposición que la consulta no verificaba.
   */
  const routeIds = [
    ...new Set(
      (await prisma.routeStop.findMany({ where: { caseId: { in: caseIds } }, select: { routeId: true } })).map(
        (s) => s.routeId,
      ),
    ),
  ];
  await prisma.routeStop.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.routePlan.deleteMany({ where: { id: { in: routeIds }, stops: { none: {} } } });
  await prisma.payment.deleteMany({ where: { creditId: { in: creditIds } } });
  await prisma.collectionCase.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.creditInstallment.deleteMany({ where: { creditId: { in: creditIds } } });
  await prisma.credit.deleteMany({ where: { id: { in: creditIds } } });
  await prisma.clientContact.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.clientLocation.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });

  console.log(`  ⌫ borrados ${clientIds.length} deudores y ${creditIds.length} créditos de la corrida anterior`);
}

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
