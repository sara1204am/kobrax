import { useRef } from 'react';
import { StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { COLORS, RADIUS } from './theme';

/** Input OTP de 6 dígitos (44×52, mono, auto-avance). El valor lo controla el padre. */
export function OtpInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  const refs = useRef<(TextInput | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const setDigit = (i: number, d: string) => {
    const clean = d.replace(/\D/g, '').slice(-1);
    const next = digits.map((x, idx) => (idx === i ? clean : x)).join('');
    onChange(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
  };

  const onKey = (i: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  return (
    <View style={styles.row}>
      {digits.map((d, i) => (
        <TextInput
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          keyboardType="number-pad"
          maxLength={1}
          onChangeText={(t) => setDigit(i, t)}
          onKeyPress={(e) => onKey(i, e)}
          style={[styles.cell, error ? styles.cellError : d ? styles.cellFilled : styles.cellEmpty]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    width: 44,
    height: 52,
    borderRadius: RADIUS.input,
    borderWidth: 1.5,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  cellEmpty: { borderColor: COLORS.lightBg, backgroundColor: COLORS.white },
  cellFilled: { borderColor: COLORS.navy, backgroundColor: COLORS.bg },
  cellError: { borderColor: COLORS.danger, backgroundColor: COLORS.dangerBg },
});
