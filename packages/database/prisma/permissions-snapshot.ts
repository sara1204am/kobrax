/**
 * Permisos efectivos por membresía: volcar, comparar y comprobar (F14 · F9, §G.3 del plan maestro).
 *
 *   # Antes de desplegar:
 *   pnpm --filter @kobrax/database db:permissions dump --out antes.json
 *   # …se despliega…
 *   pnpm --filter @kobrax/database db:permissions dump --out despues.json
 *   pnpm --filter @kobrax/database db:permissions diff antes.json despues.json [--allow-added a:b,c:d | --allow-any-added] [--allow-removed x:y] [--allow-membership-changes]
 *
 *   # Antes de desplegar en una base con el esquema VIEJO (sin copias por cuenta): `dump --legacy` usa solo las tablas viejas.
 *   # `diff … --by-role` resume el cambio por rol (todas las personas de un rol cambian igual).
 *
 *   # La prueba de que el cambio de fuente (rol global → copia por cuenta, F5) no cambió a nadie:
 *   pnpm --filter @kobrax/database db:permissions check
 *
 * «Permisos efectivos» = los que el token recibe: los de la copia del rol de la cuenta, o, si la cuenta no la tiene, los del rol global.
 * El volcado lleva solo identificadores y códigos de permiso (ningún dato personal). Usa `DATABASE_URL` (superusuario, sin RLS), como los demás scripts.
 * Sale con código 1 si hay diferencias no planificadas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  compareSources,
  diffSnapshots,
  hasUnplanned,
  summarizeByRole,
  unexpectedMismatches,
  unplanned,
  type MembershipPermissions,
  type PermissionsSnapshot,
  type SourceCompareRow,
} from './permissions-lib';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

async function load(): Promise<{ effective: MembershipPermissions[]; compare: SourceCompareRow[] }> {
  const [memberships, globalRows, accountRows] = await Promise.all([
    prisma.userAccount.findMany({
      where: { isActive: true },
      select: { accountId: true, userId: true, roleId: true, accountRoleId: true, role: { select: { name: true } }, accountRole: { select: { divergedAt: true } } },
      orderBy: [{ accountId: 'asc' }, { userId: 'asc' }],
    }),
    prisma.rolePermission.findMany({ select: { roleId: true, permission: { select: { code: true } } } }),
    prisma.accountRolePermission.findMany({ select: { accountRoleId: true, permission: { select: { code: true } } } }),
  ]);
  const global = new Map<string, string[]>();
  for (const r of globalRows) global.set(r.roleId, [...(global.get(r.roleId) ?? []), r.permission.code]);
  const account = new Map<string, string[]>();
  for (const r of accountRows) account.set(r.accountRoleId, [...(account.get(r.accountRoleId) ?? []), r.permission.code]);

  const effective: MembershipPermissions[] = [];
  const compare: SourceCompareRow[] = [];
  for (const m of memberships) {
    const g = (global.get(m.roleId) ?? []).sort();
    const a = m.accountRoleId ? ((account.get(m.accountRoleId) ?? []).sort() as string[]) : null;
    const hasCopy = a !== null;
    effective.push({ accountId: m.accountId, userId: m.userId, role: m.role.name, source: hasCopy ? 'account' : 'global', permissions: hasCopy ? a : g });
    compare.push({ accountId: m.accountId, userId: m.userId, role: m.role.name, accountPermissions: a, globalPermissions: g, diverged: m.accountRole?.divergedAt != null });
  }
  return { effective, compare };
}

/**
 * Los permisos de ANTES de F14 (rol global de cada membresía), con SQL crudo sobre las tablas viejas: sirve en una base cuyo esquema todavía no tiene
 * las copias por cuenta (no toca ningún modelo nuevo de Prisma).
 */
async function loadLegacy(): Promise<MembershipPermissions[]> {
  const rows = await prisma.$queryRaw<{ account_id: string; user_id: string; role: string; perms: string[] }[]>`
    SELECT ua.account_id, ua.user_id, r.name AS role,
           COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS perms
    FROM user_accounts ua
    JOIN roles r ON r.id = ua.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE ua.is_active
    GROUP BY ua.account_id, ua.user_id, r.name
    ORDER BY ua.account_id, ua.user_id`;
  return rows.map((r) => ({ accountId: r.account_id, userId: r.user_id, role: r.role, source: 'global' as const, permissions: r.perms }));
}

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'dump') {
    const effective = process.argv.includes('--legacy') ? await loadLegacy() : (await load()).effective;
    const snap: PermissionsSnapshot = { takenAt: new Date().toISOString(), memberships: effective };
    const out = arg('out');
    if (out) {
      writeFileSync(out, JSON.stringify(snap, null, 2));
      console.log(`✓ ${effective.length} membresías → ${out}`);
    } else {
      console.log(JSON.stringify(snap, null, 2));
    }
    return;
  }

  if (cmd === 'diff') {
    if (!a || !b) throw new Error('uso: diff <antes.json> <despues.json>');
    const diff = diffSnapshots(JSON.parse(readFileSync(a, 'utf8')) as PermissionsSnapshot, JSON.parse(readFileSync(b, 'utf8')) as PermissionsSnapshot);
    const bad = unplanned(diff, {
      allowAdded: list(arg('allow-added')),
      allowAnyAdded: process.argv.includes('--allow-any-added'),
      allowRemoved: list(arg('allow-removed')),
      allowMembershipChanges: process.argv.includes('--allow-membership-changes'),
    });
    console.log(`Cambios: ${diff.changed.length} membresías con permisos distintos · ${diff.gone.length} que ya no están · ${diff.appeared.length} nuevas`);
    if (process.argv.includes('--by-role')) {
      const groups = summarizeByRole(JSON.parse(readFileSync(a, 'utf8')) as PermissionsSnapshot, JSON.parse(readFileSync(b, 'utf8')) as PermissionsSnapshot);
      for (const g of groups) console.log(`  ${g.role} (${g.people} ${g.people === 1 ? 'persona' : 'personas'})  +[${g.added.join(', ')}]  −[${g.removed.join(', ')}]${g.removed.length ? '   ← REVISAR: se quita algo' : ''}`);
      if (groups.length === 0) console.log('  (ningún rol cambió)');
    }
    for (const c of bad.unplanned.slice(0, 50)) console.error(`  ✗ ${c.accountId}:${c.userId}  +[${c.added.join(', ')}]  −[${c.removed.join(', ')}]`);
    if (bad.unplanned.length > 50) console.error(`  … y ${bad.unplanned.length - 50} más`);
    for (const k of bad.membershipChanges.gone.slice(0, 20)) console.error(`  ✗ ya no existe la membresía ${k}`);
    for (const k of bad.membershipChanges.appeared.slice(0, 20)) console.error(`  ✗ membresía nueva ${k}`);
    if (hasUnplanned(bad)) {
      console.error('\n✗ hay diferencias NO planificadas');
      process.exitCode = 1;
    } else {
      console.log('✓ cero diferencias no planificadas');
    }
    return;
  }

  if (cmd === 'check') {
    const { compare } = await load();
    const mismatches = compareSources(compare);
    const bad = unexpectedMismatches(mismatches);
    console.log(`${compare.length} membresías activas · ${mismatches.length} con diferencia entre el rol global y la copia de su cuenta (${mismatches.length - bad.length} por copias divergidas, esperables)`);
    for (const m of bad.slice(0, 50)) {
      console.error(m.noCopy ? `  ✗ ${m.accountId}:${m.userId} (${m.role}) — la cuenta no tiene copia de su rol` : `  ✗ ${m.accountId}:${m.userId} (${m.role}) — solo la copia: [${m.onlyAccount.join(', ')}] · solo el global: [${m.onlyGlobal.join(', ')}]`);
    }
    if (bad.length > 0) {
      console.error('\n✗ la copia por cuenta NO dice lo mismo que el rol global para estas membresías');
      process.exitCode = 1;
    } else {
      console.log('✓ el cambio de fuente de permisos (rol global → copia por cuenta) no cambió a nadie');
    }
    return;
  }

  console.error('uso: db:permissions <dump [--out archivo] | diff <antes> <despues> [--allow-added …] | check>');
  process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
