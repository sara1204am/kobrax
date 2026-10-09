import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChangeRequestDto, CreateRouteDto, DecideChangeRequestDto, GenerateRouteDto, UpdateRouteDto } from './route.dto';

const COLLECTOR = '11111111-1111-4111-8111-111111111111';
const errorsOf = async <T extends object>(cls: new () => T, plain: object) => (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('DTOs de rutas (F4/12): lo que la API acepta de verdad, con el ValidationPipe', () => {
  it('🔴 la fecha de la ruta es solo el día: con hora la comparación contra la columna DATE falla en silencio', async () => {
    assert.deepEqual(await errorsOf(CreateRouteDto, { collectorId: COLLECTOR, plannedDate: '2026-10-08' }), []);
    assert.deepEqual(await errorsOf(GenerateRouteDto, { collectorId: COLLECTOR, plannedDate: '2026-10-08' }), []);
    assert.deepEqual(await errorsOf(CreateRouteDto, { collectorId: COLLECTOR, plannedDate: '2026-10-08T00:00:00.000Z' }), ['plannedDate']);
    assert.deepEqual(await errorsOf(GenerateRouteDto, { collectorId: COLLECTOR, plannedDate: '08/10/2026' }), ['plannedDate']);
    assert.deepEqual(await errorsOf(GenerateRouteDto, { collectorId: COLLECTOR, plannedDate: '' }), ['plannedDate']);
  });

  it('generar acepta la ubicación de cada crédito y el requisito de punto', async () => {
    const ok = await errorsOf(GenerateRouteDto, { collectorId: COLLECTOR, plannedDate: '2026-10-08', locations: { a: 'b' }, requirePoints: true });
    assert.deepEqual(ok, []);
    assert.deepEqual(await errorsOf(GenerateRouteDto, { collectorId: COLLECTOR, plannedDate: '2026-10-08', requirePoints: 'si' }), ['requirePoints']);
  });

  it('el motivo del cambio de estado es opcional pero acotado', async () => {
    assert.deepEqual(await errorsOf(UpdateRouteDto, { status: 'COMPLETED' }), []);
    assert.deepEqual(await errorsOf(UpdateRouteDto, { status: 'COMPLETED', reason: 'Se acabó el tiempo' }), []);
    assert.deepEqual(await errorsOf(UpdateRouteDto, { status: 'COMPLETED', reason: 'x'.repeat(501) }), ['reason']);
    assert.deepEqual(await errorsOf(UpdateRouteDto, { status: 'LO_QUE_SEA' }), ['status']);
  });

  it('un pedido de cambio lleva tipo y motivo; la decisión es una de tres', async () => {
    assert.deepEqual(await errorsOf(CreateChangeRequestDto, { kind: 'CANCEL', reason: 'No hace falta' }), []);
    assert.deepEqual(await errorsOf(CreateChangeRequestDto, { kind: 'BORRAR_TODO', reason: 'x' }), ['kind']);
    assert.deepEqual(await errorsOf(CreateChangeRequestDto, { kind: 'CANCEL' }), ['reason']);
    assert.deepEqual(await errorsOf(DecideChangeRequestDto, { decision: 'APPROVE' }), []);
    assert.deepEqual(await errorsOf(DecideChangeRequestDto, { decision: 'TAL_VEZ' }), ['decision']);
  });
});
