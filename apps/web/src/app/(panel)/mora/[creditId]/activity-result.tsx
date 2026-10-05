import { useTranslations } from 'next-intl';

/**
 * El resultado de una gestión en el historial: «Resultado: No lo encontró».
 *
 * 🔴 Un resultado que el diccionario no conoce **se muestra crudo**, no se esconde: el historial trae gestiones
 * de antes de que el resultado se validara (era texto libre) y de otras vías —las visitas del móvil, las agendadas
 * ejecutadas—, y esconderlas dejaría un renglón sin decir cómo terminó.
 */
export function ActivityResult({ result }: { result: string }) {
  const t = useTranslations('panel.mora.ficha.activity');
  const label = t.has(`results.${result}`) ? t(`results.${result}`) : result;
  return (
    <p className="mt-0.5 text-[12.5px]">
      <span className="text-k-periwinkle">{t('resultLabel')}:</span> <span className="text-k-text">{label}</span>
    </p>
  );
}
