import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrivacyRequestType, PrivacySubjectKind } from '@kobrax/shared';
import { CreatePublicReportDto, PUBLIC_REPORT_TYPES } from './dto/public-report.dto';
import { PrivacyRequestsService } from './privacy-requests.service';
import { MAX_OPEN_PER_CONTACT } from './privacy-requests.logic';

const ok = { type: PrivacyRequestType.ABUSE_REPORT, contactEmail: 'Persona@Ejemplo.com', description: 'Me llaman a toda hora y a mi trabajo.' };

describe('reportes públicos · DTO', () => {
  it('acepta un reporte válido', async () => {
    assert.equal((await validate(plainToInstance(CreatePublicReportDto, ok))).length, 0);
  });

  it('🔴 la lista de tipos es cerrada: no se puede pedir un tipo que no sea de formulario público', async () => {
    assert.equal(PUBLIC_REPORT_TYPES.includes(PrivacyRequestType.WITHDRAW_CONSENT as never), false);
    const errors = await validate(plainToInstance(CreatePublicReportDto, { ...ok, type: PrivacyRequestType.PORTABILITY }));
    assert.ok(errors.some((e) => e.property === 'type'));
  });

  it('exige un correo válido y una descripción de al menos 10 caracteres', async () => {
    const errors = await validate(plainToInstance(CreatePublicReportDto, { ...ok, contactEmail: 'no-es-correo', description: 'corto' }));
    assert.deepEqual(errors.map((e) => e.property).sort(), ['contactEmail', 'description']);
  });
});

describe('reportes públicos · servicio', () => {
  const make = (openCount: number) => {
    const created: unknown[] = [];
    const prisma = {
      privacyRequest: {
        count: async () => openCount,
        create: async (args: unknown) => {
          created.push(args);
          return { id: 'abcdef12-0000-0000-0000-000000000000' };
        },
      },
    };
    const svc = new PrivacyRequestsService(prisma as never, {} as never);
    return { svc, created };
  };

  it('guarda como THIRD_PARTY, sin usuario, con el correo en minúsculas, y devuelve solo un código', async () => {
    const { svc, created } = make(0);
    const res = await svc.filePublic(plainToInstance(CreatePublicReportDto, ok));
    assert.deepEqual(res, { reference: 'ABCDEF12' });
    const data = (created[0] as { data: Record<string, unknown> }).data;
    assert.equal(data.subjectKind, PrivacySubjectKind.THIRD_PARTY);
    assert.equal(data.contactEmail, 'persona@ejemplo.com');
    assert.equal('requesterUserId' in data, false);
  });

  it('🔴 la trampa llena: responde bien pero NO guarda nada', async () => {
    const { svc, created } = make(0);
    const res = await svc.filePublic(plainToInstance(CreatePublicReportDto, { ...ok, website: 'http://spam.example' }));
    assert.deepEqual(res, { reference: 'recibido' });
    assert.equal(created.length, 0);
  });

  it('🔴 tope de pedidos abiertos por correo', async () => {
    const { svc, created } = make(MAX_OPEN_PER_CONTACT);
    await assert.rejects(svc.filePublic(plainToInstance(CreatePublicReportDto, ok)), (e: { response?: { code?: string } }) => e.response?.code === 'PRIVACY_REQUEST_TOO_MANY_OPEN');
    assert.equal(created.length, 0);
  });
});
