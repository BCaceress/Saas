import { Sk } from "@/components/app/skeletons";
import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

/** Vendas abre com a faixa de números do dia e depois a lista de recentes. */
export default function VendasLoading() {
  return (
    <SkTela rotulo="Carregando as vendas">
      <SkCabecalho />
      <Sk className="h-24 w-full rounded-[var(--radius-lg)]" />
      <SkLista itens={6} />
    </SkTela>
  );
}
