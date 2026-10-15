import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { lerDataImagem } from "@/lib/imagem";

/**
 * Foto de produto guardada como `data:` na coluna, servida como arquivo.
 *
 * Existe para a foto sair do payload das listagens (ver `urlImagemProduto`):
 * a linha chega só com este caminho e o navegador busca a imagem depois, em
 * paralelo e com cache.
 *
 * Basta ser membro ativo do tenant — a foto aparece em produtos, estoque e PDV,
 * cada um com sua permissão, e não carrega nada além do que a prateleira mostra.
 * O isolamento entre tenants vem do `db`.
 *
 * GET /api/produtos/<id>/imagem?v=<versão>
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const produto = await runWithTenant(ctx.tenant.id, async () =>
    await db.product.findFirst({ where: { id }, select: { imagemUrl: true } }),
  );

  const imagem = produto?.imagemUrl ? lerDataImagem(produto.imagemUrl) : null;
  if (!imagem) return new Response("Imagem não encontrada.", { status: 404 });

  return new Response(new Uint8Array(Buffer.from(imagem.base64, "base64")), {
    headers: {
      "Content-Type": imagem.contentType,
      // `v` na URL muda a cada alteração do produto, então a resposta nunca
      // fica velha. `private`: é dado do tenant, não vai para cache compartilhado.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
