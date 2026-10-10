import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from './theme';
import { appVersion } from './api';
import { useNetStore } from './store/net';
import { useUpgradeStore } from './store/upgrade';

const DEFAULT_MESSAGE = 'Esta versión de Kobrax ya no es compatible con el servidor. Actualizá la app para seguir trabajando.';

/**
 * Pantalla de «actualizá la app» (426). Cubre todo lo demás mientras el servidor diga que esta versión ya no sirve.
 *
 * Lo que tiene que decir con claridad, porque el cobrador está en la calle:
 *  · **su trabajo no se perdió**: lo pendiente queda guardado y sale solo cuando actualice;
 *  · qué versión tiene y cuántas acciones esperan;
 *  · «Ya actualicé / reintentar» vuelve a probar sin cerrar la app.
 */
export function UpgradeGate() {
  const required = useUpgradeStore((s) => s.required);
  const message = useUpgradeStore((s) => s.message);
  const clear = useUpgradeStore((s) => s.clear);
  const pending = useNetStore((s) => s.pendingCount);
  if (!required) return null;

  return (
    <View style={styles.cover} accessibilityViewIsModal accessibilityLabel="Actualización requerida">
      <Text style={styles.title}>Hay que actualizar Kobrax</Text>
      <Text style={styles.body}>{message ?? DEFAULT_MESSAGE}</Text>
      <View style={styles.box}>
        <Text style={styles.boxText}>
          {pending > 0
            ? `Tu trabajo está a salvo: ${pending} ${pending === 1 ? 'acción espera' : 'acciones esperan'} en el teléfono y saldrán solas apenas actualices.`
            : 'No tenés nada pendiente de enviar.'}
        </Text>
        <Text style={styles.version}>Versión instalada: {appVersion() ?? 'desconocida'}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={clear} style={styles.button}>
        <Text style={styles.buttonLabel}>Ya actualicé · reintentar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: COLORS.navy,
    padding: SPACING.xl,
    justifyContent: 'center',
  },
  title: { color: COLORS.white, fontSize: 26, fontWeight: '700', marginBottom: SPACING.md },
  body: { color: COLORS.white, fontSize: 16, lineHeight: 22, marginBottom: SPACING.lg },
  box: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.card, padding: SPACING.lg, marginBottom: SPACING.xl },
  boxText: { color: COLORS.white, fontSize: 16, lineHeight: 22 },
  version: { color: COLORS.white, opacity: 0.8, fontSize: 13, marginTop: SPACING.sm },
  button: { height: 52, borderRadius: RADIUS.button, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: COLORS.navy, fontSize: 16, fontWeight: '700' },
});
