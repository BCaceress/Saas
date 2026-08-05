"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { getRelatorio, parametrosSchema } from "@/lib/relatorios/catalogo";
import { alternarFavorito } from "@/lib/relatorios/favoritos";
import { registrarExecucao } from "@/lib/relatorios/historico";

/**
 * Ações da Central de Relatórios.
 *
 * As duas checam a permissão DO RELATÓRIO, não só a de abrir a tela: sem isso,
 * um caixa poderia favoritar (e ver o nome de) um relatório financeiro só
 * chamando a action na mão.
 */

type Resultado<T = undefined> = { ok: true; dados?: T } | { ok: false; erro: string };

const idSchema = z.string().trim().min(1).max(60);

export async function alternarFavoritoAction(
  relatorioId: unknown,
): Promise<Resultado<{ favorito: boolean }>> {
  const parsed = idSchema.safeParse(relatorioId);
  if (!parsed.success) return { ok: false, erro: "Relatório não informado." };

  const rel = getRelatorio(parsed.data);
  if (!rel) return { ok: false, erro: "Esse relatório não existe mais." };

  try {
    const ctx = await guardAction("relatorio.ver");
    if (!podeEmAlguma(ctx.acessos, rel.permissao)) throw new SemPermissaoError();

    const favorito = await runWithTenant(ctx.tenant.id, () =>
      alternarFavorito(ctx.tenant.id, ctx.user.id, rel.id),
    );

    revalidatePath("/relatorios/central");
    return { ok: true, dados: { favorito } };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

const execucaoSchema = z.object({
  relatorioId: idSchema,
  parametros: parametrosSchema,
  formato: z.enum(["tela", "csv", "xlsx", "pdf", "impressao"]).default("tela"),
});

/**
 * Marca que o relatório foi rodado. É o que alimenta "última execução",
 * "mais utilizados" e o histórico.
 *
 * Roda mesmo com a assinatura suspensa (`mesmoSuspenso`): o corte de cobrança
 * trava operação nova, não a leitura do que já é do cliente — e engasgar o log
 * derrubaria a consulta junto.
 */
export async function registrarExecucaoAction(entrada: unknown): Promise<Resultado> {
  const parsed = execucaoSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: "Parâmetros inválidos." };

  const rel = getRelatorio(parsed.data.relatorioId);
  if (!rel) return { ok: false, erro: "Esse relatório não existe mais." };
  if (rel.destino.tipo === "indisponivel") {
    return { ok: false, erro: "Esse relatório ainda não está disponível." };
  }

  try {
    const ctx = await guardAction("relatorio.ver", null, { mesmoSuspenso: true });
    if (!podeEmAlguma(ctx.acessos, rel.permissao)) throw new SemPermissaoError();
    if (parsed.data.formato !== "tela" && !podeEmAlguma(ctx.acessos, "relatorio.exportar")) {
      throw new SemPermissaoError("Você não tem permissão para exportar relatórios.");
    }

    await runWithTenant(ctx.tenant.id, () =>
      registrarExecucao({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: rel.id,
        parametros: parsed.data.parametros,
        formato: parsed.data.formato,
      }),
    );

    // Sem revalidatePath: a navegação para o relatório já refaz a Central na
    // volta, e revalidar aqui atrasaria o clique que o operador acabou de dar.
    return { ok: true };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}
