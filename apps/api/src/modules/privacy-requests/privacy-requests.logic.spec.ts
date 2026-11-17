import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrivacyRequestStatus as S } from '@kobrax/shared';
import { OPEN_STATUSES, allowedNext, canTransition, checkTransition, isTerminal } from './privacy-requests.logic';

const ALL = Object.values(S);

describe('privacy-requests · máquina de estados', () => {
  it('los caminos permitidos son exactamente los definidos', () => {
    assert.deepEqual(allowedNext(S.RECEIVED), [S.IN_REVIEW, S.REJECTED]);
    assert.deepEqual(allowedNext(S.IN_REVIEW), [S.NEEDS_INFO, S.APPROVED, S.REJECTED]);
    assert.deepEqual(allowedNext(S.NEEDS_INFO), [S.IN_REVIEW, S.REJECTED]);
    assert.deepEqual(allowedNext(S.APPROVED), [S.COMPLETED]);
  });

  it('🔴 los estados finales no tienen salida', () => {
    for (const s of [S.REJECTED, S.COMPLETED]) {
      assert.equal(isTerminal(s), true);
      assert.deepEqual(allowedNext(s), []);
      for (const to of ALL) assert.equal(canTransition(s, to), false, `${s} → ${to}`);
    }
  });

  it('🔴 no se puede saltar pasos: de «Recibida» no se llega directo a «Aprobada» ni a «Completada»', () => {
    assert.equal(canTransition(S.RECEIVED, S.APPROVED), false);
    assert.equal(canTransition(S.RECEIVED, S.COMPLETED), false);
    assert.equal(canTransition(S.IN_REVIEW, S.COMPLETED), false);
  });

  it('ningún estado abierto es final y los abiertos son los cuatro esperados', () => {
    assert.deepEqual([...OPEN_STATUSES].sort(), [S.RECEIVED, S.IN_REVIEW, S.NEEDS_INFO, S.APPROVED].sort());
    for (const s of OPEN_STATUSES) assert.equal(isTerminal(s), false);
  });

  it('🔴 rechazar exige una justificación (no se rechaza en silencio, ni con espacios)', () => {
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.REJECTED, {}), { ok: false, code: 'REASON_REQUIRED' });
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.REJECTED, { rejectionReason: '   ' }), { ok: false, code: 'REASON_REQUIRED' });
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.REJECTED, { rejectionReason: 'no' }), { ok: false, code: 'REASON_REQUIRED' });
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.REJECTED, { rejectionReason: 'Obligación legal de conservar.' }), { ok: true });
  });

  it('pedir información exige decir qué falta', () => {
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.NEEDS_INFO, {}), { ok: false, code: 'NOTE_REQUIRED' });
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.NEEDS_INFO, { note: 'Falta la cédula.' }), { ok: true });
  });

  it('una transición inválida se dice antes que la falta de justificación', () => {
    assert.deepEqual(checkTransition(S.COMPLETED, S.REJECTED, { rejectionReason: 'motivo suficiente' }), { ok: false, code: 'INVALID_TRANSITION' });
  });

  it('completar y aprobar no exigen nada más (la nota es opcional)', () => {
    assert.deepEqual(checkTransition(S.APPROVED, S.COMPLETED, {}), { ok: true });
    assert.deepEqual(checkTransition(S.IN_REVIEW, S.APPROVED, {}), { ok: true });
  });
});
