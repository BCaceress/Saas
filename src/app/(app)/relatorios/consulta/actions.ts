"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { codificarConsulta, consultaSchema, decodificarConsulta } from "@/lib/analises/schema";
import { listarSalvos } from "@/lib/analises/salvos";

/**
 * Relatórios salvos: guardar uma consulta com nome, renomear, compartilhar com
 * a equipe e excluir.
 *
 * Só o DONO mexe no que é dele. Relatório de sistema (`sistema = true`) não é
 * editável por ninguém pela tela — é o catálogo de fábrica, e mudá-lo mudaria
 * o relatório de todo mundo no tenant.
 */

type Resultado = { ok: true; id?: string } | { ok: false; erro: string };

const salvarSchema = z.object({
  nome: z.string().trim().min(2, "Dê um nome ao relatório.").max(80),
  descricao: z.string().trim().max(200).optional(),
  q: z.string().min(1),
  compartilhado: z.boolean().default(false),
});

export async function salvarConsultaAction(entrada: unknown): Promise<Resultado> {
  const parsed = salvarSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  // A consulta chega codificada da URL — revalida antes de gravar, para não
  // guardar um DSL que o motor não sabe executar.
  const consulta = decodificarConsulta(parsed.data.q);
  if (!consulta) return { ok: false, erro: "Consulta inválida. Refaça o relatório e salve de novo." };

  const ctx = await guardAction("relatorio.ver");
  // `async () => await`: PrismaPromise é lazy e rodaria fora do contexto.
  const criado = await runWithTenant(ctx.tenant.id, async () =>
    await db.savedReport.create({
      data: {
        tenantId: ctx.tenant.id,
        nome: parsed.data.nome,
        descricao: parsed.data.descricao || null,
        consulta: consultaSchema.parse(consulta),
        ownerUserId: ctx.user.id,
        compartilhado: parsed.data.compartilhado,
      },
      select: { id: true },
    }),
  );

  revalidatePath("/relatorios/lista");
  return { ok: true, id: criado.id };
}

const atualizarSchema = z.object({
  id: z.string().min(1),
  nome: z.string().trim().min(2, "Dê um nome ao relatório.").max(80).optional(),
  descricao: z.string().trim().max(200).nullable().optional(),
  compartilhado: z.boolean().optional(),
});

export async function atualizarSalvoAction(entrada: unknown): Promise<Resultado> {
  const parsed = atualizarSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const ctx = await guardAction("relatorio.ver");
  const { id, ...campos } = parsed.data;

  const alterados = await runWithTenant(ctx.tenant.id, async () =>
    await db.savedReport.updateMany({
      // O dono no WHERE é a autorização: `updateMany` do extension já filtra
      // por tenant, e isto garante que ninguém edite o relatório de outro.
      where: { id, ownerUserId: ctx.user.id, sistema: false },
      data: campos,
    }),
  );
  if (alterados.count === 0) return { ok: false, erro: "Esse relatório não é seu para alterar." };

  revalidatePath("/relatorios/lista");
  return { ok: true };
}

export type SalvoResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  /** Consulta codificada — o link direto para a tela de consulta. */
  q: string;
  meu: boolean;
  compartilhado: boolean;
};

/**
 * Relatórios salvos visíveis para quem chamou. Usado pela paleta de comandos.
 * É leitura: continua funcionando com a assinatura em atraso — o corte de
 * cobrança trava a escrita, não o acesso ao que já é do cliente.
 */
export async function listarSalvosAction(): Promise<SalvoResumo[]> {
  const ctx = await guardAction("relatorio.ver", null, { mesmoSuspenso: true });
  const salvos = await runWithTenant(ctx.tenant.id, () => listarSalvos(ctx.user.id));
  return salvos.map((s) => ({
    id: s.id,
    nome: s.nome,
    descricao: s.descricao,
    q: codificarConsulta(s.consulta),
    meu: s.meu,
    compartilhado: s.compartilhado,
  }));
}

export async function excluirSalvoAction(id: string): Promise<Resultado> {
  if (!id) return { ok: false, erro: "Relatório não informado." };

  const ctx = await guardAction("relatorio.ver");
  const apagados = await runWithTenant(
    ctx.tenant.id,
    async () =>
      await db.savedReport.deleteMany({ where: { id, ownerUserId: ctx.user.id, sistema: false } }),
  );
  if (apagados.count === 0) return { ok: false, erro: "Esse relatório não é seu para excluir." };

  revalidatePath("/relatorios/lista");
  return { ok: true };
}
