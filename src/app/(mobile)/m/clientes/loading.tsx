import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function ClientesLoading() {
  return (
    <SkTela rotulo="Carregando os clientes">
      <SkCabecalho />
      <SkLista itens={7} />
    </SkTela>
  );
}
