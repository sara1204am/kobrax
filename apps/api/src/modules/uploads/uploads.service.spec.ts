import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { UploadsService, MAX_UPLOAD_BYTES } from './uploads.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

const jpeg = (body = 'foto'): Buffer => Buffer.from(body);
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
    assert.equal(Buffer.concat(chunks).toString(), 'foto');
  });
});
