/**
 * Un día de campo con datos de verdad, para poder MIRAR el panel.
 *
 * El seed principal arma una cadena histórica fija (junio) con una sola parada. Sirve para probar
 * el contrato, pero deja las pantallas de rutas del panel correctas y vacías: `/rutas` abre en
 * HOY, el mapa necesita varias paradas con punto, y la evidencia necesita un archivo que exista de
 * verdad en el disco. Esto agrega eso, para el día que se le pase.
 *
 *   pnpm --filter @kobrax/database db:seed:day            → hoy
 *   pnpm --filter @kobrax/database db:seed:day 2026-08-12 → un día concreto
 *
 * **Es aditivo e idempotente por día**: si ya hay una ruta de ese día para el cobrador demo, no
 * hace nada. No toca ni borra lo que creó el seed principal.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ClientType,
  CreditStatus,
  CaseStatus,
  CasePriority,
  EvidenceType,
  LocationType,
  PaymentMethod,
  PrismaClient,
  RouteStatus,
  RouteStopStatus,
  VisitOutcome,
} from '@prisma/client';

import { blindHash, encryptPII } from './pii';

const prisma = new PrismaClient();

/**
 * Cuatro deudores repartidos por Santa Cruz, **con punto**: sin coordenadas el mapa no dibuja nada,
 * que es exactamente lo que hace que la pantalla se vea vacía aunque esté bien.
 */
const PEOPLE = [
  { first: 'Rosa', last: 'Mamani Quispe', zone: 'Centro', lat: -17.7833, lng: -63.1821, debt: 4200, dpd: 92 },
  { first: 'Luis', last: 'Flores Rojas', zone: 'Norte', lat: -17.7621, lng: -63.1705, debt: 1850, dpd: 45 },
  { first: 'Carmen', last: 'Vargas Nina', zone: 'Equipetrol', lat: -17.7702, lng: -63.1955, debt: 9100, dpd: 12 },
  { first: 'Pedro', last: 'Choque Apaza', zone: 'Villa 1ro', lat: -17.7955, lng: -63.1602, debt: 620, dpd: 130 },
];

/** Un JPEG mínimo válido: alcanza para comprobar que la foto se sirve y se autentica. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

async function main(): Promise<void> {
  const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Fecha inválida: ${day} (se espera YYYY-MM-DD)`);
  const date = new Date(`${day}T00:00:00.000Z`);

  const account = await prisma.account.findFirst({ where: { code: 'DEMO' } });
  if (!account) throw new Error('No existe el tenant DEMO. Corré primero `pnpm db:seed`.');
  const acc = account.id;

  const collectorUser = await prisma.user.findUnique({ where: { email: 'collector@kobrax.demo' } });
  if (!collectorUser) throw new Error('No existe collector@kobrax.demo. Corré primero `pnpm db:seed`.');

  const already = await prisma.routePlan.findFirst({
    where: { accountId: acc, collectorId: collectorUser.id, plannedDate: date },
  });
  if (already) {
    console.log(`  ↷ ya hay una ruta del ${day} para el cobrador demo (${already.id.slice(0, 8)}). Nada que hacer.`);
    return;
  }

  const stops: { clientId: string; caseId: string; creditId: string }[] = [];

  for (const [i, p] of PEOPLE.entries()) {
    const client = await prisma.client.create({
      data: {
        accountId: acc,
        firstName: p.first,
        lastName: p.last,
        clientType: ClientType.PERSON,
        nationalId: encryptPII(`DIA-${day}-${i}`),
        nationalIdHash: blindHash(`DIA-${day}-${i}`),
        riskSegment: p.dpd > 90 ? 'HIGH' : 'MEDIUM',
        locations: {
          create: {
            accountId: acc,
            locationType: LocationType.HOME,
            address: encryptPII(`${p.zone} · calle ${100 + i * 7}`),
            zone: p.zone,
            latitude: p.lat,
            longitude: p.lng,
          },
        },
      },
    });

    const credit = await prisma.credit.create({
      data: {
        accountId: acc,
        clientId: client.id,
        code: `CRD-${day.replace(/-/g, '')}-${i + 1}`,
        principalAmount: p.debt * 2,
        outstandingBalance: p.debt,
        interestRate: 0.025,
        currency: 'BOB',
        installmentsCount: 12,
        status: CreditStatus.ACTIVE,
        daysPastDue: p.dpd,
      },
    });

    const kase = await prisma.collectionCase.create({
      data: {
        accountId: acc,
        creditId: credit.id,
        clientId: client.id,
        assigneeId: collectorUser.id,
        status: CaseStatus.ACTIVE,
        priority: p.dpd > 90 ? CasePriority.CRITICAL : p.dpd > 40 ? CasePriority.HIGH : CasePriority.MEDIUM,
        slaDueAt: new Date(date.getTime() + 3 * 86_400_000),
      },
    });

    stops.push({ clientId: client.id, caseId: kase.id, creditId: credit.id });
  }

  const route = await prisma.routePlan.create({
    data: {
      accountId: acc,
      collectorId: collectorUser.id,
      plannedDate: date,
      status: RouteStatus.IN_PROGRESS,
      totalCases: stops.length,
      totalDistanceKm: 12.4,
      estimatedMinutes: 200,
      stops: {
        create: stops.map((s, i) => ({
          accountId: acc,
          clientId: s.clientId,
          caseId: s.caseId,
          sequenceOrder: i + 1,
          // Las dos primeras se visitaron; las otras quedan pendientes. Así la jornada muestra
          // avance de verdad y no 0 % ni 100 %.
          status: i < 2 ? RouteStopStatus.VISITED : RouteStopStatus.PENDING,
          visitedAt: i < 2 ? new Date(`${day}T${13 + i}:20:00.000Z`) : null,
        })),
      },
    },
    include: { stops: { orderBy: { sequenceOrder: 'asc' } } },
  });

  // La foto tiene que EXISTIR en el disco: `uploads` la sirve desde `uploads/<accountId>/<sha>.jpg`
  // y valida el nombre contra un sha256. Sin el archivo, la evidencia se ve como una imagen rota.
  const hash = createHash('sha256').update(TINY_JPEG).digest('hex');
  const uploadsDir = resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), '../../apps/api/uploads'), acc);
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(join(uploadsDir, `${hash}.jpg`), TINY_JPEG);

  // Primera parada: cobró, con foto. Segunda: fue y no lo encontró, sin evidencia.
  await prisma.fieldVisit.create({
    data: {
      accountId: acc,
      caseId: stops[0]!.caseId,
      routeStopId: route.stops[0]!.id,
      collectorId: collectorUser.id,
      latitude: PEOPLE[0]!.lat + 0.0004,
      longitude: PEOPLE[0]!.lng - 0.0003,
      accuracy: 9.5,
      outcome: VisitOutcome.PAID,
      notes: 'Pagó en efectivo, entregó comprobante.',
      details: {},
      capturedAt: new Date(`${day}T13:20:00.000Z`),
      evidences: {
        create: {
          accountId: acc,
          type: EvidenceType.PHOTO,
          // La RUTA, no el nombre: es lo que devuelve `uploads` y lo que el panel usa tal cual.
          fileUrl: `/api/uploads/${hash}.jpg`,
          fileHash: hash,
          latitude: PEOPLE[0]!.lat + 0.0004,
          longitude: PEOPLE[0]!.lng - 0.0003,
          capturedAt: new Date(`${day}T13:21:00.000Z`),
        },
      },
    },
  });

  await prisma.fieldVisit.create({
    data: {
      accountId: acc,
      caseId: stops[1]!.caseId,
      routeStopId: route.stops[1]!.id,
      collectorId: collectorUser.id,
      latitude: PEOPLE[1]!.lat,
      longitude: PEOPLE[1]!.lng,
      outcome: VisitOutcome.NOT_FOUND,
      notes: 'Nadie en el domicilio, vecina dice que trabaja hasta las 18.',
      // El punto es el de la parada y no una lectura del GPS: el panel lo avisa.
      details: { gpsFallback: true },
      capturedAt: new Date(`${day}T14:20:00.000Z`),
    },
  });

  await prisma.payment.create({
    data: {
      accountId: acc,
      creditId: stops[0]!.creditId,
      caseId: stops[0]!.caseId,
      amount: 850,
      method: PaymentMethod.CASH,
      registeredBy: collectorUser.id,
      paymentDate: new Date(`${day}T13:25:00.000Z`),
    },
  });

  console.log(`  ✓ día ${day}: ruta ${route.id.slice(0, 8)} con 4 paradas georreferenciadas,`);
  console.log('    2 visitadas (una con foto y una con GPS estimado) y un pago de 850 BOB.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
