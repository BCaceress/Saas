import {
  SkBusca,
  SkCabecalho,
  SkChips,
  SkLista,
  SkTela,
} from "@/components/mobile/esqueleto";

/**
 * A lista de saldos é a tela mais pesada do `/m` (varre os estoques da loja e
 * soma o consumo de duas janelas), então é a que mais precisa responder ao
 * toque na hora. A forma é a real: busca, fila de chips e cartões com a linha
 * de ações — quando os dados chegam, nada se desloca.
 */
export default function EstoqueLoading() {
  return (
    <SkTela rotulo="Carregando o estoque">
      <SkCabecalho />
      <SkBusca />
      <SkChips count={4} />
      <SkLista itens={6} acoes />
    </SkTela>
  );
}
