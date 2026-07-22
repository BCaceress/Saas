import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma } from "@/lib/permissoes";
import { baixarArquivoFiscal } from "@/lib/fiscal/eventos";

/**
 * Download de XML/DANFE. Route handler em vez de link direto porque o arquivo
 * vem do provedor com credencial nossa — o token nunca pode chegar ao browser.
 *
 * GET /api/fiscal/documentos/<id>/xml
 * GET /api/fiscal/documentos/<id>/pdf
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; arquivo: string }> },
) {
  const { id, arquivo } = await params;

  if (arquivo !== "xml" && arquivo !== "pdf") {
    return new Response("Tipo de arquivo inválido.", { status: 400 });
  }

  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "fiscal.baixar")) {
    return new Response("Você não tem permissão para baixar documentos fiscais.", {
      status: 403,
    });
  }

  try {
    const r = await runWithTenant(ctx.tenant.id, () =>
      baixarArquivoFiscal({ tenantId: ctx.tenant.id, documentId: id, tipo: arquivo }),
    );

    return new Response(new Uint8Array(r.conteudo), {
      headers: {
        "Content-Type": r.contentType,
        "Content-Disposition": `attachment; filename="${r.nomeSugerido}"`,
        // Documento fiscal não é conteúdo público: nada de cache compartilhado.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao baixar o arquivo.";
    return new Response(msg, { status: 400 });
  }
}
