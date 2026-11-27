import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiConnectionView, buildApiConnection, toApiRequest } from './api-connection';

const cipher = {
  encrypt: (s: string) => Buffer.from(s).toString('base64'),
  decrypt: (s: string) => Buffer.from(s, 'base64').toString(),
};
const first = buildApiConnection(
  { method: 'POST', url: 'https://banco.example.com/cartera', headers: [{ name: 'x-api-key', value: 'SECRETA' }], body: '{"clave":"OTRA"}' },
  null,
  cipher,
  false,
);

describe('api-connection', () => {
  it('lo que ve la pantalla no trae valores', () => {
    const view = JSON.stringify(apiConnectionView(first));
    assert.ok(!view.includes('SECRETA') && !view.includes('OTRA') && !view.includes('secret'), view);
  });

  it('sin volver a escribirlos se conservan, en el mismo servidor', () => {
    const next = buildApiConnection(
      { method: 'POST', url: 'https://banco.example.com/v2', headers: [{ name: 'x-api-key' }] },
      first,
      cipher,
      false,
    );
    assert.deepEqual(toApiRequest(next, cipher), {
      method: 'POST',
      url: 'https://banco.example.com/v2',
      headers: { 'x-api-key': 'SECRETA' },
      body: '{"clave":"OTRA"}',
    });
  });

  it('🔴 cambiar de servidor no se lleva la clave', () => {
    for (const input of [
      { method: 'GET' as const, url: 'https://otro.example.com/x', headers: [{ name: 'x-api-key' }] },
      { method: 'POST' as const, url: 'https://otro.example.com/x', headers: [] },
    ]) {
      assert.throws(() => buildApiConnection(input, first, cipher, false), (e: { code?: string }) => e.code === 'IMPORT_API_SECRET');
    }
  });

  it('un GET no guarda cuerpo', () => {
    const next = buildApiConnection({ method: 'GET', url: first.url, headers: [] }, first, cipher, false);
    assert.equal(next.hasBody, false);
  });
});
