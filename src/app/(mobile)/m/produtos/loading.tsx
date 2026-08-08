import { SkBusca, SkCabecalho, SkChips, SkLista, SkTela } from "@/components/mobile/esqueleto";

/** Mesma forma da tela pronta — busca, chips e cartões — para nada se deslocar. */
export default function ProdutosLoading() {
  return (
    <SkTela rotulo="Carregando os produtos">
      <SkCabecalho />
      <SkBusca />
      <SkChips count={4} />
      <SkLista itens={7} />
    </SkTela>
  );
}
