import { Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { sha256OfBuffer } from '../field-ops/field-integrity';
import { fileNotFound, fileRejected } from './uploads.errors';

/** Lo mínimo que necesitamos de un archivo subido (evita depender de los tipos de multer). */
export interface UploadedFileLike {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface StoredFile {
  url: string;
  hash: string;
  size: number;
  mimeType: string;
}

/**
 * Primitivo de almacenamiento: recibe un archivo, lo guarda y devuelve su URL + hash.
 * Es la pieza que faltaba en todo el sistema (`field-ops` recibía una `fileUrl` ya existente).
 * La reusan la foto de fachada del cliente, el comprobante del pago y, más adelante, P8-evidencia.
 *
 * ponytail: driver de **disco local**, nada más. El contrato de env ya prevé S3/R2 y el día que haya
 * bucket aprovisionado se reemplaza el cuerpo de `store()`/`streamOf()` por el cliente de S3 — la
 * firma y el hash no cambian. Escribir hoy el driver de S3 sería infraestructura que no se puede
 * probar contra nada.
 */
@Injectable()
export class UploadsService {
  /** Aislado por tenant en disco, igual que en la DB: un archivo nunca cae en la carpeta de otro. */
  private readonly root = resolve(process.env.UPLOADS_DIR ?? 'uploads');

  constructor(
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async store(file: UploadedFileLike | undefined): Promise<StoredFile> {
    if (!file?.buffer?.length) throw fileRejected('No se recibió ningún archivo');
    const ext = ALLOWED[file.mimetype];
    if (!ext) throw fileRejected(`Tipo no permitido: ${file.mimetype}. Solo JPEG, PNG o WebP.`);
    if (file.size > MAX_UPLOAD_BYTES) throw fileRejected('El archivo supera los 8 MB');

    // Hash del buffer ORIGINAL (evidencia inmutable), y además nombra el archivo: subir dos veces
    // el mismo contenido no lo duplica.
    const hash = sha256OfBuffer(file.buffer);
    const dir = join(this.root, this.tenant.accountId);
    await mkdir(dir, { recursive: true });
    const name = `${hash}.${ext}`;
    await writeFile(join(dir, name), file.buffer);

    await this.audit.record({ entity: 'upload', entityId: hash, action: 'CREATE', after: { size: file.size, mimeType: file.mimetype } });
    return { url: `/api/uploads/${name}`, hash, size: file.size, mimeType: file.mimetype };
  }

  /** Sirve el archivo del tenant en sesión. El nombre es el hash: no hay forma de adivinar otro. */
  streamOf(name: string): Readable {
    if (!/^[0-9a-f]{64}\.(jpg|png|webp)$/.test(name)) throw fileNotFound();
    const path = join(this.root, this.tenant.accountId, name);
    if (!existsSync(path)) throw fileNotFound();
    return createReadStream(path);
  }
}
