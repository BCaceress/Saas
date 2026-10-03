import "server-only";
import { basePrisma, db } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { proximoNumeroDocumento } from "@/lib/numeracao";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { logErro } from "@/lib/log";
import { loadSugestoesReposicao } from "@/app/(app)/cotacoes/_data";
import { avisarCotacaoRecorrente } from "./cotacao-push";

// ============================================================
// Cotação recorrente — o job que monta a cotação da semana.
//
// Roda no dispatcher diário (7h). Para cada recorrência ativa cujo dia da
// semana é hoje, cria um RASCUNHO copiando lista e fornecedores do molde.
// Nunca envia: o comprador revisa e manda. Três travas:
//
//   · uma geração por dia (ultimaGeracaoEm, no fuso de São Paulo);
//   · não empilha: se a geração anterior ainda está em rascunho, pula — dez
//     rascunhos iguais esperando revisão não ajudam ninguém;
//   · no modo REPOSICAO, só entra o que a estratégia de estoque diz que falta.
//     Nada faltando = nada gerado (e isso não é erro).
// ============================================================

const FUSO = "America/Sao_Paulo";

/** "2026-09-16" e o dia da semana (0 = domingo), no fuso de SP. */
export function diaLocal(d: Date): { chave: string; semana: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const semana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v("weekday"));
  return { chave: `${v("year")}-${v("month")}-${v("day")}`, semana };
}

/**
 * Quantidade na embalagem do item a partir da necessidade em unidades base.
 * Arredonda para CIMA: faltar meia caixa é faltar uma caixa. Zero = não precisa.
 */
export function quantidadeDeReposicao(necessidadeBase: number, fatorItem: number): number {
  if (!(necessidadeBase > 0)) return 0;
  return Math.max(1, Math.ceil(necessidadeBase / Math.max(1, fatorItem)));
}

export type ResumoRecorrencia = { tenants: number; geradas: number; puladas: number };

export async function gerarCotacoesRecorrentesTodos(agora = new Date()): Promise<ResumoRecorrencia> {
  const hoje = diaLocal(agora);
  const resumo: ResumoRecorrencia = { tenants: 0, geradas: 0, puladas: 0 };

  const tenants = await basePrisma.tenant.findMany({
    where: { status: { in: ["TRIAL", "ACTIVE"] } },
  });

  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, async () => {
        const recorrencias = await db.quotationSchedule.findMany({
          where: { ativo: true, diasSemana: { has: hoje.semana } },
        });
        if (recorrencias.length === 0) return;
        resumo.tenants += 1;

        for (const r of recorrencias) {
          if (r.ultimaGeracaoEm && diaLocal(r.ultimaGeracaoEm).chave === hoje.chave) {
            resumo.puladas += 1;
            continue;
          }
          const pendurada = await db.quotation.findFirst({
            where: { recorrenciaId: r.id, status: "RASCUNHO" },
            select: { id: true },
          });
          if (pendurada) {
            resumo.puladas += 1;
            continue;
          }
          const gerada = await gerarUma(tenant, r, agora);
          await db.quotationSchedule.updateMany({
            where: { id: r.id },
            data: { ultimaGeracaoEm: agora },
          });
          if (gerada) {
            resumo.geradas += 1;
            await avisarCotacaoRecorrente(tenant.id, gerada);
          } else {
            resumo.puladas += 1;
          }
        }
      });
    } catch (e) {
      // Um tenant com problema não segura os outros.
      logErro("job.cotacao-recorrente", e, { tenantId: tenant.id });
    }
  }
  return resumo;
}

type Recorrencia = {
  id: string;
  siteId: string;
  quotationId: string;
  titulo: string;
  modoQuantidade: string;
  createdBy: string | null;
};

async function gerarUma(
  tenant: Parameters<typeof policyDoTenant>[0] & { id: string },
  r: Recorrencia,
  agora: Date,
): Promise<{ id: string; numero: string; titulo: string; siteId: string; itens: number } | null> {
  const molde = await db.quotation.findFirst({
    where: { id: r.quotationId },
    select: {
      observacao: true,
      pedeEscala: true,
      items: {
        orderBy: { ordem: "asc" },
        select: {
          productId: true,
          packagingId: true,
          descricao: true,
          quantidade: true,
          observacao: true,
          ordem: true,
        },
      },
      suppliers: { select: { supplierId: true, contactId: true } },
    },
  });
  if (!molde || molde.items.length === 0) return null;

  let itens = molde.items.map((i) => ({ ...i, quantidade: Number(i.quantidade) }));

  if (r.modoQuantidade === "REPOSICAO") {
    const sugestoes = await loadSugestoesReposicao(r.siteId, policyDoTenant(tenant));
    const falta = new Map(
      sugestoes.grupos.flatMap((g) => g.itens).map((s) => [s.productId, s.necessidadeBase]),
    );
    const packagingIds = [...new Set(itens.flatMap((i) => (i.packagingId ? [i.packagingId] : [])))];
    const fatores = new Map(
      (packagingIds.length
        ? await db.productPackaging.findMany({
            where: { id: { in: packagingIds } },
            select: { id: true, fatorConversao: true },
          })
        : []
      ).map((p) => [p.id, Number(p.fatorConversao) || 1]),
    );
    itens = itens.flatMap((i) => {
      // Item fora do catálogo não tem estoque para consultar: vai como no molde.
      if (!i.productId) return [i];
      const qtd = quantidadeDeReposicao(
        falta.get(i.productId) ?? 0,
        i.packagingId ? (fatores.get(i.packagingId) ?? 1) : 1,
      );
      return qtd > 0 ? [{ ...i, quantidade: qtd }] : [];
    });
    if (itens.length === 0) return null;
  }

  const numero = await proximoNumeroDocumento(tenant.id, "COT");
  const data = agora.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
  const titulo = `${r.titulo} — ${data}`;
  const nova = await db.quotation.create({
    data: {
      tenantId: tenant.id,
      siteId: r.siteId,
      numero,
      titulo,
      observacao: molde.observacao,
      pedeEscala: molde.pedeEscala,
      recorrenciaId: r.id,
      createdBy: r.createdBy,
    },
    select: { id: true },
  });
  await db.quotationItem.createMany({
    data: itens.map((i, ordem) => ({
      tenantId: tenant.id,
      quotationId: nova.id,
      productId: i.productId,
      packagingId: i.packagingId,
      descricao: i.descricao,
      quantidade: i.quantidade,
      observacao: i.observacao,
      ordem,
    })),
  });
  if (molde.suppliers.length > 0) {
    await db.quotationSupplier.createMany({
      data: molde.suppliers.map((s) => ({
        tenantId: tenant.id,
        quotationId: nova.id,
        supplierId: s.supplierId,
        // Reenvio abre na mesma pessoa da semana passada.
        contactId: s.contactId,
      })),
    });
  }
  return { id: nova.id, numero, titulo, siteId: r.siteId, itens: itens.length };
}
