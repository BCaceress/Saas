import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function AprovacoesLoading() {
  return (
    <SkTela rotulo="Carregando as aprovações">
      <SkCabecalho />
      <SkLista itens={4} />
    </SkTela>
  );
}
