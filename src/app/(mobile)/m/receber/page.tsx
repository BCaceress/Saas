import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { can } from "@/lib/permissoes";
import { db } from "@/lib/prisma";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { RECEBIMENTOS_ABERTOS } from "@/lib/compras/recebimento";
import { loadPedidosAReceber } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { ReceberClient } from "./_client";
import { ConferenciasAbertas, haQuanto, type ConferenciaAberta } from "./_conferencias";

/** Conferências na doca e pedidos de compra esperando a mercadoria. */
export default async function ReceberPage() {
  const ctx = await requirePermissaoMobile("compras.receber");

  const { pedidos, multiSite, conferencias } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [pedidos, sites, abertos] = await Promise.all([
      loadPedidosAReceber(siteId),
      listSites(),
      // O avulso nunca salvo (provisório) ainda não é recebimento: alguém só
      // clicou em "Não tenho o XML".
      db.goodsReceipt.findMany({
        where: {
          ...(siteId ? { siteId } : {}),
          status: { in: RECEBIMENTOS_ABERTOS },
          provisorio: false,
        },
        select: {
          id: true,
          numero: true,
          iniciadoEm: true,
          chegadaEm: true,
          numeroNota: true,
          fornecedorLivre: true,
          supplier: { select: { nomeFantasia: true, razaoSocial: true } },
          inbound: { select: { numero: true, serie: true, emitRazaoSocial: true } },
          purchaseOrder: { select: { numero: true } },
          itens: { select: { qtdRecebida: true } },
        },
        orderBy: { iniciadoEm: "asc" },
        take: 30,
      }),
    ]);
    // Uma requisição, um "agora": o servidor renderiza esta lista uma vez.
    const agora = new Date().getTime();
    const conferencias: ConferenciaAberta[] = abertos.map((r) => ({
      id: r.id,
      numero: r.numero,
      fornecedor:
        r.supplier?.nomeFantasia ||
        r.supplier?.razaoSocial ||
        r.inbound?.emitRazaoSocial ||
        r.fornecedorLivre ||
        "Sem fornecedor",
      documento: r.inbound
        ? `NF ${r.inbound.numero}/${r.inbound.serie}`
        : r.numeroNota
          ? `NF ${r.numeroNota}`
          : (r.purchaseOrder?.numero ?? null),
      itens: r.itens.length,
      contados: r.itens.filter((i) => i.qtdRecebida != null).length,
      espera: haQuanto(r.chegadaEm ?? r.iniciadoEm, agora),
    }));
    return { pedidos, multiSite: sites.length > 1, conferencias };
  });

  return (
    <>
      <MobilePageHeader titulo="Receber" descricao="Conferir e dar entrada." />

      <ConferenciasAbertas conferencias={conferencias} />

      {conferencias.length > 0 && (
        <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Pedidos a receber
        </h2>
      )}

      <ReceberClient
        multiSite={multiSite}
        pedidos={pedidos.map((p) => ({
          id: p.id,
          numero: p.numero,
          status: p.status,
          supplierNome: p.supplierNome,
          supplierLogoUrl: p.supplierLogoUrl,
          siteNome: p.siteNome,
          totalItems: p.totalItems,
          valorTotal: p.valorTotal,
          previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
          // Permissão é POR LOJA: quem confere no depósito pode não mexer no
          // pedido da outra unidade. Esconder o botão é cosmético (a action
          // valida de novo), mas evita oferecer o que vai dar erro.
          podePedir: can(ctx.acessos, "compras.pedir", p.siteId),
        }))}
      />
    </>
  );
}
