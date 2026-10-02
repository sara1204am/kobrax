import { useTranslations } from 'next-intl';

/**
 * El resultado de una gestión en el historial: «Resultado: No lo encontró».
 *
 * 🔴 Un resultado que el diccionario no conoce **se muestra crudo**, no se esconde: el historial trae gestiones
 * de antes de que el resultado se validara (era texto libre) y de otras vías —las visitas del móvil, las agendadas
 * ejecutadas—, y esconderlas dejaría un renglón sin decir cómo terminó.
 */
export function ActivityResult({ result }: { result: string }) {
  const t = useTranslations('panel.cases.ficha.activity');
  const label = t.has(`results.${result}`) ? t(`results.${result}`) : result;
  return (
    <p className="mt-1 text-[13px] text-k-text-2">
      {t('resultLabel')}: <span className="font-medium text-k-text">{label}</span>
    </p>
  );
}
