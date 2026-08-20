import { SkCabecalho, SkChips, SkLista, SkTela } from "@/components/mobile/esqueleto";

/** Uma cotação: cabeçalho, passos (ou abas) e a lista do passo atual. */
export default function CotacaoLoading() {
  return (
    <SkTela rotulo="Carregando a cotação">
      <SkCabecalho />
      <SkChips count={3} />
      <SkLista itens={3} />
    </SkTela>
  );
}
