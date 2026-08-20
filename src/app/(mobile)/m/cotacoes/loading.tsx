import { SkCabecalho, SkChips, SkLista, SkTela } from "@/components/mobile/esqueleto";

/** Lista de cotações — um cartão por cotação. */
export default function CotacoesLoading() {
  return (
    <SkTela rotulo="Carregando as cotações">
      <SkCabecalho />
      <SkChips />
      <SkLista itens={4} />
    </SkTela>
  );
}
