import "server-only";
import { db } from "@/lib/prisma";
import { enviarPushImediato } from "@/lib/alertas/push";

// ============================================================
// Push da cotação — o celular de quem compra toca na hora em que o fornecedor
// responde pelo link, e não na próxima rodada do cron.
//
// Roda FORA do caminho da resposta (`after`), dentro do tenant: o fornecedor
// não espera o aviso sair, e falha aqui nunca derruba a proposta gravada.
// ============================================================

/**
 * Avisa que uma proposta chegou (ou que alguém recusou). Quando era a última
 * que faltava, a mensagem muda de "chegou uma" para "pode decidir" — é outra
 * ação que se pede à pessoa.
 */
export async function avisarRespostaDaCotacao(
  tenantId: string,
  conviteId: string,
  tipo: "resposta" | "recusa",
): Promise<void> {
  const convite = await db.quotationSupplier.findFirst({
    where: { id: conviteId },
    select: {
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      quotation: {
        select: {
          id: true,
          numero: true,
          siteId: true,
          suppliers: { select: { status: true } },
        },
      },
    },
  });
  if (!convite) return;

  const q = convite.quotation;
  const nome = convite.supplier.nomeFantasia || convite.supplier.razaoSocial;
  const respondidos = q.suppliers.filter((s) => s.status === "RESPONDIDA").length;
  const pendentes = q.suppliers.filter(
    (s) => s.status === "PENDENTE" || s.status === "ENVIADA",
  ).length;
  const todos = pendentes === 0 && respondidos > 0;

  // Recusa só vale notificação quando fecha a rodada — "fulano não vai cotar"
  // no meio do dia é informação de sino, não de bolso.
  if (tipo === "recusa" && !todos) return;

  const mensagem = todos
    ? {
        titulo: `${q.numero}: todos responderam`,
        corpo:
          tipo === "recusa"
            ? `${nome} não vai cotar. ${respondidos} ${respondidos === 1 ? "proposta está pronta" : "propostas estão prontas"} para comparar.`
            : `${nome} foi o último. ${respondidos} ${respondidos === 1 ? "proposta" : "propostas"} para comparar.`,
      }
    : {
        titulo: `${q.numero}: proposta de ${nome}`,
        corpo: `${respondidos} ${respondidos === 1 ? "resposta" : "respostas"} até agora · ${pendentes} ${pendentes === 1 ? "fornecedor ainda não respondeu" : "fornecedores ainda não responderam"}.`,
      };

  await enviarPushImediato({
    tenantId,
    permissao: "compras.ver",
    siteId: q.siteId,
    mensagem: {
      ...mensagem,
      url: `/cotacoes/${q.id}`,
      // Mesma tag por cotação: a segunda proposta substitui a notificação da
      // primeira em vez de empilhar três avisos da mesma lista.
      tag: `cotacao:${q.id}`,
    },
    // Os mesmos ids que o sino emite (lib/alertas/computar) — o cron da
    // próxima hora reconhece a notícia e não a repete.
    alertaId: todos
      ? `cotacao-resposta:${q.id}`
      : `cotacao-nova-resposta:${q.id}:${respondidos}`,
  });
}

/** Avisa que a cotação recorrente do dia foi montada e espera revisão. */
export async function avisarCotacaoRecorrente(
  tenantId: string,
  cotacao: { id: string; numero: string; titulo: string; siteId: string; itens: number },
): Promise<void> {
  await enviarPushImediato({
    tenantId,
    permissao: "compras.pedir",
    siteId: cotacao.siteId,
    mensagem: {
      titulo: `${cotacao.titulo} pronta para revisar`,
      corpo: `${cotacao.numero} · ${cotacao.itens} ${cotacao.itens === 1 ? "item" : "itens"} — confira e envie aos fornecedores.`,
      url: `/cotacoes/${cotacao.id}`,
      tag: `cotacao:${cotacao.id}`,
    },
  });
}
