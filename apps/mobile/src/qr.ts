/**
 * Matriz de un código QR, lista para dibujar. Lógica pura, sin React.
 *
 * El encoder es `qrcode` (JS puro, ya estaba en el árbol como transitiva del CLI de Expo;
 * acá se declara explícito). **No entra `react-native-qrcode-svg`**: arrastra
 * `react-native-svg`, que es un módulo nativo → prebuild + rebuild del dev build y adiós
 * a "todo corre en Expo Go".
 *
 * Se importa el core (`lib/core/qrcode`) y no el paquete: el entry principal arrastra los
 * renderers de Node (fs, canvas) que Metro no puede resolver.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const encoder = require('qrcode/lib/core/qrcode.js') as {
  create(
    segments: Array<{ data: Uint8Array; mode: string }>,
    opts: { errorCorrectionLevel: string },
  ): { modules: { size: number; data: Uint8Array } };
};

/** Tramo horizontal de módulos negros: `width` módulos a partir de `x`. */
export interface QrRun {
  x: number;
  width: number;
}

export interface QrMatrix {
  /** Lado en módulos (sin contar el margen). */
  size: number;
  /** Un array de tramos negros por fila. Las filas en blanco quedan vacías. */
  rows: QrRun[][];
}

/**
 * ASCII → bytes, para pasarle segmentos ya codificados al encoder.
 *
 * Así se esquiva `TextEncoder`, que **React Native 0.74 no define** y que el modo BYTE de
 * `qrcode` usaría al recibir un string (`byte-data.js:6`) → `ReferenceError` en el teléfono.
 * La entrada real es la URL `otpauth://` que arma la API, y es ASCII garantizado porque
 * `otpauthUrl()` pasa issuer y label por `encodeURIComponent` (`api/.../totp.ts:92`).
 */
function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Un no-ASCII acá daría un QR que escanea mal y nadie sabría por qué.
    if (code > 127) throw new Error(`qr: se esperaba ASCII, llegó "${text[i]}" en la posición ${i}`);
    out[i] = code;
  }
  return out;
}

/**
 * Matriz de tramos negros. Los módulos negros contiguos se colapsan en un solo tramo, que
 * es una `View` al dibujar. Medido con la URL `otpauth://` real: 37×37 = 1369 celdas,
 * 698 módulos negros → **354 tramos**. La mitad de las vistas, y la pantalla es estática
 * (se dibuja una vez en el alta), así que no compite con el presupuesto de las listas.
 */
export function qrMatrix(text: string, errorCorrectionLevel = 'M'): QrMatrix {
  const { modules } = encoder.create([{ data: asciiBytes(text), mode: 'byte' }], {
    errorCorrectionLevel,
  });
  const size = modules.size;
  const rows: QrRun[][] = [];

  for (let y = 0; y < size; y++) {
    const runs: QrRun[] = [];
    let start = -1;
    for (let x = 0; x < size; x++) {
      const dark = modules.data[y * size + x] === 1;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push({ x: start, width: x - start });
        start = -1;
      }
    }
    if (start >= 0) runs.push({ x: start, width: size - start });
    rows.push(runs);
  }
  return { size, rows };
}
