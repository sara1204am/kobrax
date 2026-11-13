/**
 * Lógica pura del ejecutor de verificaciones (`run-verify.ts`, F14 · F9): qué archivos son verificaciones y cómo se lee lo que `psql` contesta.
 * Separada para poder probarla sin base de datos.
 */
import { readdirSync } from 'node:fs';

/**
 * Las verificaciones de `prisma/rls/`: `verify_*.sql`, MENOS `verify_isolation.sql`, que es una demostración que CREA un tenant de prueba y
 * por eso no es de solo lectura (no se corre automáticamente, ni en el despliegue).
 */
export function verifyFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^verify_.*\.sql$/.test(f) && f !== 'verify_isolation.sql')
    .sort();
}

export interface VerifyReport {
  /** Las comprobaciones que dijeron `OK n/m · …`. */
  ok: string[];
  /** Los `AVISO · …`: no hacen fallar, pero se muestran. */
  warnings: string[];
  /** La causa si abortó (`ERROR: …`); `null` si todo pasó. */
  error: string | null;
}

/** `psql -q` escribe los NOTICE y los ERROR por stderr, a veces con el prefijo `psql:<archivo>:<línea>:`. */
export function parseVerifyOutput(stderr: string, stdout = ''): VerifyReport {
  const report: VerifyReport = { ok: [], warnings: [], error: null };
  for (const raw of `${stderr}\n${stdout}`.split(/\r?\n/)) {
    const line = raw.trim().replace(/^psql:\S+:\d+:\s*/, '');
    const notice = /^NOTICE:\s+(.*)$/.exec(line);
    if (notice) {
      const text = notice[1]!.trim();
      if (text.startsWith('OK ')) report.ok.push(text);
      else if (text.startsWith('AVISO')) report.warnings.push(text);
      continue;
    }
    const error = /^(?:ERROR|FATAL):\s+(.*)$/.exec(line);
    if (error && report.error === null) report.error = error[1]!.trim();
  }
  return report;
}

/** ¿Pasó? Sin error Y con al menos una comprobación `OK` (un archivo que no imprime nada no verificó nada). */
export function passed(report: VerifyReport, exitCode: number | null): boolean {
  return exitCode === 0 && report.error === null && report.ok.length > 0;
}
