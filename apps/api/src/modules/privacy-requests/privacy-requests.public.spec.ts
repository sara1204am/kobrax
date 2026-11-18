import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrivacyRequestStatus, PrivacyRequestType, PrivacySubjectKind } from '@kobrax/shared';
import { ConfirmPublicReportDto, CreatePublicReportDto, PUBLIC_REPORT_TYPES } from './dto/public-report.dto';
import { PrivacyRequestsService } from './privacy-requests.service';
import { MAX_OPEN_PER_CONTACT, needsContactVerification } from './privacy-requests.logic';

const NOTIFY = 'kobraxikigai@gmail.com';
const ok = { type: PrivacyRequestType.ABUSE_REPORT, contactEmail: 'Persona@Ejemplo.com', description: 'Me llaman a toda hora y a mi trabajo.' };
const erase = { ...ok, type: PrivacyRequestType.ACCOUNT_DELETION };
const dto = (o: object) => plainToInstance(CreatePublicReportDto, o);

describe('reportes públicos · DTO', () => {
  it('acepta un reporte válido', async () => {
    assert.equal((await validate(dto(ok))).length, 0);
  });

  it('🔴 la lista de tipos es cerrada: no se puede pedir un tipo que no sea de formulario público', async () => {
    assert.equal(PUBLIC_REPORT_TYPES.includes(PrivacyRequestType.WITHDRAW_CONSENT as never), false);
    assert.ok((await validate(dto({ ...ok, type: PrivacyRequestType.PORTABILITY }))).some((e) => e.property === 'type'));
  });

  it('exige un correo válido y una descripción de al menos 10 caracteres', async () => {
    const errors = await validate(dto({ ...ok, contactEmail: 'no-es-correo', description: 'corto' }));
    assert.deepEqual(errors.map((e) => e.property).sort(), ['contactEmail', 'description']);
  });

  it('el token de confirmación tiene una forma acotada', async () => {
    assert.equal((await validate(plainToInstance(ConfirmPublicReportDto, { token: 'x'.repeat(43) }))).length, 0);
    assert.equal((await validate(plainToInstance(ConfirmPublicReportDto, { token: 'corto' }))).length, 1);
  });
});

describe('reportes públicos · cuáles piden confirmar el correo', () => {
  it('🔴 lo que actúa sobre datos o cuenta sí; denunciar un abuso o consultar, no', () => {
    for (const t of ['ACCOUNT_DELETION', 'ERASURE', 'ACCESS', 'RECTIFICATION', 'OBJECTION']) assert.equal(needsContactVerification(t), true, t);
    for (const t of ['ABUSE_REPORT', 'OTHER']) assert.equal(needsContactVerification(t), false, t);
  });
});

function make(opts: { open?: number; found?: Record<string, unknown> | null; failMail?: boolean } = {}) {
  const created: { data: Record<string, unknown> }[] = [];
  const sent: { to: string; subject: string; text: string }[] = [];
  const events: unknown[] = [];
  const surfaces: string[] = [];
  const tx = {
    privacyRequest: {
      count: async () => opts.open ?? 0,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return { id: 'abcdef12-0000-0000-0000-000000000000' };
      },
      findFirst: async () => opts.found ?? null,
      updateMany: async () => ({ count: 1 }),
    },
    privacyRequestEvent: { create: async (a: unknown) => events.push(a) },
  };
  const prisma = { withSurface: async (s: string, fn: (t: unknown) => unknown) => (surfaces.push(s), fn(tx)) };
  const mail = {
    send: async (to: string, subject: string, text: string) => {
      if (opts.failMail) throw new Error('smtp caído');
      sent.push({ to, subject, text });
    },
  };
  const config = { appUrl: 'https://app.kobrax.test/', reportsNotifyEmail: NOTIFY };
  const svc = new PrivacyRequestsService(prisma as never, {} as never, mail as never, config as never);
  return { svc, created, sent, events, surfaces };
}

describe('reportes públicos · servicio', () => {
  it('guarda como THIRD_PARTY, sin usuario, con el correo en minúsculas, dentro de la superficie «public», y devuelve solo un código', async () => {
    const { svc, created, surfaces } = make();
    assert.deepEqual(await svc.filePublic(dto(ok)), { reference: 'ABCDEF12' });
    const data = created[0]!.data;
    assert.equal(data.subjectKind, PrivacySubjectKind.THIRD_PARTY);
    assert.equal(data.contactEmail, 'persona@ejemplo.com');
    assert.equal('requesterUserId' in data, false);
    assert.deepEqual(surfaces, ['public']);
  });

  it('🔴 cada reporte avisa a kobraxikigai@gmail.com, con el contacto y el texto', async () => {
    const { svc, sent } = make();
    await svc.filePublic(dto(ok));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, NOTIFY);
    assert.match(sent[0]!.subject, /ABCDEF12/);
    assert.match(sent[0]!.text, /persona@ejemplo\.com/);
    assert.match(sent[0]!.text, /Me llaman a toda hora/);
    assert.match(sent[0]!.text, /no requiere confirmación/);
  });

  it('🔴 un pedido que actúa sobre la cuenta manda un enlace de un solo uso a la persona, y guarda SOLO su huella', async () => {
    const { svc, created, sent } = make();
    await svc.filePublic(dto(erase));
    const toPerson = sent.find((m) => m.to === 'persona@ejemplo.com');
    assert.ok(toPerson, 'el correo de confirmación va a quien escribió');
    const token = /verificar-reporte\?token=([A-Za-z0-9_-]+)/.exec(toPerson!.text)?.[1];
    assert.ok(token && token.length >= 40);
    assert.match(toPerson!.text, /^.*$/m);
    assert.ok(toPerson!.text.includes('https://app.kobrax.test/verificar-reporte'), 'sin barra doble');
    const data = created[0]!.data;
    assert.equal(data.contactVerifyHash, createHash('sha256').update(token!).digest('hex'));
    assert.ok(!JSON.stringify(data).includes(token!), 'el token en claro nunca se guarda');
    assert.ok(data.contactVerifyExpiresAt instanceof Date);
    // Y a la plataforma se le avisa que está pendiente de confirmar.
    assert.match(sent.find((m) => m.to === NOTIFY)!.text, /PENDIENTE de confirmar/);
  });

  it('un reporte de abuso NO manda correo de confirmación (no hay nada que confirmar)', async () => {
    const { svc, created, sent } = make();
    await svc.filePublic(dto(ok));
    assert.equal(sent.some((m) => m.to === 'persona@ejemplo.com'), false);
    assert.equal('contactVerifyHash' in created[0]!.data, false);
  });

  it('🔴 si el correo falla, la solicitud igual queda registrada y se responde bien', async () => {
    const { svc, created } = make({ failMail: true });
    assert.deepEqual(await svc.filePublic(dto(erase)), { reference: 'ABCDEF12' });
    assert.equal(created.length, 1);
  });

  it('🔴 la trampa llena: responde bien pero NO guarda nada ni manda correos', async () => {
    const { svc, created, sent } = make();
    assert.deepEqual(await svc.filePublic(dto({ ...ok, website: 'http://spam.example' })), { reference: 'recibido' });
    assert.equal(created.length + sent.length, 0);
  });

  it('🔴 tope de pedidos abiertos por correo', async () => {
    const { svc, created } = make({ open: MAX_OPEN_PER_CONTACT });
    await assert.rejects(svc.filePublic(dto(ok)), (e: { response?: { code?: string } }) => e.response?.code === 'PRIVACY_REQUEST_TOO_MANY_OPEN');
    assert.equal(created.length, 0);
  });
});

describe('reportes públicos · confirmar el correo', () => {
  const found = { id: 'abcdef12-0000-0000-0000-000000000000', status: PrivacyRequestStatus.RECEIVED, type: 'ACCOUNT_DELETION', contactEmail: 'persona@ejemplo.com', contactName: null, reportedSubject: null, description: 'Quiero eliminar mi cuenta.' };

  it('confirma, deja un evento y avisa a Kobrax que el correo ya está confirmado', async () => {
    const { svc, events, sent } = make({ found });
    assert.deepEqual(await svc.confirmPublic('t'.repeat(43)), { reference: 'ABCDEF12' });
    assert.equal(events.length, 1);
    assert.match(sent[0]!.text, /CONFIRMADO/);
  });

  it('🔴 un enlace desconocido, vencido o ya usado responde igual (404 genérico) y no avisa a nadie', async () => {
    const { svc, sent, events } = make({ found: null });
    await assert.rejects(svc.confirmPublic('t'.repeat(43)), (e: { response?: { code?: string } }) => e.response?.code === 'PRIVACY_VERIFY_INVALID');
    assert.equal(sent.length + events.length, 0);
  });
});
