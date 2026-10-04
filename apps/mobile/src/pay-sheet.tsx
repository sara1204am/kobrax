/**
 * La hoja «Registrar pago» (§5.4). Vivía dentro de `cliente/[id].tsx`; se extrajo SIN cambiar su
 * comportamiento para que la ficha del deudor y la ficha de mora usen la misma hoja.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { choosePhoto } from '@/photo';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, BottomSheet, Chips, SectionLabel } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import type { PaymentChannel, PaymentMethod } from '@/payments.service';
import { uploadImage } from '@/uploads.service';
import { MiQrCobro } from '@/qr-cobro';

export const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'QR', label: 'QR' },
];
/** Quién recibió la plata (D3). El default es el caso de siempre: la cobró el cobrador. */
const CHANNELS: { value: PaymentChannel; label: string }[] = [
  { value: 'KOBRAX_COLLECTED', label: 'La cobré yo' },
  { value: 'EXTERNAL_CONFIRMED', label: 'Pagó en la entidad' },
];

/**
 * El comprobante del pago. Con señal se sube al sacarlo y quedan `url`+`hash`; sin señal queda
 * `local`, la ruta del archivo en el teléfono, y lo sube la cola junto con el cobro.
 */
export type Comprobante = { url?: string; hash?: string; local?: { uri: string; mimeType?: string } };

/** Hoja Registrar pago (§5.4). */
export function PaySheet({
  visible, onClose, currency, defaultAmount, maxAmount, external, onSubmit,
}: {
  visible: boolean; onClose: () => void; currency: string;
  /** Con qué arranca el monto. Ausente = vacío (no hay un monto sensato que proponer). */
  defaultAmount?: number;
  maxAmount: number;
  /** Operación PSF: el pago no cambia el saldo reportado, y se dice (D3). */
  external?: boolean;
  /** `receipt` viaja entero: con señal trae `url`+`hash`, sin señal la ruta local de la foto. */
  onSubmit: (amount: number, method: PaymentMethod, receipt: Comprobante | null, idemKey: string, channel: PaymentChannel) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [channel, setChannel] = useState<PaymentChannel>('KOBRAX_COLLECTED');
  const [receipt, setReceipt] = useState<Comprobante | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemRef = useRef<string>('');

  useEffect(() => {
    if (visible) {
      setAmount(defaultAmount !== undefined ? String(defaultAmount) : '');
      setMethod('CASH');
      setChannel('KOBRAX_COLLECTED');
      setReceipt(null);
      setError(null);
      idemRef.current = `pay-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
  }, [visible, defaultAmount]);

  const capture = useCallback(async () => {
    const pick = await choosePhoto();
    if (!pick) return;
    setUploading(true);
    const up = await uploadImage(pick.uri, pick.mimeType);
    setUploading(false);
    if (up.status === 'ok') return setReceipt({ url: up.url, hash: up.hash });
    // Sin señal la foto queda en el teléfono y viaja con el pago cuando haya red — mismo criterio
    // que el resultado de una parada. Antes, el mismo "comprobante" se perdía o no según por qué
    // pantalla hubiera entrado el cobrador.
    if (up.status === 'offline') return setReceipt({ local: { uri: pick.uri, mimeType: pick.mimeType } });
    setError('No se pudo subir el comprobante.');
  }, []);

  const num = Number(amount);
  const valid = num > 0 && num <= maxAmount + 0.005;

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    const err = await onSubmit(num, method, receipt, idemRef.current, channel);
    setSaving(false);
    if (err) setError(err);
  }, [num, method, receipt, channel, onSubmit]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Registrar pago">
      <ErrorBanner message={error} />
      <SectionLabel>Monto</SectionLabel>
      <AmountInput value={amount} onChangeText={setAmount} currencySymbol={currency} accessibilityLabel="Monto del pago" />
      {external && (
        <Text style={styles.sheetHint}>No cambia el saldo ni la mora del reporte: se actualizan con el próximo.</Text>
      )}
      <SectionLabel>Método</SectionLabel>
      <Chips options={METHODS} value={method} onChange={setMethod} />
      <SectionLabel>¿Quién recibió la plata?</SectionLabel>
      <Chips options={CHANNELS} value={channel} onChange={setChannel} />
      {method === 'QR' && <MiQrCobro />}
      <Pressable style={styles.receiptBtn} onPress={capture} disabled={uploading} accessibilityRole="button">
        <Text style={styles.receiptText}>{uploading ? 'Subiendo…' : receipt ? '📷 Comprobante listo' : '📷 Foto de comprobante'}</Text>
      </Pressable>
      <View style={{ marginTop: SPACING.md }}>
        <Button label="Confirmar pago" onPress={submit} loading={saving} disabled={saving || uploading || !valid} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetHint: { ...TYPE.secondary, color: COLORS.text2, marginBottom: SPACING.sm },
  receiptBtn: { marginTop: SPACING.md, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.periwinkle, backgroundColor: COLORS.highlight },
  receiptText: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
});
