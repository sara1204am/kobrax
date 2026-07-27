import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '@/theme';
import { Header, OfflineIndicator, SectionLabel, StatTile } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import {
  importService,
  LIST_LIMIT,
  markImported,
  moreLabel,
  warningText,
  type PortfolioSummary,
} from '@/import.service';

/**
 * Vista Previa de la importación (mockup `24:2051`).
 *
 * Es obligatoria y no se saltea (§6.2 del plan maestro): la corrida real sólo se ofrece cuando ya
 * se vio qué va a pasar. Los tres baldes son *agregados · actualizados · al día*; **no hay balde
 * de eliminados** ni en cero — el reconcile no borra, y dibujarlo sugeriría que podría.
 *
 * La lectura del archivo (dryRun) se hace acá y no en la pantalla anterior: así los parámetros de
 * navegación son sólo el archivo elegido (strings), y volver atrás no arrastra un resultado viejo.
 */
export default function PreviewScreen() {
  const { uri, name, mimeType, test } = useLocalSearchParams<{
    uri: string;
    name: string;
    mimeType?: string;
    test?: string;
  }>();
  const isTest = test === '1';

  const [preview, setPreview] = useState<PortfolioSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // El archivo se rearma desde los params dentro del callback: así la dependencia es el `uri`
  // (un string estable) y no un objeto nuevo en cada render, que relanzaría la lectura sola.
  const dryRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await importService.run({ uri, name, mimeType: mimeType || undefined }, true);
    setBusy(false);
    if (res.status === 'ok') setPreview(res);
    else setError(errorText(res));
  }, [uri, name, mimeType]);

  useEffect(() => {
    void dryRun();
  }, [dryRun]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await importService.run({ uri, name, mimeType: mimeType || undefined }, false);
    setBusy(false);
    if (res.status !== 'ok') return setError(errorText(res));
    // El día queda importado acá, con el POST real ya aplicado — no antes (la Vista Previa no
    // importa nada) ni en la pantalla siguiente (que también se abre en modo lectura desde Ajustes).
    await markImported();
    router.replace({
      pathname: '/import/resultado',
      params: {
        created: String(res.counts.created),
        updated: String(res.counts.updated),
        setCurrent: String(res.counts.setCurrent),
        invalid: String(res.counts.invalid),
        skip: res.idempotentSkip ? '1' : '',
        // Sólo los que se dibujan: el resto no viaja por la navegación.
        rejects: JSON.stringify(res.preview.invalid.slice(0, LIST_LIMIT)),
      },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title="Vista previa" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.file} numberOfLines={1}>
          {name}
        </Text>

        {error && <ErrorBanner message={error} />}
        {busy && !preview && (
          <View style={styles.loading}>
            <ActivityIndicator color={COLORS.navy} />
            <Text style={styles.hint}>Leyendo el archivo…</Text>
          </View>
        )}

        {preview && (
          <>
            {preview.idempotentSkip ? (
              // Mismo archivo ya aplicado: no hay nada que previsualizar. Se dice así, en vez de
              // dibujar tres baldes en cero que se leerían como "el archivo no trae nada".
              <View style={styles.note}>
                <Text style={styles.noteTitle}>Este archivo ya se importó</Text>
                <Text style={styles.hint}>
                  Se aplicó antes y no se vuelve a aplicar. Si tu sistema emitió uno nuevo, elegí ese.
                </Text>
              </View>
            ) : (
              <>
                <SectionLabel>QUÉ VA A PASAR</SectionLabel>
                <View style={styles.tiles}>
                  <StatTile label="Agregados" value={String(preview.counts.created)} />
                  <StatTile label="Actualizados" value={String(preview.counts.updated)} />
                  <StatTile label="Al día" value={String(preview.counts.setCurrent)} />
                </View>

                <BucketList
                  title="Se agregan"
                  items={preview.preview.toCreate.map((r) => ({ key: r.code, title: r.code, sub: r.clientName }))}
                />
                <BucketList
                  title="Se actualizan"
                  items={preview.preview.toUpdate.map((r) => ({ key: r.code, title: r.code }))}
                />
                <BucketList
                  title="Pasan a al día"
                  items={preview.preview.toSetCurrent.map((r, i) => ({
                    key: r.code ?? `s${i}`,
                    title: r.code ?? 'Sin número',
                  }))}
                  hint="No vienen en el archivo. Quedan vigentes y sin atraso; el saldo no se toca."
                />

                {preview.counts.invalid > 0 && (
                  <BucketList
                    title={`No se importan (${preview.counts.invalid})`}
                    danger
                    items={preview.preview.invalid.map((r) => ({
                      key: String(r.index),
                      title: `Registro ${r.index + 1}`,
                      sub: r.reason,
                    }))}
                  />
                )}

                {preview.preview.warnings
                  .filter((w) => w.index === undefined) // las de fila se ven en su registro
                  .map((w) => (
                    <Text key={w.code} style={styles.warn}>
                      {warningText(w.code, w.detail)}
                    </Text>
                  ))}
              </>
            )}
          </>
        )}

        {/* Sin preview cargada no existe el confirmar: la Vista Previa no se saltea. */}
        {preview && !preview.idempotentSkip && !isTest && (
          <Button label="Confirmar importación" onPress={() => void confirm()} loading={busy} />
        )}
        {isTest && preview && (
          <Text style={styles.hint}>
            Es una prueba: nada se importa. Si los números no cuadran, revisá el emparejado de columnas.
          </Text>
        )}
        {error && !preview && <Button label="Reintentar" variant="ghost" onPress={() => void dryRun()} />}
      </ScrollView>
    </View>
  );
}

/**
 * Un balde con su lista de *cuáles*. Corta en `LIST_LIMIT` y ofrece el resto: un archivo de 150
 * registros no se dibuja entero en un teléfono de gama baja (§9).
 *
 * Vive acá porque la usan los cuatro baldes de esta pantalla y nadie más; el patrón es el mismo
 * "Ver más (N)" de `app/(tabs)/agenda.tsx`. Si el resultado o la web la necesitan, se sube a `ui.tsx`.
 */
function BucketList({
  title,
  items,
  hint,
  danger,
}: {
  title: string;
  items: { key: string; title: string; sub?: string }[];
  hint?: string;
  danger?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const shown = showAll ? items : items.slice(0, LIST_LIMIT);
  const more = moreLabel(items.length, shown.length);
  return (
    <View style={styles.bucket}>
      <Text style={[styles.bucketTitle, danger && { color: COLORS.danger }]}>
        {title} · {items.length}
      </Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {shown.map((r) => (
        <View key={r.key} style={styles.item}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {r.title}
          </Text>
          {r.sub && (
            <Text style={styles.itemSub} numberOfLines={1}>
              {r.sub}
            </Text>
          )}
        </View>
      ))}
      {more && (
        <Pressable onPress={() => setShowAll(true)} hitSlop={8}>
          <Text style={styles.more}>{more}</Text>
        </Pressable>
      )}
    </View>
  );
}

function errorText(res: { status: string; message?: string }): string {
  if (res.status === 'offline') return 'Sin conexión. El import se hace en la oficina, con wifi.';
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message ?? 'No se pudo leer el archivo';
}

const styles = StyleSheet.create({
  body: { padding: SPACING.lg, gap: SPACING.md },
  file: { fontSize: 15, fontWeight: '600', color: COLORS.navy },
  hint: { fontSize: 13, color: COLORS.text2 },
  loading: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xl },
  tiles: { flexDirection: 'row', gap: SPACING.sm },
  note: { backgroundColor: COLORS.lightBg, borderRadius: RADIUS.card, padding: SPACING.md, gap: SPACING.xs },
  noteTitle: { fontSize: 15, fontWeight: '600', color: COLORS.navy },
  bucket: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, padding: SPACING.md, gap: SPACING.xs },
  bucketTitle: { fontSize: 15, fontWeight: '600', color: COLORS.navy },
  item: { paddingVertical: 2 },
  itemTitle: { fontSize: 15, color: COLORS.text, fontWeight: '500' },
  itemSub: { fontSize: 13, color: COLORS.text2 },
  more: { fontSize: 13, color: COLORS.slate, fontWeight: '600', paddingVertical: SPACING.xs },
  warn: { fontSize: 13, color: COLORS.warningText },
});
