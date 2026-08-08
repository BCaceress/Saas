import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function AlertasLoading() {
  return (
    <SkTela rotulo="Carregando os alertas">
      <SkCabecalho />
      <SkLista itens={5} />
    </SkTela>
  );
}
