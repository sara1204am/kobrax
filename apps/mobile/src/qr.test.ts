import { qrMatrix } from './qr';

const URL = 'otpauth://totp/Kobrax:sara%40kobrax.demo?secret=JBSWY3DPEHPK3PXP&issuer=Kobrax';

describe('qrMatrix', () => {
  it('devuelve una matriz cuadrada de tamaño válido de QR', () => {
    const m = qrMatrix(URL);
    // Las versiones de QR van 21, 25, 29… (4k+17). Un tamaño fuera de esa serie = matriz rota.
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect((m.size - 17) % 4).toBe(0);
    expect(m.rows).toHaveLength(m.size);
  });

  it('los tramos caen dentro de la fila y no se pisan', () => {
    const m = qrMatrix(URL);
    for (const runs of m.rows) {
      let prevEnd = -1;
      for (const r of runs) {
        expect(r.width).toBeGreaterThan(0);
        expect(r.x).toBeGreaterThan(prevEnd);
        expect(r.x + r.width).toBeLessThanOrEqual(m.size);
        prevEnd = r.x + r.width - 1;
      }
    }
  });

  // Los tres ojos del QR: 7×7 con borde negro. Si la esquina superior izquierda no arranca
  // con un tramo de 7 módulos, la matriz está mal leída (orden de filas/columnas invertido).
  it('el patrón de posición de la esquina mide 7 módulos', () => {
    const m = qrMatrix(URL);
    expect(m.rows[0]![0]).toEqual({ x: 0, width: 7 });
  });

  it('colapsa contiguos: menos tramos que módulos negros', () => {
    const m = qrMatrix(URL);
    const runs = m.rows.reduce((n, r) => n + r.length, 0);
    const dark = m.rows.reduce((n, r) => n + r.reduce((w, run) => w + run.width, 0), 0);
    // Medido con esta URL: 698 módulos negros → 354 tramos. Cada tramo es una `View`.
    expect(runs).toBeLessThan(dark);
  });

  // El encoder de `qrcode` usaría TextEncoder para un string, y RN 0.74 no lo define:
  // por eso `qr.ts` codifica a bytes él mismo. Si alguien mete un no-ASCII, que grite acá.
  it('rechaza texto no ASCII en vez de generar un QR que escanea mal', () => {
    expect(() => qrMatrix('otpauth://totp/Kobrax:José')).toThrow(/ASCII/);
  });
});
