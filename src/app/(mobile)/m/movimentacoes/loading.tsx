import {
  SkBusca,
  SkCabecalho,
  SkChips,
  SkLista,
  SkTela,
} from "@/components/mobile/esqueleto";

/**
 * A forma é a real — busca, duas filas de chips (tipo e período) e a lista de
 * lançamentos — para nada se deslocar quando o extrato chega.
 */
export default function MovimentacoesLoading() {
  return (
    <SkTela rotulo="Carregando as movimentações">
      <SkCabecalho />
      <SkBusca />
      <SkChips count={5} />
      <SkChips count={4} />
      <SkLista itens={7} />
    </SkTela>
  );
}
