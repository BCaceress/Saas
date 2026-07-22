"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import {
  cancelarDocumento,
  emitirCartaCorrecao,
  inutilizarFaixa,
  type ResultadoEventoFiscal,
} from "@/lib/fiscal/eventos";
import { transmitirDocumento, statusFiscalDaVenda } from "@/lib/fiscal/emissao";
import type { Permissao } from "@/lib/permissoes";

const ROTA = "/fiscal/notas-emitidas";
const ok = () => {
  revalidatePath(ROTA);
  revalidatePath("/fiscal/eventos");
};

async function tx<T>(
  permissao: Permissao,
  fn: (tenantId: string, userId: string | null) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? null));
}

const cancelarSchema = z.object({
  documentId: z.string().min(1),
  justificativa: z.string().trim().min(15, "A justificativa precisa de pelo menos 15 caracteres."),
});

export async function cancelarNotaAction(
  input: z.input<typeof cancelarSchema>,
): Promise<ResultadoEventoFiscal> {
  return tx("fiscal.cancelar", async (tenantId, userId) => {
    const d = cancelarSchema.parse(input);
    const r = await cancelarDocumento({ tenantId, userId, ...d });
    ok();
    return r;
  });
}

const cceSchema = z.object({
  documentId: z.string().min(1),
  correcao: z.string().trim().min(15, "A correção precisa de pelo menos 15 caracteres."),
});

export async function cartaCorrecaoAction(
  input: z.input<typeof cceSchema>,
): Promise<ResultadoEventoFiscal> {
  return tx("fiscal.corrigir", async (tenantId, userId) => {
    const d = cceSchema.parse(input);
    const r = await emitirCartaCorrecao({ tenantId, userId, ...d });
    ok();
    return r;
  });
}

const inutilizarSchema = z.object({
  siteId: z.string().min(1, "Escolha a loja."),
  modelo: z.enum(["NFCE", "NFE"]),
  serie: z.coerce.number().int().min(1),
  numeroInicial: z.coerce.number().int().min(1),
  numeroFinal: z.coerce.number().int().min(1),
  justificativa: z.string().trim().min(15, "A justificativa precisa de pelo menos 15 caracteres."),
});

export async function inutilizarFaixaAction(
  input: z.input<typeof inutilizarSchema>,
): Promise<ResultadoEventoFiscal> {
  return tx("fiscal.corrigir", async (tenantId, userId) => {
    const d = inutilizarSchema.parse(input);
    const r = await inutilizarFaixa({ tenantId, userId, ...d });
    ok();
    return r;
  });
}

/** Reempurra um documento parado (PENDENTE/CONTINGENCIA) para a SEFAZ. */
export async function reenviarDocumentoAction(documentId: string) {
  return tx("fiscal.emitir", async (tenantId) => {
    const status = await transmitirDocumento(tenantId, documentId);
    ok();
    return status;
  });
}

/** Consulta o desfecho de uma nota específica (usada no polling da lista). */
export async function statusDaVendaAction(saleId: string) {
  return tx("fiscal.ver", (tenantId) => statusFiscalDaVenda(tenantId, saleId));
}
