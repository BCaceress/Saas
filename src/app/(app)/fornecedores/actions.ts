"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/crypto";
import { ingerir } from "@/lib/compras/ingest";

// ============================================================
// Escrita do Centro de Gestão do Fornecedor.
//
// Tudo que pertence a UM fornecedor — cadastro, integração, sincronização,
// condições comerciais, anotações — passa por aqui. Compras não configura
// fornecedor: lá só se decide o que comprar.
//
// Permissão: ver = `fornecedor.ver` (guard do layout); qualquer escrita =
// `fornecedor.editar`.
// ============================================================

async function tx<T>(
  permissao: Permissao,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

/** A ficha do fornecedor alimenta comparador, carrinho e sugestão de compra. */
function ok(supplierId?: string) {
  revalidatePath("/fornecedores", "layout");
  if (supplierId) revalidatePath(`/fornecedores/${supplierId}`, "layout");
  revalidatePath("/compras", "layout");
}

// ── Integração ──────────────────────────────────────────────

const AUTH_TIPOS = ["none", "bearer", "basic", "apikey"] as const;

const integracaoSchema = z.object({
  supplierId: z.string().min(1),
  possuiIntegracao: z.boolean().default(false),
  tipoIntegracao: z
    .enum(["API", "PLANILHA", "CSV", "PDF", "IMAGEM", "XML", "JSON", "MANUAL"])
    .nullable()
    .optional(),
  aceitaImportacaoManual: z.boolean().default(true),
  aceitaImportacaoAutomatica: z.boolean().default(false),
  endpoint: z.string().trim().url("Informe uma URL válida.").nullable().optional().or(z.literal("")),
  authTipo: z.enum(AUTH_TIPOS).nullable().optional(),
  /** Basic: parte pública, mostrada de volta na tela. */
  usuario: z.string().trim().max(120).nullable().optional(),
  /** Vazio = manter a credencial atual (a tela nunca recebe o valor em claro). */
  credencial: z.string().trim().optional(),
  /** Cabeçalhos extras — pares nome/valor digitados na tela. */
  headers: z.array(z.object({ nome: z.string().trim(), valor: z.string() })).optional(),
  frequenciaHoras: z.number().int().min(1).max(168).nullable().optional(),
});

type DadosIntegracao = z.infer<typeof integracaoSchema>;

/** Pares nome/valor → objeto. Linha sem nome é descartada. */
function headersObjeto(pares: DadosIntegracao["headers"]): Record<string, string> | null {
  if (!pares) return null;
  const mapa: Record<string, string> = {};
  for (const { nome, valor } of pares) {
    if (nome) mapa[nome] = valor;
  }
  return Object.keys(mapa).length > 0 ? mapa : null;
}

/**
 * Basic espera `base64(usuario:senha)` no Authorization — o conector só
 * concatena. Bearer/API key vão em claro para o cifrador.
 */
function credencialParaGuardar(d: DadosIntegracao): string | undefined {
  if (!d.credencial) return undefined;
  if (d.authTipo === "basic") {
    return Buffer.from(`${d.usuario ?? ""}:${d.credencial}`, "utf8").toString("base64");
  }
  return d.credencial;
}

export async function salvarIntegracaoAction(input: z.input<typeof integracaoSchema>) {
  const d = integracaoSchema.parse(input);

  await tx("fornecedor.editar", async (tid) => {
    const kind = d.tipoIntegracao ?? "MANUAL";
    const endpoint = d.endpoint && d.endpoint !== "" ? d.endpoint : null;

    await db.supplier.update({
      where: { id: d.supplierId },
      data: {
        possuiIntegracao: d.possuiIntegracao,
        tipoIntegracao: d.tipoIntegracao ?? null,
        aceitaImportacaoManual: d.aceitaImportacaoManual,
        aceitaImportacaoAutomatica: d.aceitaImportacaoAutomatica,
        situacaoIntegracao: d.possuiIntegracao
          ? kind === "API"
            ? endpoint
              ? "OFFLINE"
              : "NAO_CONFIGURADA"
            : "ONLINE"
          : "NAO_CONFIGURADA",
      },
    });

    const existente = await db.supplierIntegration.findFirst({
      where: { supplierId: d.supplierId },
      select: { id: true },
    });

    const segredo = credencialParaGuardar(d);
    const dados = {
      kind,
      ativo: d.possuiIntegracao,
      endpoint,
      authTipo: d.authTipo ?? null,
      usuario: d.usuario || null,
      headers: headersObjeto(d.headers) ?? undefined,
      frequenciaHoras: d.frequenciaHoras ?? null,
      proximaSync:
        d.aceitaImportacaoAutomatica && d.frequenciaHoras
          ? new Date(Date.now() + d.frequenciaHoras * 3600_000)
          : null,
      // Segredo só é reescrito quando a pessoa digita um novo.
      ...(segredo ? { credencial: cifrar(segredo) } : {}),
    };

    if (existente) {
      await db.supplierIntegration.update({ where: { id: existente.id }, data: dados });
    } else {
      await db.supplierIntegration.create({
        data: { ...dados, tenantId: tid, supplierId: d.supplierId },
      });
    }
  });

  ok(d.supplierId);
  return { ok: true as const };
}

/** Bate na API do fornecedor sem gravar nada — diagnóstico antes de sincronizar. */
export async function testarConexaoAction(supplierId: string) {
  return tx("fornecedor.editar", async () => {
    const integracao = await db.supplierIntegration.findFirst({
      where: { supplierId },
      select: { kind: true, endpoint: true, authTipo: true, credencial: true, headers: true },
    });

    if (!integracao || integracao.kind !== "API" || !integracao.endpoint) {
      return { ok: false as const, mensagem: "Configure o endereço da API e salve antes de testar." };
    }

    const cabecalhos: Record<string, string> = {
      Accept: "application/json",
      ...((integracao.headers as Record<string, string> | null) ?? {}),
    };
    const credencial = decifrar(integracao.credencial);
    if (credencial) {
      if (integracao.authTipo === "basic") cabecalhos.Authorization = `Basic ${credencial}`;
      else if (integracao.authTipo === "apikey") cabecalhos["X-API-Key"] = credencial;
      else cabecalhos.Authorization = `Bearer ${credencial}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const inicio = Date.now();
    try {
      const resposta = await fetch(integracao.endpoint, {
        headers: cabecalhos,
        signal: controller.signal,
        cache: "no-store",
      });
      const ms = Date.now() - inicio;

      if (!resposta.ok) {
        await db.supplier.update({
          where: { id: supplierId },
          data: { situacaoIntegracao: "ERRO" },
        });
        return {
          ok: false as const,
          mensagem: `O fornecedor respondeu ${resposta.status}. Confira endereço e credencial.`,
        };
      }

      // Contrato mínimo: precisa ser JSON — é o que o conector sabe ler.
      let itens: number | null = null;
      try {
        const corpo = await resposta.json();
        itens = Array.isArray(corpo)
          ? corpo.length
          : Array.isArray((corpo as { itens?: unknown[] })?.itens)
            ? (corpo as { itens: unknown[] }).itens.length
            : null;
      } catch {
        return { ok: false as const, mensagem: "A resposta chegou, mas não é JSON." };
      }

      await db.supplier.update({
        where: { id: supplierId },
        data: { situacaoIntegracao: "ONLINE" },
      });
      ok(supplierId);
      return {
        ok: true as const,
        mensagem:
          itens != null
            ? `Conexão certa em ${ms} ms — ${itens} itens na resposta.`
            : `Conexão certa em ${ms} ms.`,
      };
    } catch (e) {
      await db.supplier.update({ where: { id: supplierId }, data: { situacaoIntegracao: "ERRO" } });
      const motivo = e instanceof Error && e.name === "AbortError" ? "tempo esgotado" : "falha de conexão";
      return { ok: false as const, mensagem: `Não consegui falar com o fornecedor (${motivo}).` };
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Puxa a tabela agora pela API configurada. */
export async function sincronizarFornecedorAction(supplierId: string) {
  const resultado = await tx("fornecedor.editar", async (_tid, userId) => {
    const integracao = await db.supplierIntegration.findFirst({
      where: { supplierId },
      select: { kind: true, endpoint: true, authTipo: true, credencial: true, headers: true },
    });

    if (!integracao || integracao.kind !== "API" || !integracao.endpoint) {
      throw new Error("Este fornecedor não tem integração por API configurada.");
    }

    return ingerir({
      supplierId,
      kind: "API",
      origem: "api",
      userId,
      fonte: {
        tipo: "api",
        endpoint: integracao.endpoint,
        authTipo: integracao.authTipo,
        credencial: decifrar(integracao.credencial),
        headers: (integracao.headers as Record<string, string> | null) ?? null,
      },
    });
  });

  ok(supplierId);
  return resultado;
}

// ── Condições comerciais e anotações ────────────────────────

const observacoesSchema = z.object({
  supplierId: z.string().min(1),
  observacoes: z.string().trim().max(4000).nullable().optional(),
  prazoPagamentoDias: z.number().int().min(0).max(365).nullable().optional(),
});

export async function salvarObservacoesAction(input: z.input<typeof observacoesSchema>) {
  const d = observacoesSchema.parse(input);

  // `await` obrigatório: PrismaPromise é lazy e rodaria fora do runWithTenant.
  await tx("fornecedor.editar", async () => {
    await db.supplier.update({
      where: { id: d.supplierId },
      data: {
        observacoes: d.observacoes || null,
        prazoPagamentoDias: d.prazoPagamentoDias ?? null,
      },
    });
  });

  ok(d.supplierId);
  return { ok: true as const };
}
