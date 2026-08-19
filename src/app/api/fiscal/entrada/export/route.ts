import { zipSync, strToU8 } from "fflate";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma } from "@/lib/permissoes";
import { db } from "@/lib/prisma";

/**
 * Todas as notas de entrada de um período, num ZIP — o pacote que o contador
 * pede todo mês. Baixar uma a uma para trinta notas é o tipo de trabalho que
 * faz o operador voltar a mandar print no WhatsApp.
 *
 * GET /api/fiscal/entrada/export?de=2026-08-01&ate=2026-08-31
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Teto por pacote: XML de NF-e tem ~10 KB, mas nota com 300 itens passa disso. */
const LIMITE_NOTAS = 500;

function dia(valor: string | null, fallback: Date): Date {
  const d = valor ? new Date(`${valor}T00:00:00`) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: Request) {
  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "fiscal.baixar")) {
    return new Response("Você não tem permissão para baixar documentos fiscais.", {
      status: 403,
    });
  }

  const url = new URL(req.url);
  const agora = new Date();
  const de = dia(url.searchParams.get("de"), new Date(agora.getFullYear(), agora.getMonth(), 1));
  const ate = dia(url.searchParams.get("ate"), agora);
  // Fim do dia: quem pede "até 31/08" quer as notas do dia 31 também.
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate(), 23, 59, 59, 999);

  const notas = await runWithTenant(ctx.tenant.id, () =>
    db.fiscalInbound.findMany({
      where: { dataEmissao: { gte: de, lte: fim } },
      orderBy: { dataEmissao: "asc" },
      take: LIMITE_NOTAS,
      select: {
        chave: true,
        emitRazaoSocial: true,
        xmlArquivo: { select: { conteudo: true } },
      },
    }),
  );

  const arquivos: Record<string, Uint8Array> = {};
  for (const n of notas) {
    if (!n.xmlArquivo) continue;
    arquivos[`${n.chave}.xml`] = strToU8(n.xmlArquivo.conteudo);
  }

  if (Object.keys(arquivos).length === 0) {
    return new Response("Nenhuma nota com XML guardado neste período.", { status: 404 });
  }

  // level 6: XML comprime muito bem e o pacote sai em poucos MB.
  const zip = zipSync(arquivos, { level: 6 });
  const nome = `notas-entrada-${de.toISOString().slice(0, 10)}_${ate
    .toISOString()
    .slice(0, 10)}.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
