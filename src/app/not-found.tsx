import { NaoEncontrado } from "@/components/app/nao-encontrado";

export const metadata = { title: "Página não encontrada — NoHub Market" };

/**
 * 404 global — pega qualquer URL que não bate com rota, em qualquer host.
 * Fica fora do shell de propósito: a rota não existe, então não há tenant nem
 * menu a resolver. O link vai para "/" porque no subdomínio o proxy já
 * manda a raiz para /inicio, e no domínio raiz a landing é o destino certo.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas">
      <NaoEncontrado homeHref="/" homeLabel="Ir para a página inicial" />
    </main>
  );
}
