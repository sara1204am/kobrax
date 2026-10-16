import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Header, ListRow, SectionLabel, StatusBadge } from '@/ui';
import { Button } from '@/components';
import { useNetStore } from '@/store/net';
import { getUserId } from '@/session';
import { hydrate, type HydrateResult, type HydrateStep } from '@/sync/hydrate';
import { lastDownloadAt, offlineInventory, stepDetail, whenDownloaded, type InventoryRow } from '@/offline-data';

/**
 * «Datos sin conexión»: bajar a mano todo lo que se necesita para trabajar en la calle y VER que se bajó.
 *
 * Hace lo mismo que la hidratación silenciosa del arranque (`sync/hydrate`), pero con el cobrador mirando:
 * qué va bajando, cuánto hay guardado y qué faltó. Se usa con wifi, antes de salir.
 */
export default function DatosSinConexionScreen() {
  const online = useNetStore((s) => s.isConnected);
  const [inventario, setInventario] = useState<InventoryRow[] | null>(null);
  const [ultima, setUltima] = useState<number | null>(null);
  const [bajando, setBajando] = useState(false);
  const [pasos, setPasos] = useState<HydrateStep[]>([]);
  const [resultado, setResultado] = useState<HydrateResult | null>(null);

  const cargar = useCallback(async () => {
    setInventario(await offlineInventory());
    setUltima(await lastDownloadAt());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  const descargar = useCallback(async () => {
    const userId = await getUserId();
    if (!userId) return;
    setBajando(true);
    setResultado(null);
    setPasos([]);
    const res = await hydrate(userId, {
      onProgress: (step) =>
        setPasos((prev) => {
          const i = prev.findIndex((p) => p.name === step.name);
          if (i === -1) return [...prev, step];
          const next = prev.slice();
          next[i] = step;
          return next;
        }),
    });
    setResultado(res);
    setBajando(false);
    await cargar();
  }, [cargar]);

  const completo = resultado !== null && resultado.failed.length === 0;
  const hayInventario = (inventario ?? []).some((r) => r.count > 0);

  return (
    <View style={styles.screen}>
      <Header title="Datos sin conexión" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.lista}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void cargar()} tintColor={COLORS.navy} />}
      >
        <Text style={styles.intro}>
          Baja con señal lo que vas a necesitar en la calle. Después puedes trabajar sin conexión: lo que registres se
          guarda en el teléfono y se sube solo cuando vuelva la red.
        </Text>

        {/* El veredicto va arriba: es lo único que el cobrador necesita antes de salir. */}
        {resultado && (
          <View style={[styles.veredicto, completo ? styles.veredictoOk : styles.veredictoMal]}>
            <Text style={styles.veredictoTitulo}>
              {completo ? 'Listo para trabajar sin conexión' : resultado.offline ? 'Se cortó la señal' : 'Faltaron algunos datos'}
            </Text>
            <Text style={styles.veredictoTexto}>
              {completo
                ? 'Todo se bajó. Ya puedes poner el teléfono en modo avión y trabajar.'
                : `No se pudo bajar: ${resultado.failed.join(', ')}. Con señal, vuelve a tocar «Descargar ahora»; lo que ya entró se conserva.`}
            </Text>
          </View>
        )}

        <ListRow
          title="Última descarga"
          subtitle={whenDownloaded(ultima)}
          right={
            ultima == null ? (
              <StatusBadge label="Sin datos" tone="danger" />
            ) : hayInventario ? (
              <StatusBadge label="Guardado" tone="success" />
            ) : undefined
          }
        />

        {(bajando || pasos.length > 0) && (
          <>
            <SectionLabel>{bajando ? 'DESCARGANDO…' : 'RESULTADO DE LA DESCARGA'}</SectionLabel>
            {pasos.map((p) => (
              <ListRow
                key={p.name}
                title={p.name}
                subtitle={stepDetail(p)}
                right={
                  p.state === 'running' ? (
                    <ActivityIndicator color={COLORS.navy} />
                  ) : p.state === 'ok' ? (
                    <StatusBadge label="Listo" tone="success" />
                  ) : (
                    <StatusBadge label={p.state === 'offline' ? 'Sin señal' : 'Falló'} tone="danger" />
                  )
                }
              />
            ))}
          </>
        )}

        <SectionLabel>LO QUE HAY EN EL TELÉFONO</SectionLabel>
        {inventario === null ? (
          <ActivityIndicator color={COLORS.navy} />
        ) : (
          inventario.map((r) => (
            <ListRow
              key={r.key}
              title={r.label}
              right={<Text style={[styles.cuenta, r.count === 0 && styles.cuentaCero]}>{r.count}</Text>}
            />
          ))
        )}
        <Text style={styles.nota}>
          Los datos guardados vencen a los 7 días. Si ves 0 en algo que necesitas, toca «Descargar ahora» con señal.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={online ? (bajando ? 'Descargando…' : 'Descargar ahora') : 'Sin conexión: conéctate para descargar'}
          onPress={() => void descargar()}
          loading={bajando}
          disabled={!online || bajando}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  lista: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl },
  intro: { ...TYPE.secondary },
  veredicto: { borderRadius: RADIUS.card, padding: SPACING.lg, gap: SPACING.xs, borderWidth: 1 },
  veredictoOk: { backgroundColor: COLORS.successBg, borderColor: COLORS.success },
  veredictoMal: { backgroundColor: COLORS.dangerBg, borderColor: COLORS.danger },
  veredictoTitulo: { ...TYPE.h3, color: COLORS.navy },
  veredictoTexto: { ...TYPE.secondary, color: COLORS.text },
  cuenta: { ...TYPE.h3, color: COLORS.navy },
  cuentaCero: { color: COLORS.danger },
  nota: { ...TYPE.secondary },
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
});
