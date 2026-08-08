import { SkCabecalho, SkChips, SkLista, SkTela } from "@/components/mobile/esqueleto";

/**
 * O relatório roda o motor inteiro (carregar, filtrar, ordenar, totalizar), e
 * isso leva mais que um toque. A forma da tela pronta — cabeçalho, chips de
 * período, cartões — segura o lugar enquanto isso.
 */
export default function RelatorioLoading() {
  return (
    <SkTela rotulo="Gerando o relatório">
      <SkCabecalho />
      <SkChips count={5} />
      <SkLista itens={6} />
    </SkTela>
  );
}
