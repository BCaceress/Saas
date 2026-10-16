import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma } from "@/lib/permissoes";
import { db } from "@/lib/prisma";

/**
 * Baixa o XML completo guardado pela Distribuição DF-e oficial.
 *
 * Resumos `resNFe` não são XML fiscal completo e só podem ser baixados depois
 * que a SEFAZ liberar o `procNFe` por manifestação.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;
  if (!/^\d{44}$/.test(chave)) return new Response("Chave de acesso inválida.", { status: 400 });

  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "fiscal.baixar")) {
    return new Response("Você não tem permissão para baixar documentos fiscais.", {
      status: 403,
    });
  }

  const documento = await runWithTenant(ctx.tenant.id, () =>
    db.fiscalDistribuicaoDocumento.findFirst({
      where: { chave },
      select: { xml: true },
    }),
  );

  if (!documento) return new Response("Documento não encontrado na Distribuição DF-e.", { status: 404 });
  if (!documento.xml) {
    return new Response(
      "A SEFAZ devolveu apenas o resumo. Manifeste a operação para liberar o XML completo.",
      { status: 409 },
    );
  }

  const ver = new URL(req.url).searchParams.has("ver");
  return new Response(documento.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `${ver ? "inline" : "attachment"}; filename="${chave}.xml"`,
      "Cache-Control": "private, no-store",
    },
  });
}
