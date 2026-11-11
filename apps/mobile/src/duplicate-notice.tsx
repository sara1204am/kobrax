import { StyleSheet, Text, View } from 'react-native';
import type { ClientDuplicateCheck, ClientDuplicateMatch } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Button } from '@/components';

/**
 * Aviso de posible duplicado al dar de alta (paridad con el panel web). El documento repetido BLOQUEA;
 * los homónimos piden confirmar «es otra persona». `local` = contestó el teléfono sin señal.
 */
export function DuplicateNotice({
  check,
  local,
  accepted,
  onAccept,
  onCreateMine,
}: {
  check: ClientDuplicateCheck | null;
  local: boolean;
  accepted: boolean;
  onAccept: () => void;
  /**
   * F14 · F8 (D-8 b): el documento ya está registrado pero la persona no ve a ese cliente (lo llevan otras). Con permiso de crear créditos, la pantalla pasa
   * esto y se ofrece «Crear mi préstamo sobre este cliente». Sin él (o sin señal) solo se explica.
   */
  onCreateMine?: (match: ClientDuplicateMatch) => void;
}) {
  if (!check || (!check.document && check.names.length === 0)) return null;
  const doc = check.document;
  return (
    <View accessibilityRole="alert" style={[styles.box, doc ? styles.danger : styles.warn]}>
      {doc?.hidden ? (
        <>
          <Text style={styles.title}>Este cliente ya existe y lo llevan otras personas</Text>
          <Text style={styles.line}>{`${doc.displayName}${doc.maskedDocument ? ` · ${doc.maskedDocument}` : ''}`}</Text>
          <Text style={styles.hint}>Todavía no está en tu cartera. Puedes crear tu propio préstamo sobre él y desde ahí lo verás.</Text>
          {onCreateMine && !local && <Button label="Crear mi préstamo sobre este cliente" onPress={() => onCreateMine(doc)} />}
        </>
      ) : doc ? (
        <>
          <Text style={styles.title}>Ya existe un cliente con ese documento</Text>
          <Text style={styles.line}>
            {`${doc.displayName}${doc.maskedDocument ? ` · ${doc.maskedDocument}` : ''} · ${doc.creditCount} préstamo(s)${doc.deleted ? ' · dado de baja' : ''}`}
          </Text>
          <Text style={styles.hint}>No se puede crear otro con el mismo documento. Búscalo en la cartera.</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>Ya hay alguien con ese nombre</Text>
          {check.names.slice(0, 3).map((m) => (
            <Text key={m.id} style={styles.line}>
              {`${m.displayName}${m.maskedDocument ? ` · ${m.maskedDocument}` : m.otherDocument ? ' · con otro documento' : ''} · ${m.creditCount} préstamo(s)`}
            </Text>
          ))}
          {check.names.length > 3 && <Text style={styles.hint}>{`y ${check.names.length - 3} más`}</Text>}
          {accepted ? (
            <Text style={styles.hint}>Confirmaste que es otra persona.</Text>
          ) : (
            <Button label="Es otra persona, continuar" variant="ghost" onPress={onAccept} />
          )}
        </>
      )}
      {local && <Text style={styles.hint}>Sin señal: se revisó con lo guardado en el teléfono. El servidor lo vuelve a revisar al subir.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: RADIUS.input, padding: SPACING.md, gap: SPACING.xs, borderWidth: 1 },
  danger: { backgroundColor: COLORS.dangerBg, borderColor: COLORS.danger },
  warn: { backgroundColor: COLORS.warningBg, borderColor: COLORS.warning },
  title: { ...TYPE.body, fontWeight: '600' },
  line: TYPE.body,
  hint: TYPE.secondary,
});
