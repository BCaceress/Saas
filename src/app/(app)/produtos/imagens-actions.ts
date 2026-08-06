"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { onlyDigits } from "@/lib/normalize";
import { getCosmosByEan, CosmosError } from "@/lib/cosmos";

/**
 * Busca de imagem por código de barras para produto JÁ cadastrado — o que o
 * cadastro manual faz na hora do scan, aplicado depois (importação por CSV não
 * traz foto). Só a Cosmos: aqui não há o que normalizar, então o LLM fica fora
 * (mais rápido e sem custo por linha).
 */

export type ImagemStatus =
  | "encontrada"
  | "sem_imagem"
  | "nao_encontrado"
  | "sem_ean"
  | "rate_limit"
  | "sem_token"
  | "erro";

export type ImagemSugestao = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  /** URL da foto na Cosmos — `null` quando não veio nada. */
  imagemUrl: string | null;
  /** Descrição da Cosmos: confere se o EAN é mesmo desse produto. */
  descricaoCosmos: string | null;
  /** Produto já tinha imagem — a sugestão vem desmarcada para não sobrescrever. */
  jaTinha: boolean;
  status: ImagemStatus;
};

/** Teto por chamada: mantém a Server Action curta e dá progresso ao operador. */
const LOTE_BUSCA = 12;
/** Requisições simultâneas à Cosmos — cota é finita, não adianta abrir 50. */
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
 * Consulta a Cosmos para um lote de produtos e devolve a sugestão de imagem —
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
        descricaoCosmos: null,
      };

      const ean = onlyDigits(p.ean ?? "");
      if (ean.length < 8) return { ...base, status: "sem_ean" };

      try {
        const cosmos = await getCosmosByEan(ean);
        return {
          ...base,
          imagemUrl: cosmos.thumbnail,
          descricaoCosmos: cosmos.descricao,
          status: cosmos.thumbnail ? "encontrada" : "sem_imagem",
        };
      } catch (e) {
        if (e instanceof CosmosError) {
          const status: ImagemStatus =
            e.code === "NOT_FOUND"
              ? "nao_encontrado"
              : e.code === "RATE_LIMIT"
                ? "rate_limit"
                : e.code === "NO_TOKEN"
                  ? "sem_token"
                  : "erro";
          return { ...base, status };
        }
        return { ...base, status: "erro" };
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
