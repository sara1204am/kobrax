import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPaymentsQueryDto } from './dto/payment.dto';

const U1 = '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11';
const U2 = '0b7e5a3c-1d2f-4a6b-9c8d-7e6f5a4b3c2d';

async function check(q: Record<string, unknown>) {
  const dto = plainToInstance(ListPaymentsQueryDto, q);
  return { dto, errors: await validate(dto) };
}

describe('ListPaymentsQueryDto — oficiales, medios y resumen', () => {
  it('acepta uno o varios oficiales separados por coma', async () => {
    assert.equal((await check({ registeredBy: U1 })).errors.length, 0);
    assert.equal((await check({ registeredBy: `${U1},${U2}` })).errors.length, 0);
  });

  it('rechaza un oficial que no es uuid, una lista rota o una de más de 50', async () => {
    assert.ok((await check({ registeredBy: 'ana' })).errors.length > 0);
    assert.ok((await check({ registeredBy: `${U1},` })).errors.length > 0);
    assert.ok((await check({ registeredBy: Array(51).fill(U1).join(',') })).errors.length > 0);
  });

  it('acepta los medios reales del sistema y rechaza los inventados', async () => {
    assert.equal((await check({ method: 'CASH' })).errors.length, 0);
    assert.equal((await check({ method: 'CASH,QR,TRANSFER' })).errors.length, 0);
    assert.ok((await check({ method: 'BITCOIN' })).errors.length > 0);
    assert.ok((await check({ method: 'CASH,' })).errors.length > 0);
  });

  it('el resumen llega como texto en la URL y se vuelve booleano', async () => {
    assert.equal((await check({ summary: '1' })).dto.summary, true);
    assert.equal((await check({ summary: 'true' })).dto.summary, true);
    assert.equal((await check({ summary: '0' })).dto.summary, false);
    assert.equal((await check({})).dto.summary, undefined);
  });
});
