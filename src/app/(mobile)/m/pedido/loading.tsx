import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function PedidoLoading() {
  return (
    <SkTela rotulo="Carregando o pedido">
      <SkCabecalho />
      <SkLista itens={4} />
    </SkTela>
  );
}
