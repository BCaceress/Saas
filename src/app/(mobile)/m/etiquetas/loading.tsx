import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function EtiquetasLoading() {
  return (
    <SkTela rotulo="Carregando a fila">
      <SkCabecalho />
      <SkLista itens={4} />
    </SkTela>
  );
}
