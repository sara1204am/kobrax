import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePaymentDto } from './dto/payment.dto';

const BASE = { creditId: '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11', amount: 100, method: 'CASH' };

async function check(extra: Record<string, unknown>) {
  const dto = plainToInstance(CreatePaymentDto, { ...BASE, ...extra });
  return { dto, errors: await validate(dto) };
}

describe('CreatePaymentDto — receiptReference (N° de recibo o factura)', () => {
  it('es opcional', async () => {
    const { errors } = await check({});
    assert.equal(errors.length, 0);
  });

  it('se guarda sin los espacios de los extremos', async () => {
    const { dto, errors } = await check({ receiptReference: '  R-004512 ' });
    assert.equal(errors.length, 0);
    assert.equal(dto.receiptReference, 'R-004512');
  });

  it('rechaza uno vacío (sólo espacios) o de más de 40 caracteres', async () => {
    assert.ok((await check({ receiptReference: '   ' })).errors.length > 0);
    assert.ok((await check({ receiptReference: 'x'.repeat(41) })).errors.length > 0);
    assert.equal((await check({ receiptReference: 'x'.repeat(40) })).errors.length, 0);
  });
});
