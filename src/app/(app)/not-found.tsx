import { NaoEncontrado } from "@/components/app/nao-encontrado";

export const metadata = { title: "Não encontrado — NoHub Market" };

/**
 * 404 de dentro do app — acionado pelo `notFound()` das telas (produto, pedido,
 * inventário que não existem no tenant). Renderiza dentro do shell: o menu
 * continua ali, então o registro sumido não vira beco sem saída.
 */
export default function AppNotFound() {
  return (
    <NaoEncontrado
      titulo="Não encontramos este registro"
      descricao="Ele pode ter sido excluído, ou o endereço aponta para outra loja da sua conta."
    />
  );
}
