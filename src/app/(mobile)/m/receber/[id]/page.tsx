import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { db } from "@/lib/prisma";
import { loadPedidosAReceber } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { ReceberClient } from "./_client";

export default async function ReceberPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissaoMobile("compras.receber");

  const dados = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    // Não existe carregador de UM pedido: o desktop também lista e filtra, e a
    // consulta já é limitada a 100. Criar um loader novo só para o celular
    // duplicaria a hidratação (fornecedor, embalagem, operador).
    const pedido = (await loadPedidosAReceber(siteId)).find((p) => p.id === id);
    if (!pedido) return null;

    // Códigos de barras para o bipe casar com o item do pedido. Vêm à parte
    // porque `PedidoCompraItemView` não carrega EAN — inclusive o da
    // embalagem, que é o que costuma estar colado na caixa.
    const productIds = [...new Set(pedido.items.map((i) => i.productId))];
    const produtos = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        ean: true,
        packagings: { select: { ean: true } },
      },
    });

    const codigos: Record<string, string[]> = {};
    for (const p of produtos) {
      codigos[p.id] = [
        p.ean,
        ...p.packagings.map((e) => e.ean),
      ].filter((c): c is string => Boolean(c));
    }

    return { pedido, codigos };
  });

  if (!dados) notFound();

  return (
    <>
      <MobilePageHeader
        titulo={dados.pedido.supplierNome}
        descricao={
          <span className="font-mono text-xs">{dados.pedido.numero}</span>
        }
        voltar="/m/receber"
      />
      <ReceberClient pedido={dados.pedido} codigos={dados.codigos} />
    </>
  );
}
