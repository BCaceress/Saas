import { requirePermissaoMobile } from "@/lib/guard";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { EtiquetasClient } from "./_client";

/**
 * A fila de etiquetas deste aparelho.
 *
 * A lista mora no navegador (ver components/mobile/fila-etiquetas) — o servidor
 * só entra na hora de imprimir, e aí busca preço e SKU frescos. Por isso a
 * página é uma casca: não há o que carregar aqui.
 */
export default async function EtiquetasMobilePage() {
  await requirePermissaoMobile("produto.preco");

  return (
    <>
      <MobilePageHeader
        titulo="Etiquetas"
        descricao="O que você marcou para imprimir."
        voltar="/m/scan"
      />
      <EtiquetasClient />
    </>
  );
}
