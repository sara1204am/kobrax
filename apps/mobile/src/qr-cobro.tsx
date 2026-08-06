/**
 * "Mostrar mi QR" — el cobro por QR sin pasarela.
 *
 * No hay integración bancaria: el cobrador muestra la foto del QR de SU cuenta (la carga en Mi
 * perfil), el deudor paga desde la app de su banco y el cobro se registra a mano con método `QR`.
 * Es lo que ya se hace en la calle, y funciona desde el primer día.
 *
 * ponytail: `payment_requests` del backend (QR propio de Kobrax + link `pay.kobrax.demo`) queda
 * sin usar a propósito — genera un QR que ningún banco lee y su confirmación pide PAYMENT_APPROVE,
 * que el cobrador no tiene. Cuando haya pasarela real, ESTA es la pantalla que la consume.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';
import { getMyProfile } from './account.service';

type Estado = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; url: string | null } | { status: 'error' };

/**
 * Botón + visor. Se monta al lado del selector de método y sólo se ve cuando el método es QR:
 * mostrarlo siempre sería ruido en el 90% de los cobros, que son en efectivo.
 *
 * El perfil se pide al abrir y no al montar la hoja de pago — la mayoría de los pagos no pasan
 * por acá y no hay razón para gastarles una llamada.
 */
export function MiQrCobro() {
  const [visible, setVisible] = useState(false);
  const [estado, setEstado] = useState<Estado>({ status: 'idle' });

  const abrir = useCallback(async () => {
    setVisible(true);
    if (estado.status === 'ok') return; // ya cargado: no se vuelve a pedir
    setEstado({ status: 'loading' });
    const res = await getMyProfile();
    setEstado(res.status === 'ok' ? { status: 'ok', url: res.data.paymentQrUrl } : { status: 'error' });
  }, [estado.status]);

  return (
    <>
      <Pressable style={styles.boton} onPress={() => void abrir()} accessibilityRole="button">
        <Text style={styles.botonText}>⬛  Mostrar mi QR</Text>
      </Pressable>

      {/* Modal propio y no `BottomSheet`: el deudor tiene que escanear desde su teléfono, así que
          el QR va lo más grande y con la mayor luz posible, sin la hoja de pago detrás. */}
      <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={() => setVisible(false)}>
        <View style={styles.visor}>
          {estado.status === 'loading' && <ActivityIndicator color={COLORS.navy} />}

          {estado.status === 'error' && <Text style={styles.aviso}>No se pudo leer tu perfil. Reintentá.</Text>}

          {estado.status === 'ok' && estado.url && (
            <>
              <Text style={styles.titulo}>Escaneá para pagar</Text>
              <Image source={{ uri: estado.url }} style={styles.qr} resizeMode="contain" accessibilityLabel="Tu QR de cobro" />
              <Text style={styles.aviso}>
                Cuando el pago entre, registralo con el método QR. La app no lo detecta sola.
              </Text>
            </>
          )}

          {estado.status === 'ok' && !estado.url && (
            <>
              <Text style={styles.titulo}>Todavía no cargaste tu QR</Text>
              <Text style={styles.aviso}>Subí la foto del QR de tu cuenta en Mi perfil y lo tenés siempre a mano.</Text>
              <Pressable
                onPress={() => {
                  setVisible(false);
                  router.push('/cuenta/perfil');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.link}>Ir a Mi perfil</Text>
              </Pressable>
            </>
          )}

          <Pressable style={styles.cerrar} onPress={() => setVisible(false)} accessibilityRole="button">
            <Text style={styles.cerrarText}>Cerrar</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  boton: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.button,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  botonText: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  // Fondo blanco a propósito: el contraste es lo que hace que la cámara del otro teléfono enganche.
  visor: { flex: 1, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg, gap: SPACING.lg },
  titulo: { ...TYPE.h2, color: COLORS.navy, textAlign: 'center' },
  qr: { width: 280, height: 280 },
  aviso: { ...TYPE.secondary, textAlign: 'center' },
  link: { ...TYPE.body, color: COLORS.purple, fontWeight: '600' },
  cerrar: { position: 'absolute', bottom: SPACING.xl, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md },
  cerrarText: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
});
