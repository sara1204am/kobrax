import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '@/theme';
import { Header, OfflineIndicator, SectionLabel } from '@/ui';
import { CountTiles } from '@/import-views';
import { Button, ErrorBanner } from '@/components';
import {
  alreadyAppliedText,
  importService,
  LIST_LIMIT,
  markImported,
  moreLabel,
  previewLine,
  rejectText,
  selfAssignments,
  unassignedNewCodes,
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
  /** «Asignar todo a mí»: los nuevos sin sugerencia del reporte quedan a nombre de quien confirma. */
  const [selfAll, setSelfAll] = useState(false);

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

  /*
   * Quién queda responsable. El cobrador (SELF) no elige: lo nuevo es suyo. Quien reparte (CHOOSE)
   * acepta en el teléfono la sugerencia del reporte; si algún nuevo no trae sugerencia puede asignarlos a sí
   * mismo («Asignar todo a mí»). Repartir entre varias personas se hace en el panel web.
   */
  const mode = preview?.assignment?.mode;
  const newHint =
    mode === 'SELF'
      ? 'Estos créditos se asignarán a ti.'
      : mode === 'CHOOSE'
        ? 'Quedan con el responsable que sugiere el reporte.'
        : undefined;
  const blocked = !preview
    ? null
    : preview.alreadyApplied
      ? {
          title: 'Este archivo ya se importó',
          text: `${alreadyAppliedText(preview.alreadyApplied)} Confirmar no cambiaría nada. Para cambiar responsables, usa Cartera en el panel web.`,
        }
      : null;
  const sinResponsable = !preview || preview.alreadyApplied || mode !== 'CHOOSE' ? 0 : unassignedNewCodes(preview).length;
  const needsSelf = sinResponsable > 0 && !selfAll;

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await importService.run({ uri, name, mimeType: mimeType || undefined }, false, selfAll && preview ? selfAssignments(preview) : undefined);
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
        absent: res.counts.absent === undefined ? '' : String(res.counts.absent),
        reappeared: String(res.counts.reappeared ?? 0),
        ignored: String(res.counts.ignored ?? 0),
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
            {/* Lo que impide confirmar desde el teléfono, dicho antes de la lista. */}
            {blocked && (
              <View style={styles.note}>
                <Text style={styles.noteTitle}>{blocked.title}</Text>
                <Text style={styles.hint}>{blocked.text}</Text>
              </View>
            )}
            {preview.idempotentSkip ? (
              // Mismo archivo ya aplicado: no hay nada que previsualizar. Se dice así, en vez de
              // dibujar tres baldes en cero que se leerían como "el archivo no trae nada".
              <View style={styles.note}>
                <Text style={styles.noteTitle}>Este archivo ya se importó</Text>
                <Text style={styles.hint}>
                  {alreadyAppliedText(preview.alreadyApplied)} No se vuelve a aplicar. Si tu sistema emitió uno nuevo, elige ese.
                </Text>
              </View>
            ) : (
              <>
                {/* D8 · D9: de qué día y de qué asesor es el reporte. */}
                {preview.report && (
                  <Text style={styles.hint}>
                    {preview.report.reportDate
                      ? `Corte del ${preview.report.reportDate.split('-').reverse().join('/')}`
                      : 'El reporte no dice su fecha de corte'}
                    {preview.report.advisorCode ? ` · Asesor ${preview.report.advisorCode}` : ''}
                  </Text>
                )}
                <SectionLabel>QUÉ VA A PASAR</SectionLabel>
                <CountTiles counts={preview.counts} />
                {/* Modo CHOOSE con créditos nuevos sin responsable: el servidor no deja confirmar así. */}
                {sinResponsable > 0 && (
                  <View style={styles.note}>
                    <Text style={styles.noteTitle}>{`${sinResponsable} crédito${sinResponsable === 1 ? '' : 's'} nuevo${sinResponsable === 1 ? '' : 's'} sin responsable`}</Text>
                    <Text style={styles.hint}>
                      {selfAll
                        ? 'Quedarán a tu nombre. El resto sigue con el responsable que sugiere el reporte.'
                        : 'El reporte no dice de quién son. Puedes asignarlos a ti, o repartirlos desde el panel web.'}
                    </Text>
                    {!selfAll && <Button label="Asignar todo a mí" variant="ghost" onPress={() => setSelfAll(true)} />}
                  </View>
                )}

                <BucketList
                  title="Se agregan"
                  hint={newHint}
                  items={preview.preview.toCreate.map((r) => ({
                    key: r.code,
                    title: r.clientName,
                    // D2: el que se parece a un cliente que ya existe entra igual, marcado para revisar.
                    sub: r.linkReview ? `${previewLine(r.code, undefined, r.after)} · revisar vínculo` : previewLine(r.code, undefined, r.after),
                  }))}
                />
                <BucketList
                  title="Se actualizan"
                  hint="Mantendrán su responsable actual."
                  items={preview.preview.toUpdate.map((r) => ({
                    key: r.code,
                    title: r.clientName ?? r.code,
                    sub: previewLine(r.code, r.before, r.after),
                  }))}
                />
                {preview.preview.toUpdate.some((r) => r.reappeared) && (
                  <BucketList
                    title="Volvieron al reporte"
                    items={preview.preview.toUpdate
                      .filter((r) => r.reappeared)
                      .map((r) => ({ key: r.code, title: r.clientName ?? r.code, sub: previewLine(r.code, r.before, r.after) }))}
                    hint="Faltaban y este reporte las vuelve a traer. Se actualiza el mismo crédito."
                  />
                )}
                <BucketList
                  title="Ya no vienen en el reporte"
                  items={(preview.preview.toMarkAbsent ?? preview.preview.toSetCurrent).map((r, i) => ({
                    key: r.code ?? `s${i}`,
                    title: r.clientName ?? r.code ?? 'Sin número',
                    sub: previewLine(r.code, r.before),
                  }))}
                  hint="No es un pago ni un cierre: el saldo y el estado quedan como estaban. Queda registrado desde qué día faltan."
                />

                {preview.counts.invalid > 0 && (
                  <BucketList
                    title={`No se importan (${preview.counts.invalid})`}
                    danger
                    items={preview.preview.invalid.map((r) => ({
                      key: String(r.index),
                      title: r.clientName ?? `Registro ${r.index + 1}`,
                      sub: [`Registro ${r.index + 1}`, r.code, rejectText(r.reason)].filter(Boolean).join(' · '),
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
        {preview && !preview.idempotentSkip && !blocked && !needsSelf && !isTest && (
          <Button label="Confirmar importación" onPress={() => void confirm()} loading={busy} />
        )}
        {isTest && preview && (
          <>
            <Text style={styles.hint}>
              Es una prueba: nada se importa. Si los números no cuadran, revisá el emparejado de columnas.
            </Text>
            {/* Sin esto la prueba terminaba en un callejón: los números cuadraban y no había cómo
                aplicarlos sin rehacer el camino desde el principio. Es la misma pantalla sin
                `test`, así que la Vista Previa se vuelve a leer antes de confirmar nada. */}
            {!preview.idempotentSkip && (
              <Button
                label="Importar de verdad"
                variant="ghost"
                onPress={() =>
                  router.replace({
                    pathname: '/import/preview',
                    params: { uri, name, mimeType: mimeType ?? '', test: '' },
                  })
                }
              />
            )}
          </>
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
