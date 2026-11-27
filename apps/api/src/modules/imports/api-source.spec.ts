import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { callApi, checkApiHeaders, checkApiUrl, isPublicAddress } from './api-source';

const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;

describe('api-source — a dónde se puede llamar (SSRF)', () => {
  it('sólo direcciones públicas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.5', '169.254.169.254', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
    for (const ip of ['8.8.8.8', '200.87.10.1', '2606:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  });

  it('exige https, sin credenciales en la URL ni IP privadas escritas de ninguna forma', () => {
    assert.throws(() => checkApiUrl('http://banco.com/x'), code('IMPORT_API_URL'));
    assert.throws(() => checkApiUrl('file:///etc/passwd'), code('IMPORT_API_URL'));
    assert.throws(() => checkApiUrl('https://u:p@banco.com/x'), code('IMPORT_API_URL'));
    for (const url of ['https://127.0.0.1/', 'https://2130706433/', 'https://[::1]/', 'https://169.254.169.254/latest']) {
      assert.throws(() => checkApiUrl(url), code('IMPORT_API_BLOCKED'), url);
    }
    assert.equal(checkApiUrl('http://localhost:4500/x', true).port, '4500');
  });

  it('un nombre que resuelve a la propia máquina se corta al conectar', async () => {
    await assert.rejects(callApi({ method: 'GET', url: 'https://localhost:9/x', headers: {} }), code('IMPORT_API_BLOCKED'));
  });

  it('no deja pisar cabeceras de transporte ni meter saltos de línea', () => {
    assert.throws(() => checkApiHeaders({ Host: 'x' }), code('IMPORT_API_HEADER'));
    assert.throws(() => checkApiHeaders({ 'x-api-key': 'a\r\nb' }), code('IMPORT_API_HEADER'));
  });
});

describe('api-source — la llamada', () => {
  let server: Server;
  let base: string;
  before(async () => {
    server = createServer((req, res) => {
      let received = '';
      req.on('data', (c) => (received += c));
      req.on('end', () => {
        if (req.url === '/redir') return res.writeHead(302, { location: '/eco' }).end();
        if (req.url === '/lento') return;
        if (req.url === '/grande') return res.end('x'.repeat(2000));
        if (req.url === '/prohibido') return res.writeHead(401).end('secreto');
        res.end(JSON.stringify({ method: req.method, key: req.headers['x-api-key'], type: req.headers['content-type'], received }));
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const get = (path: string, extra = {}) => callApi({ method: 'GET', url: base + path, headers: {} }, { allowLocal: true, ...extra });

  it('manda método, cabeceras y cuerpo', async () => {
    const out = await callApi(
      { method: 'POST', url: `${base}/eco`, headers: { 'X-API-Key': 'abc' }, body: '{"corte":"hoy"}' },
      { allowLocal: true },
    );
    assert.deepEqual(JSON.parse(out.toString()), { method: 'POST', key: 'abc', type: 'application/json', received: '{"corte":"hoy"}' });
  });

  it('no sigue redirecciones, y un error no repite lo que dijo la API', async () => {
    await assert.rejects(get('/redir'), code('IMPORT_API_STATUS'));
    await assert.rejects(get('/prohibido'), (e: Error) => e.message.includes('401') && !e.message.includes('secreto'));
  });

  it('corta por tamaño y por tiempo', async () => {
    await assert.rejects(get('/grande', { maxBytes: 100 }), code('IMPORT_API_TOO_LARGE'));
    await assert.rejects(get('/lento', { timeoutMs: 200 }), code('IMPORT_API_TIMEOUT'));
  });
});
