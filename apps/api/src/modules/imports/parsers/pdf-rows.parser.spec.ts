import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parsePdfRows } from './pdf-rows.parser';
import { normalizeRecord } from '../field-catalog';

// Muestra real: "REPORTE DE SEGUIMIENTO DE MORA", 10 registros en una tabla dentro de un PDF.
// Es el formato que dejaba sin salida a los otros dos motores: no es texto (así que `rows` no
// aplica) y no tiene una sola etiqueta con `:` (así que `pdf-blocks` devuelve cero columnas).
const here = dirname(fileURLToPath(import.meta.url));
const PDF = resolve(here, '../../../../../../docs/flows/mora_10_registros.pdf');

// pdfjs deja el buffer detached al parsear → bytes frescos por llamada.
const bytes = (): Uint8Array => new Uint8Array(readFileSync(PDF));

// Emparejado que el usuario arma en Ajustes mirando su archivo. Nada de esto vive en el producto.
const fields = {
  code: { from: 'No de Oper.' },
  clientName: { from: 'Cliente' },
  outstandingBalance: { from: 'Saldo' },
  daysPastDue: { from: 'Atraso' },
};

describe('pdf-rows.parser — una tabla adentro de un PDF', () => {
  it('lee las 10 filas, con las columnas deducidas del propio archivo', async () => {
    const { records } = await parsePdfRows(bytes(), { tableAnchor: 'Cliente' }, fields);
    assert.equal(records.length, 10);

    const r = normalizeRecord(records[0]!);
    assert.equal(r.code, '302-222-2542');
    assert.equal(r.clientLastName, 'Miriam Cruz Apaza'); // nombre entero → APELLIDO (C13)
    assert.equal(r.outstandingBalance, 1996.85);
    assert.equal(r.daysPastDue, 25);

    // El último registro importa tanto como el primero: si el corte de filas se corre, la tabla
    // se lee "casi bien" y nadie lo nota hasta que falta un crédito en la cartera.
    const last = normalizeRecord(records[9]!);
    assert.equal(last.code, '302-222-9734');
    assert.equal(last.daysPastDue, 391);
  });

  it('el encabezado partido en dos líneas se une, y el pie de página no es un registro', async () => {
    // "No de" arriba de "Oper." son un solo encabezado; "Pagina 1" es una fila de un solo item.
    const { labels, records } = await parsePdfRows(bytes(), { tableAnchor: 'Cliente' }, fields);
    assert.ok(labels.includes('No de Oper.'), `no se unió el encabezado partido: ${labels.join(' · ')}`);
    assert.equal(
      records.some((r) => r.code === null || r.code === ''),
      false,
      'una fila sin N de operación es basura de pie de página, no un registro',
    );
  });

  it('la columna se corta por los DATOS, no por dónde cae el rótulo', async () => {
    // El rótulo "Cliente" está centrado en x=119 y sus valores arrancan en x=75. Cortando por el
    // encabezado, los nombres caerían en la columna anterior (la del N de operación).
    const { records } = await parsePdfRows(bytes(), { tableAnchor: 'Cliente' }, fields);
    assert.equal(normalizeRecord(records[1]!).clientLastName, 'Justina Nina Limachi');
    assert.equal(records[1]!.code, '302-222-2766');
  });

  it('sin señalar la fila de encabezados no inventa nada, pero muestra el archivo', async () => {
    // Un reporte trae título, código de asesor y fecha antes de la tabla: ninguna regla general
    // distingue eso de un encabezado, así que lo señala el usuario.
    const { records, headerCandidates } = await parsePdfRows(bytes(), {}, fields);
    assert.equal(records.length, 0);
    assert.ok(headerCandidates.length > 0);
    assert.ok(
      headerCandidates.some((c) => c.preview.includes('Cliente') && c.preview.includes('Saldo')),
      'la fila de encabezados tiene que estar entre las que se ofrecen',
    );
  });
});
