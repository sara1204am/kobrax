/**
 * Publica los documentos legales de `docs/legal/documentos/*.md` en `legal_document_versions` (privacidad y consentimiento · B3).
 *
 *   pnpm db:seed:legal              publica lo que falte (idempotente)
 *   pnpm db:seed:legal -- --dry     solo muestra qué haría, sin escribir
 *
 * Cada archivo trae un encabezado `--- type / version / title / material ---` y el texto. El nombre termina en `.<idioma>.md`.
 *
 * 🔴 **Una versión publicada es evidencia y no se edita.** Si el archivo cambió respecto de lo que ya está en la base con ese mismo
 * número de versión, el script FALLA y pide subir la versión: nunca la sobrescribe (además la base lo impide con un trigger). Para
 * corregir un texto: sube `version` en el archivo y vuelve a correr el script.
 *
 * El hash (SHA-256) se calcula sobre el texto normalizado (fin de línea `\n`, sin espacios al final): es el mismo en Windows y Linux.
 * Es seguro correrlo en cada despliegue: no hace nada si todo está publicado.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient, type LegalDocumentType } from '@prisma/client';

const DIR = resolve(__dirname, '../../../docs/legal/documentos');
const TYPES: readonly string[] = ['TERMS', 'PRIVACY', 'COOKIES', 'DPA', 'ACCEPTABLE_USE', 'AI_POLICY'];
const dry = process.argv.includes('--dry');

/** El `.env` vive en la raíz del monorepo; el cliente de Prisma no lo busca ahí. Solo se toma `DATABASE_URL`, y solo si falta. */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = resolve(__dirname, '../../../.env');
  const m = existsSync(file) ? /^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(readFileSync(file, 'utf8')) : null;
  if (!m?.[1]) throw new Error('Falta DATABASE_URL (variable de entorno o .env de la raíz)');
  return m[1];
}

export interface ParsedDoc {
  file: string;
  type: LegalDocumentType;
  locale: string;
  version: string;
  title: string;
  isMaterial: boolean;
  content: string;
  sha256: string;
}

/** Normaliza el texto para que el hash no dependa del sistema operativo ni de espacios finales. */
export const normalize = (text: string): string =>
  text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export function parseDoc(file: string, raw: string): ParsedDoc {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${file}: falta el encabezado --- ... ---`);
  const head: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) head[kv[1]!] = kv[2]!.trim();
  }
  const locale = /\.([a-z]{2})\.md$/.exec(file)?.[1];
  if (!locale) throw new Error(`${file}: el nombre debe terminar en .<idioma>.md`);
  if (!head.type || !TYPES.includes(head.type)) throw new Error(`${file}: type inválido (${head.type ?? 'vacío'})`);
  if (!head.version || !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(head.version)) throw new Error(`${file}: version inválida (semver)`);
  if (!head.title) throw new Error(`${file}: falta title`);
  const content = normalize(m[2]!);
  if (content.length < 50) throw new Error(`${file}: el texto está vacío o es demasiado corto`);
  return {
    file,
    type: head.type as LegalDocumentType,
    locale,
    version: head.version,
    title: head.title,
    isMaterial: head.material === 'true',
    content,
    sha256: sha256(content),
  };
}

async function main() {
  const docs = readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseDoc(f, readFileSync(join(DIR, f), 'utf8')));
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  let created = 0;
  let skipped = 0;
  try {
    for (const d of docs) {
      const existing = await prisma.legalDocumentVersion.findUnique({
        where: { type_locale_version: { type: d.type, locale: d.locale, version: d.version } },
      });
      if (existing) {
        if (existing.contentSha256 !== d.sha256) {
          throw new Error(
            `${d.file}: la versión ${d.version} de ${d.type} ya está publicada con OTRO contenido. ` +
              'Una versión publicada no se edita: sube `version` en el archivo y vuelve a correr el script.',
          );
        }
        skipped += 1;
        console.log(`= ${d.type} ${d.locale} ${d.version} (ya publicada)`);
        continue;
      }
      console.log(`+ ${d.type} ${d.locale} ${d.version}  sha256 ${d.sha256.slice(0, 12)}…${dry ? '  [dry]' : ''}`);
      if (!dry) {
        await prisma.legalDocumentVersion.create({
          data: {
            type: d.type,
            locale: d.locale,
            version: d.version,
            title: d.title,
            content: d.content,
            contentSha256: d.sha256,
            isMaterial: d.isMaterial,
            changeSummary: 'Borrador inicial pendiente de revisión legal',
          },
        });
      }
      created += 1;
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(`\n${created} publicada(s), ${skipped} sin cambios.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
