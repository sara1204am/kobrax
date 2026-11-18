import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EMAIL_VERIFY_COOLDOWN_MS, EmailVerificationService } from './email-verification.service';
import { RequireVerifiedEmailGuard } from './guards/require-verified-email.guard';
import { RequireVerifiedEmail } from './decorators/require-verified-email.decorator';

interface Row { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null; createdAt: Date }

function make(user: { id: string; email: string; emailVerifiedAt: Date | null } | null, opts: { failMail?: boolean; rows?: Row[] } = {}) {
  const rows: Row[] = opts.rows ?? [];
  const sent: { to: string; subject: string; text: string }[] = [];
  const verified: string[] = [];
  const tokenApi = {
    findFirst: async (a: { where: { tokenHash?: string; userId?: string; usedAt?: null; expiresAt?: { gt: Date } }; orderBy?: unknown }) => {
      const w = a.where;
      const hits = rows.filter((r) => (w.tokenHash ? r.tokenHash === w.tokenHash : true) && (w.userId ? r.userId === w.userId : true) && (w.usedAt === null ? r.usedAt === null : true) && (w.expiresAt ? r.expiresAt > w.expiresAt.gt : true));
      return hits.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0] ?? null;
    },
    updateMany: async (a: { where: { id?: string; userId?: string; usedAt: null }; data: { usedAt: Date } }) => {
      const hit = rows.filter((r) => r.usedAt === null && (a.where.id ? r.id === a.where.id : true) && (a.where.userId ? r.userId === a.where.userId : true));
      hit.forEach((r) => (r.usedAt = a.data.usedAt));
      return { count: hit.length };
    },
    create: async (a: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
      const row = { id: `t${rows.length}`, usedAt: null, createdAt: new Date(), ...a.data };
      rows.push(row);
      return row;
    },
  };
  const prisma = {
    user: {
      findUnique: async () => user,
      updateMany: async (a: { where: { id: string } }) => {
        verified.push(a.where.id);
        return { count: 1 };
      },
    },
    emailVerificationToken: tokenApi,
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const mail = {
    send: async (to: string, subject: string, text: string) => {
      if (opts.failMail) throw new Error('smtp caído');
      sent.push({ to, subject, text });
    },
  };
  const config = { appUrl: 'https://app.kobrax.test/' };
  return { svc: new EmailVerificationService(prisma as never, config as never, mail as never), rows, sent, verified };
}

const tokenOf = (text: string) => /verificar-correo\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;

describe('confirmación del correo', () => {
  it('manda un enlace de un solo uso (sin barra doble) y guarda SOLO su huella', async () => {
    const { svc, rows, sent } = make({ id: 'u1', email: 'a@b.com', emailVerifiedAt: null });
    assert.equal(await svc.send('u1'), true);
    const token = tokenOf(sent[0]!.text)!;
    assert.ok(token.length >= 40);
    assert.ok(sent[0]!.text.includes('https://app.kobrax.test/verificar-correo'));
    assert.equal(rows[0]!.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(rows).includes(token), 'el enlace en claro nunca se guarda');
  });

  it('no manda nada a quien ya confirmó', async () => {
    const { svc, sent } = make({ id: 'u1', email: 'a@b.com', emailVerifiedAt: new Date() });
    assert.equal(await svc.send('u1'), false);
    assert.equal(sent.length, 0);
  });

  it('🔴 si el correo falla, no lanza (la persona pide otro desde el aviso)', async () => {
    const { svc, rows } = make({ id: 'u1', email: 'a@b.com', emailVerifiedAt: null }, { failMail: true });
    assert.equal(await svc.send('u1'), true);
    assert.equal(rows.length, 1);
  });

  it('reenviar respeta el minuto de espera; uno nuevo anula el anterior', async () => {
    const { svc, rows, sent } = make({ id: 'u1', email: 'a@b.com', emailVerifiedAt: null });
    await svc.send('u1');
    assert.equal(await svc.send('u1', { respectCooldown: true }), false, 'muy seguido');
    rows[0]!.createdAt = new Date(Date.now() - EMAIL_VERIFY_COOLDOWN_MS - 1000);
    assert.equal(await svc.send('u1', { respectCooldown: true }), true);
    assert.equal(sent.length, 2);
    assert.ok(rows[0]!.usedAt, 'el enlace anterior quedó anulado');
  });

  it('confirmar marca el correo y el enlace sirve UNA sola vez', async () => {
    const { svc, sent, verified } = make({ id: 'u1', email: 'a@b.com', emailVerifiedAt: null });
    await svc.send('u1');
    const token = tokenOf(sent[0]!.text)!;
    await svc.confirm(token);
    assert.deepEqual(verified, ['u1']);
    await assert.rejects(svc.confirm(token), (e) => code(e) === 'EMAIL_VERIFY_INVALID');
  });

  it('🔴 un enlace desconocido o vencido responde igual de genérico', async () => {
    const { svc, rows, sent } = make({ id: 'u1', email: 'a@b.com', emailVerifiedAt: null });
    await assert.rejects(svc.confirm('x'.repeat(43)), (e) => code(e) === 'EMAIL_VERIFY_INVALID');
    await svc.send('u1');
    rows[0]!.expiresAt = new Date(Date.now() - 1000);
    await assert.rejects(svc.confirm(tokenOf(sent[0]!.text)!), (e) => code(e) === 'EMAIL_VERIFY_INVALID');
  });
});

describe('guard de acciones sensibles', () => {
  class Marked { @RequireVerifiedEmail() sensitive() {} plain() {} }
  const ctx = (handler: () => void, user: unknown) =>
    ({ getHandler: () => handler, getClass: () => Marked, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
  const guard = (verified: boolean) => new RequireVerifiedEmailGuard(new Reflector(), { isVerified: async () => verified } as never);

  it('🔴 sin confirmar: lo marcado como sensible da 403 EMAIL_UNVERIFIED', async () => {
    await assert.rejects(guard(false).canActivate(ctx(Marked.prototype.sensitive, { userId: 'u1' })), (e) => code(e) === 'EMAIL_UNVERIFIED');
  });

  it('confirmado: pasa. Lo no marcado pasa siempre (entrar y trabajar no se frena)', async () => {
    assert.equal(await guard(true).canActivate(ctx(Marked.prototype.sensitive, { userId: 'u1' })), true);
    assert.equal(await guard(false).canActivate(ctx(Marked.prototype.plain, { userId: 'u1' })), true);
  });

  it('la plataforma (sesión de soporte) no es una persona de empresa y pasa', async () => {
    assert.equal(await guard(false).canActivate(ctx(Marked.prototype.sensitive, { userId: 'p1', actorType: 'PLATFORM' })), true);
  });
});
