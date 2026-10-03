import type { Metadata } from "next";
import { after } from "next/server";
import { ClipboardX, PackageSearch } from "lucide-react";
import { marcarLinkPedidoAberto, resolverLinkPedido } from "@/lib/compras/pedido-link";
import { RespostaPedido } from "./_resposta";

// ============================================================
// Tela do FORNECEDOR para o pedido. Mesmo público da cotação: vendedor no
// celular, sem conta. Um objetivo: dizer "recebi e vou entregar" (com a data)
// ou "tem um problema".
// ============================================================

export const metadata: Metadata = {
  title: "Pedido de compra",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Aviso({
  icone: Icone,
  titulo,
  texto,
}: {
  icone: typeof PackageSearch;
  titulo: string;
  texto: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Icone className="size-7" aria-hidden />
      </span>
      <h1 className="font-display text-xl font-semibold text-ink">{titulo}</h1>
      <p className="text-sm leading-relaxed text-muted">{texto}</p>
    </main>
  );
}

export default async function PedidoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await resolverLinkPedido(token);

  if (r.estado === "invalido") {
    return (
      <Aviso
        icone={PackageSearch}
        titulo="Link não encontrado"
        texto="Confira se o endereço veio completo da mensagem. Se continuar assim, peça ao comprador que reenvie o pedido."
      />
    );
  }
  if (r.estado === "fechado") {
    return (
      <Aviso
        icone={ClipboardX}
        titulo={`Pedido ${r.numero}`}
        texto={`${r.motivo} Qualquer dúvida, fale direto com a ${r.empresa}.`}
      />
    );
  }

  after(() => marcarLinkPedidoAberto(token));
  return <RespostaPedido pedido={r.pedido} />;
}
