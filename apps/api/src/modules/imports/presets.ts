/**
 * Presets de importación: puntos de partida para configurar un formato conocido.
 *
 * ESTO SON DATOS, NO CÓDIGO DE LECTURA (C12). El motor (`pdf-blocks.parser.ts`,
 * `rows.parser.ts`) no importa este archivo ni sabe que existe: lo consume la UI de Ajustes
 * para prellenar `importConfig`, y el usuario ajusta lo que no coincida con su archivo.
 *
 * Sumar un banco = agregar una entrada acá. Un cliente cuyo formato no está **no queda
 * bloqueado**: elige "Empezar de cero", sube un archivo de muestra y empareja lo que la app
 * encontró. Ese es el camino principal; los presets sólo ahorran trabajo.
 *
 * ponytail: vive en la API, no en `packages/shared`, porque el único consumidor (el móvil) los
 * recibe por el endpoint de configuración. Si algún día la web los necesita sin pasar por la
 * API, se mueven a shared.
 */
import type { FieldMap, PdfBlocksProfile } from './parsers/pdf-blocks.parser';

export interface ImportPreset {
  id: string;
  label: string;
  kind: 'pdf-blocks' | 'rows';
  profile: PdfBlocksProfile;
  fields: FieldMap;
  /** Columna del cuadro sugerida para los días de atraso. El usuario la CONFIRMA (§6.5.1). */
  daysPastDueColumn?: string;
}

/**
 * Extracto de préstamos del Banco Unión (formulario `PRR0785A`).
 * Es UN EJEMPLO de configuración, no una categoría del sistema.
 */
export const BANCO_UNION_PRESET: ImportPreset = {
  id: 'banco-union',
  label: 'Extracto Banco Unión',
  kind: 'pdf-blocks',
  profile: {
    signature: ['REPORTE DE EXTRACTO DE PRESTAMOS', 'PRR0785A'],
    recordStart: 'Cliente',
    tableAnchor: 'Capital',
  },
  fields: {
    code: { from: 'No.Credito' },
    clientName: { from: 'Cliente' },
    coHolder: { from: 'Cliente', in: 'below' },
    status: { from: 'Estado' },
    principalAmount: { from: 'Monto' },
    outstandingBalance: { from: 'Saldo Credito' },
    interestRate: { from: 'Tasa Interes' },
    currency: { from: 'Moneda' },
    disbursedAt: { from: 'Fecha Desembolso' },
    daysPastDue: { from: 'Dias Mora', in: 'table' },
    pastDueAmount: { from: 'Moratorios', in: 'table' },
  },
  daysPastDueColumn: 'Dias Mora',
};

export const IMPORT_PRESETS: ImportPreset[] = [BANCO_UNION_PRESET];

export function findPreset(id: string | undefined): ImportPreset | undefined {
  return IMPORT_PRESETS.find((p) => p.id === id);
}
