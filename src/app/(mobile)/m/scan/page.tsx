import { requirePermissaoMobile } from "@/lib/guard";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { acaoDaUrl, DICA_ACAO, TITULO_ACAO } from "@/components/mobile/acao-url";
import { ScanClient } from "./_client";

/**
 * Consulta por código de barras. Guard aqui e não num layout porque `/m/scan`
 * é a única tela da superfície que exige `produto.ver` — a mesma permissão que
 * a action confere do outro lado, para quem chega pela URL não entrar de lado.
 *
 * `?acao=` é o bipe COM intenção: a folha "Nova operação" manda perda e
 * transferência para cá porque as duas precisam de um produto, e o produto vem
 * da câmera. Sem isso, os dois verbos despejavam a pessoa na lista de estoque —
 * um menu que promete ação e entrega lista.
 */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ acao?: string }>;
}) {
  await requirePermissaoMobile("produto.ver");

  const { acao } = await searchParams;
  const inicial = acaoDaUrl(acao);

  return (
    <>
      <MobilePageHeader
        titulo={inicial ? TITULO_ACAO[inicial] : "Escanear"}
        descricao={inicial ? DICA_ACAO[inicial] : "Preço, saldo e validade na hora."}
      />
      <ScanClient acaoInicial={inicial} />
    </>
  );
}
