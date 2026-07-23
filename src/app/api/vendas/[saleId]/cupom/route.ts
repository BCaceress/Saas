import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { can } from "@/lib/permissoes";
import { db } from "@/lib/prisma";
import { baixarArquivoFiscal } from "@/lib/fiscal/eventos";

/**
 * DANFCE (cupom) da NFC-e de uma venda, para imprimir no caixa.
 *
 * Gated por `venda.registrar` NA LOJA da venda — não por `fiscal.baixar`: quem
 * opera o PDV imprime o cupom da própria venda sem precisar da permissão do
 * contador. O PDF vem do provedor com credencial nossa, então passa pelo
 * servidor (o token nunca chega ao browser), e sai `inline` para o navegador
 * abrir o diálogo de impressão direto.
 *
 * GET /api/vendas/<saleId>/cupom
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ saleId: string }> },
) {
  const { saleId } = await params;
  const ctx = await requireActiveTenant();

  try {
    const { conteudo, contentType } = await runWithTenant(ctx.tenant.id, async () => {
      const sale = await db.sale.findFirst({
        where: { id: saleId },
        select: { siteId: true },
      });
      if (!sale) throw new Response("Venda não encontrada.", { status: 404 });
      if (!can(ctx.acessos, "venda.registrar", sale.siteId)) {
        throw new Response("Sem permissão para imprimir o cupom desta venda.", {
          status: 403,
        });
      }

      // NFC-e autorizada mais recente da venda. Sem ela não há cupom fiscal —
      // a nota pode estar pendente, em contingência ou ter sido rejeitada.
      const doc = await db.fiscalDocument.findFirst({
        where: { saleId, status: "AUTORIZADO" },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      if (!doc) {
        throw new Response("Esta venda ainda não tem NFC-e autorizada.", { status: 409 });
      }

      const arquivo = await baixarArquivoFiscal({
        tenantId: ctx.tenant.id,
        documentId: doc.id,
        tipo: "pdf",
      });
      return { conteudo: arquivo.conteudo, contentType: arquivo.contentType };
    });

    return new Response(new Uint8Array(conteudo), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Falha ao gerar o cupom.";
    return new Response(msg, { status: 400 });
  }
}
