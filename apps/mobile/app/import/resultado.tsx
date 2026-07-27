import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '@/theme';
import { Header, SectionLabel, StatTile } from '@/ui';
import { Button } from '@/components';
import { resultKind } from '@/import.service';

/**
 * Resultado de la importación (mockups `24:2280` éxito y `24:2164` con advertencias).
 *
 * Tres estados sobre la misma pantalla, porque comparten cabecera y tarjeta de resumen:
 *  - **ok** — se aplicó y no hubo rechazos.
 *  - **warned** — se aplicó, con registros que quedaron afuera y su motivo.
 *  - **skipped** — el archivo ya se había aplicado antes (idempotencia); los números son de esa corrida.
 * Y un modo **lectura** (`mode=read`), que es *"Ver detalle"* de Ajustes: la última corrida sólo
 * guarda contadores, así que muestra eso y no promete un detalle por registro que no existe.
 *
 * `markImported()` NO se llama acá: lo hace la Vista Previa al confirmar, que es donde se sabe que
 * el POST real se aplicó. Esta pantalla también se abre en modo lectura, y marcar el día desde acá
 * lo marcaría sin haber importado nada.
 *
 * No se dibuja "Descargar reporte de errores" del mockup (D-REPORTE): no existe generación de
 * reporte. Los rechazados se ven acá con su motivo, que es la necesidad real.
 */
export default function ResultadoScreen() {
  const p = useLocalSearchParams<{
    created?: string;
    updated?: string;
    setCurrent?: string;
    invalid?: string;
    skip?: string;
    rejects?: string;
    mode?: string;
    when?: string;
    template?: string;
    scope?: string;
  }>();

  const isRead = p.mode === 'read';
  const counts = {
    created: num(p.created),
    updated: num(p.updated),
    setCurrent: num(p.setCurrent),
    invalid: num(p.invalid),
  };
  const kind = resultKind(counts.invalid, p.skip === '1');
  const rejects = parseRejects(p.rejects);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* Sin `‹` después de importar: atrás está la Vista Previa de un archivo ya aplicado. La
          salida es el CTA. En modo lectura sí, porque se entró desde Ajustes. */}
      <Header title={isRead ? 'Última importación' : 'Resultado'} onBack={isRead ? () => router.back() : undefined} />
      <View style={styles.body}>
        {!isRead && (
          <View style={[styles.banner, kind === 'warned' && styles.bannerWarn]}>
            <Text style={styles.bannerIcon}>{kind === 'warned' ? '⚠️' : kind === 'skipped' ? '↺' : '✅'}</Text>
            <Text style={styles.bannerTitle}>
              {kind === 'warned'
                ? 'Importado, con registros afuera'
                : kind === 'skipped'
                  ? 'Este archivo ya se había importado'
                  : 'Cartera actualizada'}
            </Text>
          </View>
        )}

        {(isRead || kind === 'skipped') && (
          <Text style={styles.hint}>
            {[p.when, p.template, p.scope].filter(Boolean).join(' · ') || 'Corrida anterior'}
          </Text>
        )}

        <View style={styles.tiles}>
          <StatTile label="Agregados" value={String(counts.created)} tone="success" />
          <StatTile label="Actualizados" value={String(counts.updated)} />
          <StatTile label="Al día" value={String(counts.setCurrent)} />
        </View>

        {counts.invalid > 0 && (
          <>
            <SectionLabel>{`NO SE IMPORTARON (${counts.invalid})`}</SectionLabel>
            {rejects.map((r) => (
              <View key={r.index} style={styles.reject}>
                <Text style={styles.rejectTitle}>Registro {r.index + 1}</Text>
                <Text style={styles.hint}>{r.reason}</Text>
              </View>
            ))}
            {rejects.length === 0 ? (
              // Modo lectura: la corrida guarda el conteo, no el detalle por fila.
              <Text style={styles.hint}>El detalle por registro se ve al momento de importar.</Text>
            ) : (
              rejects.length < counts.invalid && (
                <Text style={styles.hint}>y {counts.invalid - rejects.length} más</Text>
              )
            )}
            <Text style={styles.hint}>
              El resto de la cartera sí se actualizó. Corregí esos registros en tu sistema y volvé a
              importar, o cargalos a mano.
            </Text>
          </>
        )}

        <View style={{ flex: 1 }} />
        <Button
          label={isRead ? 'Volver' : 'Ir al inicio'}
          onPress={() => (isRead ? router.back() : router.replace('/(tabs)'))}
        />
      </View>
    </View>
  );
}

const num = (v?: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Los rechazados viajan como JSON en los params. Un param roto no puede tumbar la pantalla. */
function parseRejects(raw?: string): { index: number; reason: string }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as { index: number; reason: string }[]) : [];
  } catch {
    return [];
  }
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: SPACING.lg, gap: SPACING.md },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.successBg,
    borderRadius: RADIUS.card,
    padding: SPACING.md,
  },
  bannerWarn: { backgroundColor: COLORS.warningBg },
  bannerIcon: { fontSize: 22 },
  bannerTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: COLORS.navy },
  hint: { fontSize: 13, color: COLORS.text2 },
  tiles: { flexDirection: 'row', gap: SPACING.sm },
  reject: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, padding: SPACING.md, gap: 2 },
  rejectTitle: { fontSize: 15, fontWeight: '600', color: COLORS.navy },
});
