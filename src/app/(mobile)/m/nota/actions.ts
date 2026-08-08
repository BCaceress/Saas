"use server";

import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import { onlyDigits } from "@/lib/normalize";
import { resumoDaChave } from "@/lib/codigo-lido";
import {
  distribuicaoDisponivel,
  listarAguardandoManifestacao,
  manifestarNota,
  sincronizarDistribuicao,
} from "@/lib/fiscal/distribuicao";

// ============================================================
// Apontar a câmera para a DANFE e a nota entrar.
//
// Por que não OCR: a DANFE já imprime a chave de acesso num Code128 e a NFC-e
// num QR. Ler a chave e buscar o XML na SEFAZ devolve item, quantidade, custo,
// lote e validade EXATOS, assinados digitalmente. Reconhecer texto de um papel
// amassado devolve palpite — e palpite não vira custo médio.
//
// O caminho é o mesmo do desktop (`lib/fiscal/distribuicao`): manifestar libera
// o XML completo, e o XML completo passa pelo importador de sempre, que faz o
// de-para de itens e a entrada no estoque. Aqui não existe regra nova, só um
// atalho: em vez de procurar a nota numa lista, a pessoa aponta para ela.
// ============================================================

export type ResultadoNota =
  /** Já estava no sistema — a tela leva para a conferência dela. */
  | { tipo: "ja-importada"; inboundId: string; emitente: string; numero: number }
  /** Manifestada e importada agora. */
  | { tipo: "importada"; inboundId: string | null; emitente: string; numero: number }
  /** Manifestada, mas a SEFAZ ainda não liberou o XML. */
  | { tipo: "aguardando"; mensagem: string; numero: number }
  | { tipo: "erro"; mensagem: string };

/**
 * Chave de 44 dígitos → nota conferível.
 *
 * `fiscal.importar` é a permissão: entrada de mercadoria por XML é recebimento,
 * e quem confere na porta é o estoquista (ver MATRIZ em lib/permissoes).
 */
export async function importarNotaPorChaveAction(chaveRaw: string): Promise<ResultadoNota> {
  const chave = onlyDigits(chaveRaw);
  if (chave.length !== 44) {
    return { tipo: "erro", mensagem: "Isso não parece a chave de uma nota fiscal." };
  }

  const ctx = await guardAction("fiscal.importar");
  const { numero } = resumoDaChave(chave);

  const siteId = await runWithTenant(
    ctx.tenant.id,
    async () => (await getActiveSiteId()) ?? (await getOrCreateDefaultSite(ctx.tenant.id)).id,
  );

  // Nota que já entrou não é reimportada — o de-para e a entrada de estoque
  // dela podem estar em andamento. A trava real é o unique de
  // `FiscalInbound.chave`; isto aqui é só para a tela dizer o que houve.
  const existente = await runWithTenant(ctx.tenant.id, () =>
    db.fiscalInbound.findFirst({
      where: { chave },
      select: { id: true, emitRazaoSocial: true, numero: true },
    }),
  );
  if (existente) {
    return {
      tipo: "ja-importada",
      inboundId: existente.id,
      emitente: existente.emitRazaoSocial,
      numero: existente.numero,
    };
  }

  if (!(await distribuicaoDisponivel(ctx.tenant.id, siteId))) {
    return {
      tipo: "erro",
      mensagem:
        "Buscar a nota na SEFAZ exige o módulo fiscal configurado com a Nuvem Fiscal. Enquanto isso, importe o XML pelo computador.",
    };
  }

  try {
    let alvo = await acharNaFila(ctx.tenant.id, siteId, chave);

    // Nota emitida há pouco pode ainda não ter sido puxada. Uma sincronização
    // e uma segunda olhada — não mais que isso: a consulta tem custo e limite
    // de frequência na SEFAZ.
    if (!alvo) {
      await sincronizarDistribuicao({ tenantId: ctx.tenant.id, siteId, userId: ctx.user.id ?? null });
      alvo = await acharNaFila(ctx.tenant.id, siteId, chave);
    }

    // Sumiu da fila depois do sync = veio completa e o próprio sync importou.
    if (!alvo) {
      const importada = await runWithTenant(ctx.tenant.id, () =>
        db.fiscalInbound.findFirst({
          where: { chave },
          select: { id: true, emitRazaoSocial: true, numero: true },
        }),
      );
      if (importada) {
        revalidatePath("/m", "layout");
        return {
          tipo: "importada",
          inboundId: importada.id,
          emitente: importada.emitRazaoSocial,
          numero: importada.numero,
        };
      }
      return {
        tipo: "erro",
        mensagem:
          "A SEFAZ ainda não distribuiu esta nota para o seu CNPJ. Costuma levar alguns minutos depois da emissão.",
      };
    }

    // CIENCIA e não CONFIRMACAO: confirmar a operação é irreversível e declara
    // que a mercadoria foi recebida — declaração que quem está com a caixa
    // fechada na mão ainda não pode fazer. Ciência libera o XML e basta.
    const r = await manifestarNota({
      tenantId: ctx.tenant.id,
      siteId,
      chave,
      tipo: "CIENCIA",
      userId: ctx.user.id ?? null,
    });

    if (!r.ok) return { tipo: "erro", mensagem: r.mensagem };

    revalidatePath("/m", "layout");
    revalidatePath("/fiscal", "layout");

    if (!r.importada) {
      return { tipo: "aguardando", mensagem: r.mensagem, numero: alvo.numero || numero };
    }

    const inbound = await runWithTenant(ctx.tenant.id, () =>
      db.fiscalInbound.findFirst({ where: { chave }, select: { id: true } }),
    );
    return {
      tipo: "importada",
      inboundId: inbound?.id ?? null,
      emitente: alvo.emitRazaoSocial,
      numero: alvo.numero || numero,
    };
  } catch (e) {
    return {
      tipo: "erro",
      mensagem: e instanceof Error ? e.message : "Não foi possível falar com a SEFAZ agora.",
    };
  }
}

async function acharNaFila(tenantId: string, siteId: string, chave: string) {
  const fila = await listarAguardandoManifestacao(tenantId, siteId);
  return fila.find((n) => n.chave === chave) ?? null;
}
