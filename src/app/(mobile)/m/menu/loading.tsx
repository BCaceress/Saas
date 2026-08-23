import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function MaisLoading() {
  return (
    <SkTela rotulo="Carregando o menu">
      <SkCabecalho />
      <SkLista itens={6} />
    </SkTela>
  );
}
