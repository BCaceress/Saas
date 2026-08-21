import type { Metadata } from "next";
import { after } from "next/server";
import { ClipboardX, Clock, PackageSearch } from "lucide-react";
import { marcarLinkAberto, resolverLinkCotacao } from "@/lib/compras/cotacao-link";
import { RespostaFornecedor } from "./_form";

// ============================================================
// Tela do FORNECEDOR — a única do sistema com público de fora. Sem sessão, sem
// menu, sem shell: quem abre veio de um link no WhatsApp, quase sempre no
// celular, e tem um objetivo só (passar preço). Tudo aqui é desenhado para
// isso: uma coluna, campos grandes, teclado numérico, zero navegação.
// ============================================================

export const metadata: Metadata = {
  title: "Pedido de cotação",
  // Link de preço não deve virar resultado de busca.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Aviso({
  icone: Icone,
  titulo,
  texto,
}: {
  icone: typeof Clock;
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

export default async function CotacaoPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resultado = await resolverLinkCotacao(token);

  if (resultado.estado === "invalido") {
    return (
      <Aviso
        icone={PackageSearch}
        titulo="Link não encontrado"
        texto="Confira se o endereço veio completo da mensagem. Se continuar assim, peça um link novo a quem enviou a cotação."
      />
    );
  }

  if (resultado.estado === "expirado") {
    return (
      <Aviso
        icone={Clock}
        titulo="Prazo encerrado"
        texto={`A cotação ${resultado.numero} da ${resultado.empresa} não aceita mais respostas. Fale com o comprador para receber um link novo.`}
      />
    );
  }

  if (resultado.estado === "fechado") {
    return (
      <Aviso
        icone={ClipboardX}
        titulo={`Cotação ${resultado.numero}`}
        texto={`${resultado.motivo} Obrigado pela atenção — a ${resultado.empresa} avisa quando abrir a próxima.`}
      />
    );
  }

  // Só marca leitura depois de saber que o link é bom: link expirado ou de
  // cotação fechada não é "o fornecedor abriu", é uma porta que não abriu.
  // Fora do caminho crítico: é telemetria para o comprador, e quem abriu o
  // link no 3G do caminhão não deve esperar um UPDATE antes de ver a lista.
  after(() => marcarLinkAberto(token));

  return <RespostaFornecedor cotacao={resultado.cotacao} />;
}
