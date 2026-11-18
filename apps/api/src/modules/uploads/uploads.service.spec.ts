import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { UploadsService, MAX_UPLOAD_BYTES } from './uploads.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

const jpeg = (body = 'foto'): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(body)]);
const file = (over: Record<string, unknown> = {}) => ({ buffer: jpeg(), mimetype: 'image/jpeg', size: 4, ...over }) as never;

let dir: string;
let service: UploadsService;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kobrax-uploads-'));
  process.env.UPLOADS_DIR = dir;
  service = new UploadsService({ accountId: 'acc-A' } as never, { record: async () => undefined } as never);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('UploadsService.store', () => {
  it('devuelve el SHA-256 del buffer ORIGINAL (evidencia inmutable)', async () => {
    const r = await service.store(file());
    assert.equal(r.hash, createHash('sha256').update(jpeg()).digest('hex'));
    assert.equal(r.mimeType, 'image/jpeg');
    assert.match(r.url, /^\/api\/uploads\/[0-9a-f]{64}\.jpg$/);
  });

  it('el mismo contenido subido dos veces no se duplica (el hash nombra el archivo)', async () => {
    const a = await service.store(file());
    const b = await service.store(file());
    assert.equal(a.url, b.url);
  });

  it('rechaza un tipo no permitido', async () => {
    await rejectsWithCode(service.store(file({ mimetype: 'application/pdf' })), 'UPLOAD_001');
  });

  it('rechaza un archivo por encima del límite', async () => {
    await rejectsWithCode(service.store(file({ size: MAX_UPLOAD_BYTES + 1 })), 'UPLOAD_001');
  });

  it('rechaza un request sin archivo', async () => {
    await rejectsWithCode(service.store(undefined), 'UPLOAD_001');
  });
});

describe('UploadsService.streamOf', () => {
  it('404 ante un nombre que no es un hash (no se puede pedir un path arbitrario)', () => {
    assert.throws(() => service.streamOf('../../.env'), /UPLOAD_002|Archivo no encontrado/);
  });

  it('404 si el archivo no existe en la carpeta del tenant', () => {
    assert.throws(() => service.streamOf(`${'a'.repeat(64)}.jpg`), /UPLOAD_002|Archivo no encontrado/);
  });

  it('devuelve el contenido subido', async () => {
    const { url } = await service.store(file());
    const name = url.split('/').pop()!;
    const chunks: Buffer[] = [];
    for await (const c of service.streamOf(name)) chunks.push(c as Buffer);
    assert.deepEqual(Buffer.concat(chunks), jpeg());
  });
});

describe('matchesDeclaredType (S-12 · magic bytes)', () => {
  it('acepta firmas válidas y rechaza contenido que no corresponde al tipo declarado', async () => {
    const { matchesDeclaredType } = await import('./uploads.service');
    assert.equal(matchesDeclaredType('image/jpeg', jpeg()), true);
    assert.equal(matchesDeclaredType('image/png', Buffer.from('<html><script>alert(1)</script></html>')), false);
    assert.equal(matchesDeclaredType('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), true);
    assert.equal(matchesDeclaredType('application/pdf', Buffer.from('%PDF-1.7\n')), true);
    assert.equal(matchesDeclaredType('application/pdf', Buffer.from('MZ\x90')), false);
    assert.equal(matchesDeclaredType('text/csv', Buffer.from('a,b')), true, 'CSV no tiene firma');
  });
});
