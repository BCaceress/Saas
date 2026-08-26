import "server-only";
import { db } from "@/lib/prisma";
import { cfopDeEntrada } from "./cfop";

// ============================================================
// Classificação fiscal que o XML entrega pronta.
//
// NCM e CEST vêm assinados digitalmente pelo fornecedor na nota. Pedir isso no
// cadastro de produto é cobrar do operador de mercadinho um dado que ele não
// tem — e que chega sozinho na primeira entrada.
//
// O que NÃO vem de graça: o perfil criado aqui nasce `precisaRevisao = true` e
// só vira verdade depois que o contador olha (CLAUDE.md / PRD §8.9). NCM certo
// não significa alíquota certa: a tributação depende do regime do TENANT, não
// do regime de quem vendeu.
// ============================================================

export type ClassificacaoDaNota = {
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  /** ICMS ST retido na linha — prova de que o produto é de substituição. */
  temSt: boolean;
};

/**
 * Perfil fiscal para a classificação que a nota declara — reaproveitando o que
 * já existe no tenant.
 *
 * Casa por (NCM, CEST): mesmo NCM com CEST diferente é outra regra de ST, e
 * juntar os dois num perfil só faria o produto errado sair com ST na emissão.
 * `null` quando a nota não classifica (sem NCM) — aí o produto continua
 * herdando o perfil da subcategoria, que é o comportamento de hoje.
 *
 * `rotulo` nomeia o perfil novo (normalmente a subcategoria do produto). O
 * sufixo "— revisar" é intencional e combina com o que o seed já faz: o nome
 * na tela precisa gritar que ninguém conferiu aquilo ainda.
 */
export async function resolverPerfilDaNota(input: {
  tenantId: string;
  classificacao: ClassificacaoDaNota;
  rotulo?: string | null;
}): Promise<{ id: string; ncm: string; criado: boolean } | null> {
  const ncm = (input.classificacao.ncm ?? "").replace(/\D/g, "");
  if (ncm.length < 8) return null;
  const cest = (input.classificacao.cest ?? "").replace(/\D/g, "") || null;

  const existente = await db.fiscalProfile.findFirst({
    where: { ncm, cest },
    select: { id: true, ncm: true },
  });
  if (existente) return { ...existente, criado: false };

  const base = (input.rotulo ?? "").trim() || `NCM ${ncm}`;
  const novo = await db.fiscalProfile.create({
    data: {
      tenantId: input.tenantId,
      nome: `${base} — revisar`,
      ncm,
      cest,
      // Só a entrada. O CFOP de saída é decisão nossa (venda no PDV, e-commerce,
      // transferência) e não sai da nota de compra de ninguém.
      cfopEntrada: cfopDeEntrada(input.classificacao.cfop),
      temSt: input.classificacao.temSt || cest !== null,
      precisaRevisao: true,
    },
    select: { id: true, ncm: true },
  });
  return { ...novo, criado: true };
}
