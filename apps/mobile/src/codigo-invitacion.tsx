import { Share, Text, View } from 'react-native';
import { Button } from './components';
import { COLORS, SPACING } from './theme';

/**
 * El código de una invitación, listo para pasar (CUENTA S2-D9). Lo muestran las dos
 * pantallas que lo generan —invitar y reenviar desde el detalle— y son idénticas, así que
 * el bloque vive una sola vez.
 *
 * En la base sólo está el hash: esto es lo único que hay si el correo no llega, y por eso
 * el camino de salida es WhatsApp, que en campo es el canal real.
 */
export function CodigoInvitacion({ code }: { code: string }) {
  return (
    <>
      <View style={styles.box}>
        <Text style={styles.code} selectable>
          {code}
        </Text>
      </View>
      <Button
        label="Compartir por WhatsApp"
        onPress={() => void Share.share({ message: invitationMessage(code) })}
      />
    </>
  );
}

/** El guión y las mayúsculas los normaliza el servidor, así que el link va tal cual se lee. */
export function invitationMessage(code: string): string {
  return (
    `Te invité a Kobrax. Abrí este link desde tu teléfono: kobrax://invitacion?c=${code}\n\n` +
    `Si no abre, entrá a la app, tocá "Tengo una invitación" y escribí este código: ${code}`
  );
}

const styles = {
  box: {
    backgroundColor: COLORS.highlight,
    borderRadius: 12,
    paddingVertical: SPACING.lg,
    alignItems: 'center' as const,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 26,
    fontWeight: '700' as const,
    letterSpacing: 2,
    color: COLORS.navy,
  },
};
