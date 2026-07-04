'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * Input OTP de 6 dígitos (mono 20/600, auto-avance). El valor se mantiene en el
 * padre; aquí solo se gestiona el foco/teclado. `error` aplica el estado visual.
 */
export function OtpInput({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const setDigit = (i: number, d: string) => {
    const clean = d.replace(/\D/g, '').slice(-1);
    const next = digits.map((x, idx) => (idx === i ? clean : x)).join('');
    onChange(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      onChange(pasted);
      refs.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  return (
    <div className="flex justify-between gap-2" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          maxLength={1}
          autoFocus={autoFocus && i === 0}
          aria-label={`Dígito ${i + 1}`}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          className={`h-[52px] w-11 rounded-[8px] border-[1.5px] text-center font-mono text-[20px] font-semibold text-k-text outline-none transition-all ${
            error
              ? 'border-k-danger bg-k-danger-bg'
              : d
                ? 'border-k-navy bg-k-bg'
                : 'border-k-light-bg bg-white focus:border-k-periwinkle focus:shadow-k-focus'
          }`}
        />
      ))}
    </div>
  );
}
