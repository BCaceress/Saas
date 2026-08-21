"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { decidirSugestaoSync, type DecisaoSync } from "@/lib/fornecedores/decisoes-sync";
import { listarSugestoesPendentes } from "@/lib/fornecedores/sincronizacao-xml";
import { fornecedoresQueJaForneceram } from "@/lib/fornecedores/historico";

// ============================================================
// Decisões sobre o que o XML da NF-e sugeriu para o cadastro do fornecedor.
//
// Só o painel de sincronização e a ficha do fornecedor chamam isto. Aplicar
// uma sugestão MEXE NO CADASTRO — por isso pede `fornecedor.editar`, e não a
// permissão de importar nota.
// ============================================================

const decisaoSchema = z.object({
  id: z.string().min(1),
  decisao: z.enum(["ATUALIZAR", "CONTATO", "PRINCIPAL", "MANTER"]),
});

function ok(supplierId: string) {
  revalidatePath("/fornecedores", "layout");
  revalidatePath(`/fornecedores/${supplierId}`, "layout");
  revalidatePath("/fiscal/notas-recebidas");
}

/** Aplica (ou recusa) uma sugestão da sincronização. */
export async function decidirSugestaoAction(input: z.input<typeof decisaoSchema>) {
  const d = decisaoSchema.parse(input);
  const ctx = await guardAction("fornecedor.editar");

  const r = await runWithTenant(ctx.tenant.id, () =>
    decidirSugestaoSync({
      tenantId: ctx.tenant.id,
      id: d.id,
      decisao: d.decisao as DecisaoSync,
      userId: ctx.user.id,
    }),
  );

  ok(r.supplierId);
  return r;
}

/**
 * Resolve várias sugestões de uma vez — é o botão "Aplicar sugestões" do
 * painel. Uma decisão que falha não derruba as outras: o operador acabou de
 * dizer o que quer para cada linha, e perder tudo por causa de uma seria
 * atrito puro.
 */
export async function decidirSugestoesAction(
  entradas: z.input<typeof decisaoSchema>[],
): Promise<{ aplicadas: number; falhas: string[] }> {
  const lista = z.array(decisaoSchema).max(50).parse(entradas);
  const ctx = await guardAction("fornecedor.editar");

  const falhas: string[] = [];
  const tocados = new Set<string>();

  await runWithTenant(ctx.tenant.id, async () => {
    for (const d of lista) {
      try {
        const r = await decidirSugestaoSync({
          tenantId: ctx.tenant.id,
          id: d.id,
          decisao: d.decisao as DecisaoSync,
          userId: ctx.user.id,
        });
        tocados.add(r.supplierId);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : "Falha ao aplicar a sugestão.");
      }
    }
  });

  for (const id of tocados) ok(id);
  return { aplicadas: lista.length - falhas.length, falhas };
}

/** Sugestões que ainda esperam decisão neste fornecedor. */
export async function sugestoesPendentesAction(supplierId: string) {
  const ctx = await guardAction("fornecedor.ver");
  return runWithTenant(ctx.tenant.id, () => listarSugestoesPendentes(supplierId));
}

/**
 * Quem já vendeu este produto — com último preço e data. Serve à cotação:
 * escolher fornecedor pelo histórico em vez de por memória.
 */
export async function fornecedoresDoProdutoAction(input: {
  productId?: string | null;
  gtin?: string | null;
}) {
  const ctx = await guardAction("fornecedor.ver");
  return runWithTenant(ctx.tenant.id, () => fornecedoresQueJaForneceram(input));
}
