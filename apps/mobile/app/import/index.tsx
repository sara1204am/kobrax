import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { EmptyState, Header, ListRow, OfflineIndicator, SectionLabel, StatTile } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { importService, markImported, markImportSkipped, type PickedFile, type PortfolioSummary } from '@/import.service';

/**
 * Gate del import diario (§6.2 del plan import). Entra acá el primer login del día si el tenant
 * tiene `askOnLogin`, y también desde `Más › Importación`.
 *
 * **Saltar no es importar**: "Ir al Dashboard" marca el flag de salto, no el de importado, así
 * que la app sigue sabiendo que el import está pendiente.
 *
 * ponytail: versión mínima del slice S2/S3 — elegir archivo, Vista Previa, confirmar. Los KPIs
 * de la cartera, el reparto (S5) y la carga rápida (S6) van en sus propios slices.
 */
export default function ImportGateScreen() {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [preview, setPreview] = useState<PortfolioSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function skip() {
    // Marca el flag de SALTO, no el de importado: el gate no vuelve hoy, pero el import
    // sigue pendiente para el resto de la app.
    await markImportSkipped();
    router.replace('/(tabs)');
  }

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({
      // El motor acepta las dos formas de archivo (§4.1); el tipo real lo valida el backend.
      type: ['application/pdf', 'text/csv', 'text/comma-separated-values', 'text/plain'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const picked: PickedFile = { uri: a.uri, name: a.name, mimeType: a.mimeType };
    setFile(picked);
    setPreview(null);
    await dryRun(picked);
  }

  async function dryRun(picked: PickedFile) {
    setBusy(true);
    setError(null);
    const res = await importService.run(picked, true);
    setBusy(false);
    if (res.status === 'ok') setPreview(res as unknown as PortfolioSummary);
    else setError(message(res));
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const res = await importService.run(file, false);
    setBusy(false);
    if (res.status !== 'ok') return setError(message(res));
    await markImported();
    router.replace('/(tabs)');
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title="Importar cartera" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        {error && <ErrorBanner message={error} />}

        {!file && (
          <EmptyState
            icon="📥"
            title="Traé la cartera de hoy"
            hint="Elegí el archivo que emite tu sistema. Vas a ver qué cambia antes de confirmar."
          />
        )}

        {file && <ListRow title="Archivo" subtitle={file.name} />}

        {preview && (
          <>
            <SectionLabel>QUÉ VA A PASAR</SectionLabel>
            <View style={styles.tiles}>
              <StatTile label="Agregados" value={String(preview.counts.created)} />
              <StatTile label="Actualizados" value={String(preview.counts.updated)} />
              <StatTile label="Al día" value={String(preview.counts.setCurrent)} />
            </View>
            {preview.counts.invalid > 0 && (
              <Text style={styles.danger}>
                {preview.counts.invalid} fila{preview.counts.invalid === 1 ? '' : 's'} con problemas — no se importan
              </Text>
            )}
            {preview.preview.warnings
              .filter((w) => w.index === undefined) // las de fila se ven en el detalle, no acá
              .map((w) => (
                <Text key={w.code} style={styles.warn}>
                  {WARNING_TEXT[w.code] ?? w.code}
                  {w.detail ? ` (${w.detail})` : ''}
                </Text>
              ))}
          </>
        )}

        <Button
          label={file ? 'Elegir otro archivo' : 'Elegir archivo'}
          variant={file ? 'ghost' : 'primary'}
          onPress={() => void pick()}
          disabled={busy}
        />
        {/* La Vista Previa es obligatoria: sin `preview` cargada no se puede confirmar. */}
        {preview && <Button label="Confirmar importación" onPress={() => void confirm()} loading={busy} />}
        <Button label="Ir al Dashboard" variant="ghost" onPress={() => void skip()} disabled={busy} />
      </ScrollView>
    </View>
  );
}

const WARNING_TEXT: Record<string, string> = {
  MORA_SIN_CONFIRMAR: '⚠ Todavía no confirmaste cuál columna son los días de atraso.',
  MORA_COLUMNA_SOSPECHOSA: '⚠ Puede que la columna de días de atraso esté mal elegida.',
};

function message(res: { status: string; message?: string }): string {
  if (res.status === 'offline') return 'Sin conexión. El import se hace en la oficina, con wifi.';
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message ?? 'No se pudo leer el archivo';
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: SPACING.sm },
  danger: { fontSize: 13, color: COLORS.danger, fontWeight: '600' },
  warn: { fontSize: 13, color: COLORS.warningText },
});
