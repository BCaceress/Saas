import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma } from "@/lib/permissoes";
import { db } from "@/lib/prisma";

/**
 * XML da nota de ENTRADA (a que o fornecedor emitiu contra nós).
 *
 * O arquivo já está guardado inteiro em `FiscalInboundXml` desde a importação;
 * faltava um jeito de tirá-lo de lá. Quem pede é sempre o contador — e sem esta
 * rota o operador tem de voltar ao e-mail do fornecedor procurar o anexo.
 *
 * GET /api/fiscal/entrada/<inboundId>/xml
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "fiscal.baixar")) {
    return new Response("Você não tem permissão para baixar documentos fiscais.", {
      status: 403,
    });
  }

  const nota = await runWithTenant(ctx.tenant.id, () =>
    db.fiscalInbound.findFirst({
      where: { id },
      select: { chave: true, xmlArquivo: { select: { conteudo: true, nomeArquivo: true } } },
    }),
  );

  if (!nota?.xmlArquivo) {
    // Nota antiga, importada antes de o XML cru passar a ser guardado.
    return new Response("Esta nota não tem XML guardado.", { status: 404 });
  }

  return new Response(nota.xmlArquivo.conteudo, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nota.chave}.xml"`,
      "Cache-Control": "private, no-store",
    },
  });
}
