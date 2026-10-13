"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { onlyDigits } from "@/lib/normalize";
import { getImagemCosmosPorEan, CosmosError } from "@/lib/cosmos";

/**
 * Busca de imagem por código de barras para produto JÁ cadastrado — o que o
 * cadastro manual faz na hora do scan, aplicado depois (importação por CSV não
 * traz foto). Vai direto na CDN de fotos da Cosmos: aqui só interessa a imagem,
 * então a API (que cobra franquia por consulta) e o LLM ficam de fora.
 */

export type ImagemStatus =
  | "encontrada"
  | "sem_imagem"
  | "sem_ean"
  | "rate_limit"
  | "erro";

export type ImagemSugestao = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  /** URL da foto na Cosmos — `null` quando não veio nada. */
  imagemUrl: string | null;
  /** Produto já tinha imagem — a sugestão vem desmarcada para não sobrescrever. */
  jaTinha: boolean;
  status: ImagemStatus;
};

/** Teto por chamada: mantém a Server Action curta e dá progresso ao operador. */
const LOTE_BUSCA = 12;
/** Requisições simultâneas à Cosmos — a CDN é de terceiro, não adianta abrir 50. */
const CONCORRENCIA = 4;

/** Roda `fn` sobre a lista com no máximo `limite` chamadas simultâneas. */
async function emPool<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}

/**
 * Consulta a CDN da Cosmos para um lote de produtos e devolve a sugestão de imagem —
 * sem gravar nada. Quem decide o que entra é o operador, na revisão.
 */
export async function buscarImagens(ids: string[]): Promise<ImagemSugestao[]> {
  const ctx = await guardAction("produto.editar");

  return runWithTenant(ctx.tenant.id, async () => {
    const alvos = await db.product.findMany({
      where: { id: { in: ids.slice(0, LOTE_BUSCA) } },
      select: { id: true, nome: true, sku: true, ean: true, imagemUrl: true },
    });

    return emPool(alvos, CONCORRENCIA, async (p): Promise<ImagemSugestao> => {
      const base = {
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        ean: p.ean,
        jaTinha: !!p.imagemUrl,
        imagemUrl: null,
      };

      const ean = onlyDigits(p.ean ?? "");
      if (ean.length < 8) return { ...base, status: "sem_ean" };

      try {
        const imagemUrl = await getImagemCosmosPorEan(ean);
        return { ...base, imagemUrl, status: imagemUrl ? "encontrada" : "sem_imagem" };
      } catch (e) {
        const recusou = e instanceof CosmosError && e.code === "RATE_LIMIT";
        return { ...base, status: recusou ? "rate_limit" : "erro" };
      }
    });
  });
}

/** Grava as imagens aprovadas na revisão. Devolve quantos produtos mudaram. */
export async function aplicarImagens(
  itens: { id: string; imagemUrl: string }[],
): Promise<number> {
  const ctx = await guardAction("produto.editar");

  return runWithTenant(ctx.tenant.id, async () => {
    // A base às vezes devolve a URL sem protocolo ("//cdn…/foto.jpg"): descartar
    // por causa disso salvaria zero imagem sem explicar nada a ninguém.
    const validos = itens
      .map((i) => ({
        id: i.id,
        imagemUrl: i.imagemUrl?.trim().startsWith("//")
          ? `https:${i.imagemUrl.trim()}`
          : i.imagemUrl?.trim(),
      }))
      .filter((i) => i.id && /^https?:\/\//i.test(i.imagemUrl ?? ""));
    let gravados = 0;
    for (const i of validos) {
      // updateMany (e não update) porque o WHERE ganha o tenantId do extension —
      // id sozinho não prova que o produto é desta empresa.
      const r = await db.product.updateMany({
        where: { id: i.id },
        data: { imagemUrl: i.imagemUrl },
      });
      gravados += r.count;
    }
    revalidatePath("/produtos");
    return gravados;
  });
}
