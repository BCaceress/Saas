import { SkBusca, SkCabecalho, SkChips, SkLista, SkTela } from "@/components/mobile/esqueleto";

/** Mesma forma da tela pronta — busca, chips e cartões — para nada se deslocar. */
export default function FornecedoresLoading() {
  return (
    <SkTela rotulo="Carregando os fornecedores">
      <SkCabecalho />
      <SkBusca />
      <SkChips count={3} />
      <SkLista itens={6} />
    </SkTela>
  );
}
