/**
 * F14 · F4 — PII por categoría y archivos con dueño, de punta a punta.
 *
 * Postgres y Redis reales (base `kobrax_it`), la API compilada. Se prueba con cada rol REAL (administrador, gerente, supervisor, cobrador,
 * auditor, VIEWER) lo que ve de un cliente, quién puede revelar el documento, y la política de lectura de archivos (por identificador, por
 * nombre —la ruta que usa el móvil— y por enlace firmado).
 *
 *   Banco › {Mesa Verde, Padilla}
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f4-pii-archivos.it.ts
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, call, db, freshDatabase, login, loginSkippingMfa, startApi, stopApi } from './harness';

interface Office {
  id: string;
  isRoot: boolean;
}
interface BranchType {
  id: string;
  code: string;
}
interface ClientView {
  nationalId?: string;
  firstName?: string;
  contacts?: { value: string }[];
  locations?: { address?: string; photoUrls?: string[] }[];
  collaterals?: unknown[];
  attachments?: unknown[];
  incomeProfile?: unknown;
}

const suffix = randomUUID().slice(0, 8);
const ORIGIN = API.replace(/\/api$/, '');
let prisma: PrismaClient;
let accountId = '';
let adminToken = '';
const off: Record<string, Office> = {};
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
let clientMV = '';
let clientPAD = '';
let creditMV = '';
let locationMV = '';
let paymentMV = '';

const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(48)]);

async function member(key: string, role: string, office: Office): Promise<void> {
  const email = `${key.toLowerCase()}-${suffix}@ejemplo.com`;
  uid[key] = await addMember(prisma, accountId, email, key, role);
  const r = await call(adminToken, 'POST', `/branches/${office.id}/members`, { userIds: [uid[key]] });
  assert.equal(r.status, 200, `${key}: ${JSON.stringify(r.error)}`);
  tok[key] = await login(email);
}

/** Sube una imagen como `who` por la ruta real de la app (multipart). Devuelve lo que la API respondió. */
async function upload(who: string): Promise<{ url: string; fileId: string; name: string }> {
  const form = new FormData();
  form.append('file', new Blob([png()], { type: 'image/png' }), 'x.png');
  const res = await fetch(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${tok[who]}` }, body: form });
  const body = (await res.json()) as { data?: { url: string; fileId: string } };
  assert.equal(res.status, 201, JSON.stringify(body));
  return { url: body.data!.url, fileId: body.data!.fileId, name: body.data!.url.split('/').pop()! };
}

const get = (token: string, path: string, base = API): Promise<Response> => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
const statusOfFile = async (token: string, id: string): Promise<number> => (await get(token, `/files/${id}`)).status;
const statusOfName = async (token: string, name: string): Promise<number> => (await get(token, `/uploads/${name}`)).status;

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', SCOPE_RLS_MODE: 'off' });
  prisma = db();

  const email = `banco-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: 'Banco F4', firstName: 'Dueño', lastName: 'F4', email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  accountId = owner.userAccounts[0]!.accountId;
  await prisma.account.update({ where: { id: accountId }, data: { planCode: 'PROFESSIONAL', limitsOverride: { branches: 30, users: 60, credits: 500, clients: 500 } } });
  adminToken = await loginSkippingMfa(email);
  tok.admin = adminToken;

  const types = (await call<BranchType[]>(adminToken, 'GET', '/branch-types')).data!;
  const agencia = types.find((t) => t.code === 'AGENCIA')!.id;
  const root = ((await call<Office[]>(adminToken, 'GET', '/branches')).data ?? []).find((o) => o.isRoot)!;
  off.ROOT = root;
  for (const [key, name, code] of [['MV', 'Mesa Verde', 'MV'], ['PAD', 'Padilla', 'PAD']] as const) {
    const r = await call<Office>(adminToken, 'POST', '/branches', { name, parentId: root.id, typeId: agencia, code });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    off[key] = r.data!;
  }

  await member('mgr', 'MANAGER', off.ROOT!);
  await member('aud', 'AUDITOR', off.ROOT!);
  await member('viewer', 'VIEWER', off.ROOT!);
  await member('supMV', 'SUPERVISOR', off.MV!);
  await member('colMV', 'COLLECTOR', off.MV!);
  await member('colPAD', 'COLLECTOR', off.PAD!);

  // Un cliente en cada oficina, con un crédito en mora a cargo de su cobrador, un contacto y una ubicación con GPS.
  const plant = async (label: string, office: Office, responsible: string, doc: string) => {
    const client = await prisma.client.create({
      data: { accountId, clientType: 'PERSON', firstName: label, lastName: 'Deudor', registeredBranchId: office.id, nationalId: doc, createdBy: uid[responsible] },
    });
    const credit = await prisma.credit.create({
      data: { accountId, clientId: client.id, branchId: office.id, code: `C-${label}-${suffix}`, principalAmount: 100, outstandingBalance: 100, currency: 'BOB', daysPastDue: 10, assignedManagerId: uid[responsible]! },
    });
    await prisma.clientContact.create({ data: { accountId, clientId: client.id, contactType: 'PHONE', value: `7${label.length}000000`, isPrimary: true } });
    const loc = await prisma.clientLocation.create({
      data: { accountId, clientId: client.id, locationType: 'HOME', address: `Calle ${label} 123`, zone: 'Norte', latitude: -19.04, longitude: -65.26, photoUrls: [] },
    });
    return { client, credit, loc };
  };
  const a = await plant('MV', off.MV!, 'colMV', '8821903');
  const b = await plant('PAD', off.PAD!, 'colPAD', '7712345');
  clientMV = a.client.id;
  creditMV = a.credit.id;
  locationMV = a.loc.id;
  clientPAD = b.client.id;
  await prisma.clientIncomeProfile.create({ data: { accountId, clientId: clientMV, incomeSourceCode: 'COMERCIO', origin: 'MANUAL' } as never }).catch(() => undefined);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F4 · PII del cliente por rol', () => {
  const detail = async (who: string, id = clientMV, reveal = false) => {
    const r = await call<ClientView>(tok[who]!, 'GET', `/clients/${id}${reveal ? '?reveal=true' : ''}`);
    return r;
  };

  it('🔴 VIEWER ve al cliente por su nombre pero sin contactos, ubicaciones, garantías ni adjuntos; y NO puede revelar (403)', async () => {
    const r = await detail('viewer');
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data!.firstName, 'MV');
    assert.equal(r.data!.contacts, undefined);
    assert.equal(r.data!.locations, undefined);
    assert.equal(r.data!.collaterals, undefined);
    assert.equal(r.data!.attachments, undefined);
    assert.match(String(r.data!.nationalId), /\*/);
    const rev = await detail('viewer', clientMV, true);
    assert.equal(rev.status, 403);
    assert.equal(rev.error?.code, 'PII_REVEAL_DENIED');
  });

  it('el supervisor ve el documento enmascarado por defecto y lo revela con la acción explícita; queda auditado con categorías', async () => {
    const masked = await detail('supMV');
    assert.equal(masked.status, 200);
    assert.match(String(masked.data!.nationalId), /\*/);
    assert.notEqual(masked.data!.contacts?.[0]?.value, '72000000');
    const rev = await detail('supMV', clientMV, true);
    assert.equal(rev.status, 200);
    assert.equal(rev.data!.nationalId, '8821903');
    assert.equal(rev.data!.locations?.[0]?.address, 'Calle MV 123');
    const row = await prisma.auditLog.findFirst({ where: { entity: 'client', entityId: clientMV, action: 'PII_REVEAL', userId: uid.supMV }, orderBy: { createdAt: 'desc' } });
    assert.ok(row, 'el revelado se audita');
    const after = row!.after as { categories?: string[]; channel?: string } | null;
    assert.ok(after?.categories?.includes('DOCUMENT') && after.categories.includes('CONTACT'), JSON.stringify(after));
    assert.equal(after?.channel, 'api');
    assert.ok(!JSON.stringify(row!.after).includes('8821903'), 'el rastro NO lleva el valor revelado');
  });

  it('cobrador (su cartera), gerente, auditor y administrador revelan el documento; el cobrador de otra oficina recibe 404', async () => {
    for (const who of ['colMV', 'mgr', 'aud', 'admin']) {
      const r = await detail(who, clientMV, true);
      assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.error)}`);
      assert.equal(r.data!.nationalId, '8821903', who);
    }
    assert.equal((await detail('colPAD', clientMV, true)).status, 404);
  });

  it('el listado de clientes enmascara el documento para todos (nadie lo recibe en claro en un listado)', async () => {
    for (const who of ['colMV', 'mgr', 'admin']) {
      const r = await call<ClientView[]>(tok[who]!, 'GET', '/clients?limit=50');
      assert.equal(r.status, 200, who);
      for (const c of r.data!) assert.ok(c.nationalId == null || /\*/.test(c.nationalId), `${who}: ${c.nationalId}`);
    }
  });
});

describe('F4 · pantallas de trabajo (D-3) y visitas', () => {
  interface Ctx {
    client: { nationalId?: string };
    contacts: { value: string }[];
  }
  it('🔴 D-3: en el contexto de Agenda el supervisor ve el teléfono en claro pero el documento enmascarado; el cobrador y el gerente lo ven completo', async () => {
    const sup = await call<Ctx>(tok.supMV!, 'GET', `/agenda/clients/${clientMV}/context`);
    assert.equal(sup.status, 200, JSON.stringify(sup.error));
    assert.match(String(sup.data!.client.nationalId), /\*/);
    assert.ok(sup.data!.contacts.some((c) => c.value === '72000000'), 'el teléfono sí: se necesita para cobrar');
    const col = await call<Ctx>(tok.colMV!, 'GET', `/agenda/clients/${clientMV}/context`);
    assert.equal(col.status, 200, JSON.stringify(col.error));
    assert.equal(col.data!.client.nationalId, '8821903');
  });

  it('🔴 Mora: el VIEWER no recibe direcciones ni GPS; el gerente sí', async () => {
    const viewer = await get(tok.viewer!, '/mora?limit=50');
    assert.equal(viewer.status, 200);
    const vText = await viewer.text();
    assert.ok(!vText.includes('Calle MV 123') && !vText.includes('-65.26'), 'el VIEWER no debe recibir dirección ni GPS');
    const mgr = await get(tok.mgr!, '/mora?limit=50');
    assert.equal(mgr.status, 200);
    assert.ok((await mgr.text()).includes('-65.26'), 'el gerente sí recibe el punto');
  });

  it('🔴 Visitas de campo y mapa de visitas: el VIEWER recibe 403 (llevan el punto GPS del deudor)', async () => {
    assert.equal((await get(tok.viewer!, '/visits')).status, 403);
    assert.equal((await get(tok.viewer!, '/analytics/visit-map')).status, 403);
    assert.notEqual((await get(tok.mgr!, '/visits')).status, 403);
  });

  it('exportes: el VIEWER no exporta (no tiene report:export); el gerente exporta ubicaciones y queda auditado con categorías', async () => {
    assert.equal((await get(tok.viewer!, '/exports/locations')).status, 403);
    const ok = await get(tok.mgr!, '/exports/locations');
    assert.equal(ok.status, 200);
    const row = await prisma.auditLog.findFirst({ where: { entity: 'export:locations', userId: uid.mgr }, orderBy: { createdAt: 'desc' } });
    assert.ok((row?.after as { categories?: string[] } | null)?.categories?.includes('CONTACT'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F4 · archivos: dueño, política de lectura, ruta legada y enlaces firmados', () => {
  let up: { url: string; fileId: string; name: string };

  it('una subida queda registrada como PENDING y sólo quien la subió la abre (por id y por nombre)', async () => {
    up = await upload('colMV');
    const row = await prisma.file.findUniqueOrThrow({ where: { id: up.fileId } });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.uploadedBy, uid.colMV);
    assert.equal(await statusOfFile(tok.colMV!, up.fileId), 200);
    assert.equal(await statusOfName(tok.colMV!, up.name), 200);
    assert.equal(await statusOfFile(tok.colPAD!, up.fileId), 404, 'otra persona: 404');
    assert.equal(await statusOfName(tok.colPAD!, up.name), 404);
  });

  it('🔴 al atarlo a la foto de una ubicación, el trigger lo pasa a ATTACHED con su dueño; lo lee quien ve al cliente y nadie más', async () => {
    await prisma.clientLocation.update({ where: { id: locationMV }, data: { photoUrls: [up.url] } });
    const row = await prisma.file.findUniqueOrThrow({ where: { id: up.fileId }, include: { owners: true } });
    assert.equal(row.status, 'ATTACHED');
    assert.deepEqual(row.owners.map((o) => [o.ownerEntity, o.ownerId]), [['CLIENT_LOCATION', locationMV]]);
    const matrix: [string, number][] = [['colMV', 200], ['supMV', 200], ['mgr', 200], ['aud', 200], ['admin', 200], ['colPAD', 404], ['viewer', 404]];
    for (const [who, expected] of matrix) {
      assert.equal(await statusOfFile(tok[who]!, up.fileId), expected, `por id · ${who}`);
      assert.equal(await statusOfName(tok[who]!, up.name), expected, `por nombre (ruta del móvil) · ${who}`);
    }
  });

  it('un enlace firmado abre el archivo SIN sesión; firma alterada o archivo ajeno no', async () => {
    const link = await call<{ url: string; expiresAt: string }>(tok.colMV!, 'POST', `/files/${up.fileId}/link`);
    assert.equal(link.status, 201, JSON.stringify(link.error));
    const ok = await fetch(`${ORIGIN}${link.data!.url}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') ?? '', /image\/png/);
    assert.equal((await fetch(`${ORIGIN}${link.data!.url.replace(/sig=[^&]+/, 'sig=AAAA')}`)).status, 404, 'firma alterada');
    assert.equal((await fetch(`${ORIGIN}${link.data!.url.replace(up.fileId, randomUUID())}`)).status, 404, 'otro archivo');
    // quien no puede leer el archivo tampoco obtiene un enlace
    assert.equal((await call(tok.colPAD!, 'POST', `/files/${up.fileId}/link`)).status, 404);
    assert.equal((await call(tok.viewer!, 'POST', `/files/${up.fileId}/link`)).status, 404);
  });

  it('el comprobante de un pago lo lee quien ve el crédito (el VIEWER, que ve toda la cuenta, también) y no el cobrador de otra oficina', async () => {
    const rec = await upload('colMV');
    const pay = await prisma.payment.create({ data: { accountId, creditId: creditMV, branchId: off.MV!.id, amount: 10, method: 'CASH', registeredBy: uid.colMV!, receiptUrl: rec.url } });
    paymentMV = pay.id;
    assert.equal((await prisma.file.findUniqueOrThrow({ where: { id: rec.fileId }, include: { owners: true } })).owners[0]?.ownerEntity, 'PAYMENT_RECEIPT');
    assert.equal(await statusOfFile(tok.colMV!, rec.fileId), 200);
    assert.equal(await statusOfFile(tok.viewer!, rec.fileId), 200);
    assert.equal(await statusOfFile(tok.colPAD!, rec.fileId), 404);
  });

  it('🔴 un adjunto del cliente (documento) se audita al leerlo (FILE_READ), con el dueño y sin datos del archivo', async () => {
    const doc = await upload('colMV');
    await prisma.clientAttachment.create({ data: { accountId, clientId: clientMV, fileType: 'ID_CARD', fileUrl: doc.url } });
    assert.equal(await statusOfFile(tok.colMV!, doc.fileId), 200);
    const row = await prisma.auditLog.findFirst({ where: { entity: 'file', entityId: doc.fileId, action: 'FILE_READ', userId: uid.colMV }, orderBy: { createdAt: 'desc' } });
    assert.ok(row, 'la lectura del adjunto queda auditada');
    assert.deepEqual((row!.after as { owners?: string[] }).owners, ['CLIENT_ATTACHMENT']);
    assert.equal(await statusOfFile(tok.viewer!, doc.fileId), 404, 'VIEWER: sin contacto no hay adjuntos');
  });

  it('al quitar la foto de la ubicación el archivo queda sin dueños (ORPHAN) y deja de verlo quien lo veía por el cliente', async () => {
    await prisma.clientLocation.update({ where: { id: locationMV }, data: { photoUrls: [] } });
    const row = await prisma.file.findUniqueOrThrow({ where: { id: up.fileId }, include: { owners: true } });
    assert.equal(row.status, 'ORPHAN');
    assert.equal(row.owners.length, 0);
    assert.notEqual(row.orphanedAt, null);
    assert.equal(await statusOfFile(tok.supMV!, up.fileId), 404);
    assert.equal(await statusOfFile(tok.colMV!, up.fileId), 200, 'quien lo subió todavía lo abre');
  });

  it('el relleno y los triggers dejan toda referencia con su dueño (lo que comprueba verify_files.sql)', async () => {
    const missing = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) n FROM client_locations l, jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.photo_urls) = 'array' THEN l.photo_urls ELSE '[]'::jsonb END) u
      WHERE substring(u from '[0-9a-f]{64}\\.[a-z]{3,4}$') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM files f JOIN file_owners o ON o.file_id = f.id
        WHERE f.account_id = l.account_id AND f.storage_key = substring(u from '[0-9a-f]{64}\\.[a-z]{3,4}$') AND o.owner_entity = 'CLIENT_LOCATION' AND o.owner_id = l.id)`;
    assert.equal(Number(missing[0]!.n), 0);
    assert.ok(paymentMV && clientPAD);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('F4 · regresión del perfil gratuito individual (plan §8)', () => {
  it('quien trabaja solo (administrador de su cuenta) crea, revela, adjunta, abre, exporta y imprime exactamente como antes', async () => {
    const email = `solo-${suffix}@ejemplo.com`;
    const reg = await fetch(`${API}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: 'Cobranzas Don Pedro', firstName: 'Pedro', lastName: 'Solo', email, password: 'Kobrax123!' }),
    });
    assert.equal(reg.status, 201, await reg.text());
    const solo = await loginSkippingMfa(email);

    // Cliente con documento, teléfono y dirección con foto (la foto subida por la ruta real y atada por la API).
    const c = await call<{ id: string }>(solo, 'POST', '/clients', { clientType: 'PERSON', firstName: 'Marta', lastName: 'Cliente', nationalId: '5551234' });
    assert.equal(c.status, 201, JSON.stringify(c.error));
    const id = c.data!.id;
    const phone = await call(solo, 'POST', `/clients/${id}/contacts`, { contactType: 'PHONE', value: '70011223', isPrimary: true });
    assert.equal(phone.status, 201, JSON.stringify(phone.error));
    const form = new FormData();
    form.append('file', new Blob([png()], { type: 'image/png' }), 'casa.png');
    const up = (await (await fetch(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${solo}` }, body: form })).json()) as { data: { url: string; fileId: string } };
    const loc = await call(solo, 'POST', `/clients/${id}/locations`, { locationType: 'HOME', address: 'Av. Siempre Viva 742', latitude: -19.05, longitude: -65.25, photoUrls: [up.data.url] });
    assert.equal(loc.status, 201, JSON.stringify(loc.error));

    // Lo ve completo tras revelar (sin 403: el administrador tiene todos los permisos).
    const rev = await call<ClientView>(solo, 'GET', `/clients/${id}?reveal=true`);
    assert.equal(rev.status, 200, JSON.stringify(rev.error));
    assert.equal(rev.data!.nationalId, '5551234');
    assert.equal(rev.data!.contacts?.[0]?.value, '70011223');
    assert.equal(rev.data!.locations?.[0]?.address, 'Av. Siempre Viva 742');

    // La foto quedó atada (trigger) y se abre por id y por nombre (la ruta que ya usaba).
    assert.equal((await get(solo, `/files/${up.data.fileId}`)).status, 200);
    assert.equal((await get(solo, `/uploads/${up.data.url.split('/').pop()}`)).status, 200);
    assert.equal((await prisma.file.findUniqueOrThrow({ where: { id: up.data.fileId } })).status, 'ATTACHED');

    // Exporta clientes (con documento en claro, como siempre) y genera el PDF del legajo.
    const csv = await get(solo, '/exports/clients');
    assert.equal(csv.status, 200);
    assert.ok((await csv.text()).includes('5551234'), 'su exporte lleva el documento en claro');
    assert.equal((await get(solo, `/clients/${id}/pdf`)).status, 200);

    // Su foto de perfil (la sube y la ata) se abre.
    const form2 = new FormData();
    form2.append('file', new Blob([png()], { type: 'image/png' }), 'yo.png');
    const me = (await (await fetch(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${solo}` }, body: form2 })).json()) as { data: { url: string; fileId: string } };
    const me2 = await call(solo, 'PATCH', '/users/me/profile', { photoUrl: me.data.url });
    assert.equal(me2.status, 200, JSON.stringify(me2.error));
    assert.equal((await prisma.file.findUniqueOrThrow({ where: { id: me.data.fileId }, include: { owners: true } })).owners[0]?.ownerEntity, 'PROFILE_PHOTO');
    assert.equal((await get(solo, `/files/${me.data.fileId}`)).status, 200);
  });
});

describe('F4 · correcciones del code-review', () => {
  it('🔴 volver a referenciar un archivo que la limpieza había marcado como borrado lo revive (deleted_at vuelve a nulo) y el dueño apunta a un archivo vivo', async () => {
    const f = await upload('colMV');
    await prisma.clientLocation.update({ where: { id: locationMV }, data: { photoUrls: [f.url] } });
    await prisma.clientLocation.update({ where: { id: locationMV }, data: { photoUrls: [] } });
    await prisma.file.update({ where: { id: f.fileId }, data: { deletedAt: new Date() } }); // lo que hace la limpieza a los 7 días
    await prisma.clientLocation.update({ where: { id: locationMV }, data: { photoUrls: [f.url] } });
    const row = await prisma.file.findUniqueOrThrow({ where: { id: f.fileId }, include: { owners: true } });
    assert.equal(row.deletedAt, null);
    assert.equal(row.status, 'ATTACHED');
    assert.equal(row.owners.length, 1);
    await prisma.clientLocation.update({ where: { id: locationMV }, data: { photoUrls: [] } });
  });

  it('🔴 el PDF del legajo del SUPERVISOR no revela el documento por defecto (D-3); el del gerente sí', async () => {
    const reveal = async (who: string) => {
      const before = new Date();
      assert.equal((await get(tok[who]!, `/clients/${clientMV}/pdf`)).status, 200, who);
      const row = await prisma.auditLog.findFirst({ where: { entity: 'client', entityId: clientMV, action: 'PII_REVEAL', userId: uid[who], createdAt: { gte: before } }, orderBy: { createdAt: 'desc' } });
      return (row?.after as { categories?: string[] } | null)?.categories ?? [];
    };
    const sup = await reveal('supMV');
    assert.ok(sup.includes('CONTACT') && !sup.includes('DOCUMENT'), `supervisor: ${JSON.stringify(sup)}`);
    const mgr = await reveal('mgr');
    assert.ok(mgr.includes('DOCUMENT') && mgr.includes('CONTACT'), `gerente: ${JSON.stringify(mgr)}`);
  });
});
