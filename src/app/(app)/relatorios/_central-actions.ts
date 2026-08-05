"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { getRelatorio } from "@/lib/relatorios/catalogo";
import { alternarFavorito } from "@/lib/relatorios/favoritos";

/**
 * Ações da Central de Relatórios.
 *
 * Sobrou uma: favoritar. Executar e exportar moram em `_configurador/actions`,
 * junto de quem sabe resolver a definição do relatório.
 *
 * Ela checa a permissão DO RELATÓRIO, não só a de abrir a tela: sem isso, um
 * caixa poderia favoritar (e ver o nome de) um relatório financeiro só chamando
 * a action na mão.
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

    revalidatePath("/relatorios");
    return { ok: true, dados: { favorito } };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}
