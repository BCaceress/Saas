import { cookies } from "next/headers";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId, listSites } from "@/lib/sites";
import {
  loadPedidosCompraPagina,
  loadResumoPedidos,
  loadTransferenciasAReceber,
  loadFornecedoresComPedido,
} from "../estoque/_data";
import { filtrosDaUrl, filtroDoBanco } from "./_query";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navDescricao } from "@/components/app/nav-config";
import { ComprasAcoes } from "./_acoes";
import { NovoPedidoProvider } from "./_novo-pedido";
import { FormOptionsProvider } from "./_form-options";
import { PurchaseOrdersClient, PO_VIEW_COOKIE, type PoView } from "./_po-client";
import { contarAguardandoDocumento } from "@/lib/compras/documento";
import Link from "next/link";
import { FileClock } from "lucide-react";

// ── Pedidos de Compra ──────────────────────────────────────────
// Acompanhamento dos pedidos já criados (status, entregas, recebimentos,
// histórico). Esta tela NÃO sugere compras — a inteligência de reposição
// vive exclusivamente em /cotacoes/reposicao-inteligente.

const serialPedido = <
  T extends {
    previsaoEntrega: Date | null;
    createdAt: Date;
    updatedAt: Date;
    enviadoEm: Date | null;
    confirmadoEm: Date | null;
    emTransitoEm: Date | null;
    recebidoEm: Date | null;
    canceladoEm: Date | null;
  },
>(p: T) => ({
  ...p,
  previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  enviadoEm: p.enviadoEm?.toISOString() ?? null,
  confirmadoEm: p.confirmadoEm?.toISOString() ?? null,
  emTransitoEm: p.emTransitoEm?.toISOString() ?? null,
  recebidoEm: p.recebidoEm?.toISOString() ?? null,
  canceladoEm: p.canceladoEm?.toISOString() ?? null,
});

/**
 * Quantos pedidos por página. O Kanban não pagina — é um quadro, e uma coluna
 * pela metade mentiria sobre a fila. Ele leva um teto alto em vez disso.
 */
const POR_PAGINA = 25;
const TETO_KANBAN = 200;

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const filtros = filtrosDaUrl(sp);

  // Último modo usado (lista/kanban) — lido no servidor porque decide QUANTO
  // buscar, não só como desenhar.
  const store = await cookies();
  const view: PoView = store.get(PO_VIEW_COOKIE)?.value === "kanban" ? "kanban" : "lista";

  const data = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const paginado = view === "lista";
    const [pagina, aReceber, sites, semDocumento, resumo, fornecedores] = await Promise.all([
      loadPedidosCompraPagina(
        filtroDoBanco(filtros, {
          skip: paginado ? (filtros.pagina - 1) * POR_PAGINA : 0,
          take: paginado ? POR_PAGINA : TETO_KANBAN,
        }),
      ),
      loadTransferenciasAReceber(activeSiteId),
      listSites(),
      // Entradas lançadas à mão esperando o XML. É a pendência que ninguém vê
      // até a nota chegar e alguém receber a mesma mercadoria pela segunda vez.
      contarAguardandoDocumento(ctx.tenant.id),
      // O resumo é do TENANT, não da página: cinco números que mudam conforme
      // o filtro não são resumo, são ruído.
      loadResumoPedidos(),
      loadFornecedoresComPedido(),
    ]);
    return {
      pedidos: pagina.rows,
      total: pagina.total,
      aReceber,
      sites,
      activeSiteId,
      semDocumento,
      resumo,
      fornecedores,
    };
  });

  const pedidosSerial = data.pedidos.map(serialPedido);
  const transfersSerial = data.aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));

  const descricao = navDescricao("/pedidos");
  return (
    <FormOptionsProvider>
      <NovoPedidoProvider empresa={ctx.tenant.nome}>
        <div className="flex flex-col gap-5">
          <PageHeader
            title="Pedidos de Compra"
            icon={navIcon("/pedidos")}
            description={descricao}
            innerClassName="max-w-none"
            actions={
              /* Receber mercadoria é permissão à parte de "ver pedidos": quem
                 só acompanha compra não confere carga na porta. */
              <ComprasAcoes podeReceber={podeEmAlguma(ctx.acessos, "compras.receber")} />
            }
          >
            <div className="flex justify-end print:hidden">
              <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
            </div>
          </PageHeader>
          {data.semDocumento > 0 && (
            <Link
              href="/fiscal/notas-recebidas"
              className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent transition-colors hover:bg-accent-soft/70"
            >
              <FileClock size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong className="font-semibold">
                  {data.semDocumento}{" "}
                  {data.semDocumento === 1
                    ? "entrada aguarda o documento fiscal"
                    : "entradas aguardam o documento fiscal"}
                </strong>{" "}
                — foram lançadas à mão sem número de nota. Quando o XML chegar, vincule os dois em
                vez de receber, para a mercadoria não entrar duas vezes.
              </span>
            </Link>
          )}
          <PurchaseOrdersClient
            pedidos={pedidosSerial}
            total={data.total}
            porPagina={POR_PAGINA}
            filtros={filtros}
            fornecedores={data.fornecedores}
            resumo={data.resumo}
            transferencias={transfersSerial}
            empresa={ctx.tenant.nome}
            initialView={view}
          />
        </div>
      </NovoPedidoProvider>
    </FormOptionsProvider>
  );
}
