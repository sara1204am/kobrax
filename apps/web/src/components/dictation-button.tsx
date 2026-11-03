'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/** Lo mínimo de la Web Speech API que se usa: TypeScript no la trae en `lib.dom`. */
interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Español latinoamericano para el panel en español; el reconocedor necesita la variante, no solo `es`. */
const LANG: Record<string, string> = { es: 'es-419', en: 'en-US' };

/**
 * Micrófono para dictar en un campo de texto, sobre la Web Speech API del navegador.
 *
 * 🔴 **No hay audio en nuestro servidor**: el navegador reconoce y nos entrega solo texto. Pero en Chrome y Edge
 * el reconocimiento lo hace el servicio del fabricante del navegador — por eso el botón dice qué pasa con la voz
 * (`title`) y NO se dicta nada que no haya pedido el usuario con un clic.
 *
 * Donde el navegador no la trae (Firefox, p.ej.) el botón **no se dibuja**: la escritura a mano sigue igual.
 * Se decide después de montar, no al renderizar: el servidor no sabe qué navegador abre la página.
 *
 * Entrega solo el texto **final** de cada frase (`onText`); quien lo usa decide dónde insertarlo.
 */
export function DictationButton({
  onText,
  onError,
  disabled,
}: {
  onText: (text: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('common.dictation');
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  // Siempre la última versión de los callbacks: el reconocimiento vive más que un render.
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  useEffect(() => {
    setSupported(recognitionCtor() !== undefined);
    return () => rec.current?.stop();
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) return rec.current?.stop();
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = LANG[locale] ?? 'es-419';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res?.isFinal && res[0].transcript.trim()) cb.current.onText(res[0].transcript.trim());
      }
    };
    r.onerror = (e) => {
      // `no-speech` y `aborted` no son fallas: nadie habló, o se paró a mano.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') cb.current.onError?.(t('denied'));
      else if (e.error === 'network') cb.current.onError?.(t('network'));
      else if (e.error === 'audio-capture') cb.current.onError?.(t('noMic'));
      else if (e.error === 'language-not-supported') cb.current.onError?.(t('language'));
      else if (e.error !== 'no-speech' && e.error !== 'aborted') cb.current.onError?.(t('failed', { code: e.error }));
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
    };
    rec.current = r;
    setListening(true);
    r.start();
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={listening}
      title={t('privacy')}
      // No quitar el foco al campo: el texto dictado entra donde estaba el cursor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${
        listening
          ? 'border-k-danger bg-k-danger-bg text-k-danger'
          : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      {listening ? t('stop') : t('start')}
    </button>
  );
}
