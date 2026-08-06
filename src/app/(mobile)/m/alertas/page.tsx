import { MobilePageHeader } from "@/components/mobile/page-header";
import { AlertasClient } from "./_client";

/**
 * Tudo que precisa de você, num lugar só.
 *
 * A página não busca nada: a lista vem do `AlertsProvider` montado no layout
 * do `/m`, que já chamou `getAlerts()` uma vez. Buscar aqui de novo repetiria
 * as consultas pesadas do `_alerts.ts` e ainda ignoraria o que a pessoa já
 * marcou como resolvido neste aparelho.
 */
export default function AlertasPage() {
  return (
    <>
      <MobilePageHeader
        titulo="Alertas"
        descricao="Do mais grave para o menos urgente."
      />
      <AlertasClient />
    </>
  );
}
