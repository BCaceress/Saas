import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

/** Pedidos esperando conferência — um cartão por pedido. */
export default function ReceberLoading() {
  return (
    <SkTela rotulo="Carregando os pedidos">
      <SkCabecalho />
      <SkLista itens={4} />
    </SkTela>
  );
}
