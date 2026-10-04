import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEpisodes, type EpisodeRow } from './mora-episodes';

const NOW = new Date('2026-10-01T15:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function ep(over: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 'e1',
    startedAt: d('2026-06-22'),
    startedAtEstimated: true,
    endedAt: null,
    endReason: null,
    startDaysPastDue: 100,
    maxDaysPastDue: 105,
    balanceAtStart: '7011.42',
    balanceAtEnd: null,
    source: 'IMPORTED',
    reconstructed: false,
    createdAt: new Date('2026-09-30T12:00:00Z'),
    ...over,
  };
}

describe('serializeEpisodes — el historial de mora de un crédito', () => {
  it('sin episodios devuelve una lista vacía', () => assert.deepEqual(serializeEpisodes([], NOW), []));

  it('🔴 del más reciente al más antiguo, pero numerados en orden cronológico', () => {
    const out = serializeEpisodes(
      [
        ep({ id: 'a', startedAt: d('2026-01-10'), endedAt: d('2026-02-01'), endReason: 'CURRENT' }),
        ep({ id: 'c', startedAt: d('2026-08-01') }),
        ep({ id: 'b', startedAt: d('2026-04-05'), endedAt: d('2026-05-01'), endReason: 'PAID' }),
      ],
      NOW,
    );
    assert.deepEqual(out.map((e) => `${e.id}#${e.number}`), ['c#3', 'b#2', 'a#1']);
  });

  it('el abierto es el actual y su duración corre hasta hoy; el cerrado, hasta su fin', () => {
    const [abierto, cerrado] = serializeEpisodes(
      [ep({ id: 'x', startedAt: d('2026-01-10'), endedAt: d('2026-01-20'), endReason: 'CURRENT' }), ep({ id: 'y', startedAt: d('2026-09-21') })],
      NOW,
    );
    assert.equal(abierto!.current, true);
    assert.equal(abierto!.endedAt, undefined);
    assert.equal(abierto!.durationDays, 10);
    assert.equal(cerrado!.current, false);
    assert.equal(cerrado!.durationDays, 10);
    assert.equal(cerrado!.endReason, 'CURRENT');
  });

  it('las fechas salen como YYYY-MM-DD y el saldo como número', () => {
    const [e] = serializeEpisodes([ep({ balanceAtEnd: '0', endedAt: d('2026-09-30'), endReason: 'PAID' })], NOW);
    assert.equal(e!.startedAt, '2026-06-22');
    assert.equal(e!.endedAt, '2026-09-30');
    assert.equal(e!.balanceAtStart, 7011.42);
    assert.equal(e!.balanceAtEnd, 0);
  });

  it('🔴 un episodio reconstruido no inventa días ni saldos: llegan ausentes, no en 0', () => {
    const [e] = serializeEpisodes(
      [ep({ reconstructed: true, startDaysPastDue: null, maxDaysPastDue: null, balanceAtStart: null, balanceAtEnd: null, endedAt: d('2026-08-01'), endReason: 'CURRENT' })],
      NOW,
    );
    assert.equal(e!.reconstructed, true);
    assert.equal(e!.startDaysPastDue, undefined);
    assert.equal(e!.maxDaysPastDue, undefined);
    assert.equal(e!.balanceAtStart, undefined);
    assert.equal(e!.balanceAtEnd, undefined);
  });

  it('ausente de la fuente se distingue de «se puso al día»', () => {
    const [e] = serializeEpisodes([ep({ endedAt: d('2026-09-30'), endReason: 'SOURCE_ABSENT' })], NOW);
    assert.equal(e!.endReason, 'SOURCE_ABSENT');
  });

  it('mismo día de inicio: el que se creó primero es el #1', () => {
    const out = serializeEpisodes(
      [
        ep({ id: 'segundo', startedAt: d('2026-05-05'), createdAt: new Date('2026-05-06T10:00:00Z') }),
        ep({ id: 'primero', startedAt: d('2026-05-05'), createdAt: new Date('2026-05-05T10:00:00Z'), endedAt: d('2026-05-05'), endReason: 'CURRENT' }),
      ],
      NOW,
    );
    assert.equal(out.find((e) => e.id === 'primero')!.number, 1);
    assert.equal(out.find((e) => e.id === 'segundo')!.number, 2);
  });

  it('una duración nunca es negativa', () => {
    const [e] = serializeEpisodes([ep({ startedAt: d('2026-10-05') })], NOW);
    assert.equal(e!.durationDays, 0);
  });
});
