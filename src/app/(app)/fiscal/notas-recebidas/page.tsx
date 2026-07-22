import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { podeEmAlguma } from "@/lib/permissoes";
import { NotasRecebidasClient } from "./_client";

export const metadata = { title: "Notas recebidas — NoHub Market" };

export default async function NotasRecebidasPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const notas = await db.fiscalInbound.findMany({
      orderBy: [{ dataEmissao: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        chave: true,
        numero: true,
        serie: true,
        dataEmissao: true,
        valorTotal: true,
        emitCnpj: true,
        emitRazaoSocial: true,
        emitUf: true,
        supplierId: true,
        purchaseOrderId: true,
        purchaseId: true,
        observacao: true,
        purchaseOrder: { select: { numero: true } },
        items: {
          orderBy: { ordem: "asc" },
          select: {
            id: true,
            ordem: true,
            codigoFornecedor: true,
            gtin: true,
            descricao: true,
            ncm: true,
            cfop: true,
            unidade: true,
            quantidade: true,
            valorUnitario: true,
            valorTotal: true,
            valorDesconto: true,
            valorIcmsSt: true,
            valorIpi: true,
            valorFrete: true,
            bonificacao: true,
            productId: true,
            packagingId: true,
            fatorConversao: true,
          },
        },
      },
    });

    // productId é escalar (alto volume, igual a StockMovement) — o nome do
    // produto vem numa consulta só, em vez de um include por item.
    const idsProdutos = [
      ...new Set(notas.flatMap((n) => n.items.map((i) => i.productId).filter(Boolean))),
    ] as string[];
    const produtos = idsProdutos.length
      ? await db.product.findMany({
          where: { id: { in: idsProdutos } },
          select: { id: true, nome: true, sku: true },
        })
      : [];
    const porProduto = new Map(produtos.map((p) => [p.id, p]));

    return (
      <NotasRecebidasClient
        podeImportar={podeEmAlguma(ctx.acessos, "fiscal.importar")}
        notas={notas.map((n) => ({
          id: n.id,
          status: n.status,
          chave: n.chave,
          numero: n.numero,
          serie: n.serie,
          dataEmissao: n.dataEmissao.toISOString(),
          valorTotal: Number(n.valorTotal),
          emitCnpj: n.emitCnpj,
          emitRazaoSocial: n.emitRazaoSocial,
          emitUf: n.emitUf,
          supplierId: n.supplierId,
          pedidoNumero: n.purchaseOrder?.numero ?? null,
          purchaseOrderId: n.purchaseOrderId,
          temEntrada: Boolean(n.purchaseId),
          observacao: n.observacao,
          itens: n.items.map((i) => ({
            id: i.id,
            ordem: i.ordem,
            codigoFornecedor: i.codigoFornecedor,
            gtin: i.gtin,
            descricao: i.descricao,
            ncm: i.ncm,
            cfop: i.cfop,
            unidade: i.unidade,
            quantidade: Number(i.quantidade),
            valorUnitario: Number(i.valorUnitario),
            valorTotal: Number(i.valorTotal),
            valorDesconto: Number(i.valorDesconto),
            valorIcmsSt: Number(i.valorIcmsSt),
            valorIpi: Number(i.valorIpi),
            valorFrete: Number(i.valorFrete),
            bonificacao: i.bonificacao,
            productId: i.productId,
            productNome: i.productId ? (porProduto.get(i.productId)?.nome ?? null) : null,
            productSku: i.productId ? (porProduto.get(i.productId)?.sku ?? null) : null,
            packagingId: i.packagingId,
            fatorConversao: Number(i.fatorConversao),
          })),
        }))}
      />
    );
  });
}
