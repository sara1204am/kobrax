import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parsePdfRows } from './pdf-rows.parser';
import { looksLikeOperationCode, normalizeRecord } from '../field-catalog';

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
  phone: { from: 'Telefonos' },
  address: { from: 'Direccion Dom.' },
  addressRef: { from: 'Ref. Domicilio' },
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

  it('trae también teléfono y dirección, que es lo que sirve en la calle', async () => {
    const { records } = await parsePdfRows(bytes(), { tableAnchor: 'Cliente' }, fields);
    const r = normalizeRecord(records[0]!);
    assert.equal(r.phone, '69081003');
    assert.equal(r.address, 'Av. Entre Rios No 95 - Zona Santiago II');
    assert.equal(r.addressRef, 'Pasando el surtidor'); // cómo se llega: para el cobrador vale igual

    // Una celda de direcciones larga se parte en varias líneas dentro de la fila. Si se tomara la
    // última en vez de concatenarlas, media dirección se perdería sin que nadie lo note.
    assert.equal(normalizeRecord(records[5]!).addressRef, 'Parada Micro T');
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

  it('dos columnas con el mismo rótulo no se pisan', async () => {
    // Un reporte con "Teléfono" del cliente y "Teléfono" del garante es normal. Si la segunda
    // pisara a la primera en el registro, se perdería un dato sin que nadie lo note.
    const { labels } = await parsePdfRows(bytes(), { tableAnchor: 'Cliente' }, fields);
    assert.equal(new Set(labels).size, labels.length, `hay encabezados repetidos: ${labels.join(' · ')}`);
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

// Cinco cortes diarios del mismo asesor (datos simulados de PSF). El mismo formato, cinco días: las
// columnas tienen que salir IGUALES todos los días, o un emparejado hecho el lunes deja de leer el
// saldo el martes. Antes pasaba: los montos van alineados a la derecha y su X de inicio baila con el
// ancho del número, así que «Saldo» y «Cuota» quedaban en una sola columna según el día.
const DAILY = ['20260928', '20260929', '20260930', '20261001', '20261002'].map((d) =>
  resolve(here, `../../../../../../docs/flows/psf-diario/Reporte_Mora_${d}_CQE.pdf`),
);
const dailyFields = {
  code: { from: 'Nº Operación' },
  clientName: { from: 'Cliente' },
  outstandingBalance: { from: 'Saldo Capital (Bs)' },
  installmentAmount: { from: 'Cuota (Bs)' },
  daysPastDue: { from: 'Días Atraso' },
  status: { from: 'Estado' },
  pastDueAmount: { from: 'Total a Cobrar (Bs)' },
};

describe('pdf-rows.parser — reportes diarios de un asesor', () => {
  it('las columnas de la tabla son las mismas los cinco días', async () => {
    const REAL = ['Nº Operación', 'Cliente', 'Monto Crédito (Bs)', 'Saldo Capital (Bs)', 'Cuota (Bs)', 'Plazo (M)', 'Días Atraso', 'Calif.', 'Estado', 'Cuotas Venc.', 'Monto Vencido (Bs)', 'Total a Cobrar (Bs)'];
    for (const pdf of DAILY) {
      const { labels } = await parsePdfRows(new Uint8Array(readFileSync(pdf)), { tableAnchor: 'Nº Operación' }, {});
      for (const l of REAL) assert.ok(labels.includes(l), `${pdf}: falta la columna «${l}»`);
    }
  });

  it('lee cada operación con sus números, y el marcador de alta "(N)" no es parte del nº', async () => {
    const { records } = await parsePdfRows(new Uint8Array(readFileSync(DAILY[1]!)), { tableAnchor: 'Nº Operación' }, dailyFields);
    const first = normalizeRecord(records[0]!);
    assert.equal(first.code, '302-222-5381'); // viene "302-222-5381 (N)"
    assert.equal(first.clientLastName, 'Elizabeth Chambi Ticona');
    assert.equal(first.outstandingBalance, 13123.1);
    assert.equal(first.installmentAmount, 505.33);
    assert.equal(first.daysPastDue, 1);
    assert.equal(first.status, 'Vigente en mora');
  });

  it('las filas de operaciones son las del día; el pie (totales, movimientos) no trae nº de operación', async () => {
    const expected = [10, 13, 16, 15, 19];
    for (const [i, pdf] of DAILY.entries()) {
      const { records } = await parsePdfRows(new Uint8Array(readFileSync(pdf)), { tableAnchor: 'Nº Operación' }, dailyFields);
      const ops = records.map((r) => normalizeRecord(r).code).filter((c) => c && looksLikeOperationCode(c));
      assert.equal(ops.length, expected[i], pdf);
      assert.equal(new Set(ops).size, ops.length, `${pdf}: nº repetido`);
    }
  });
});
