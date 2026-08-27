import { cookies } from "next/headers";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import {
  loadPedidosCompraPagina,
  loadResumoPedidos,
  loadFornecedoresComPedido,
} from "../estoque/_data";
import { filtrosDaUrl, filtroDoBanco } from "./_query";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ComprasAcoes } from "./_acoes";
import { NovoPedidoProvider } from "./_novo-pedido";
import { FormOptionsProvider } from "./_form-options";
import { PurchaseOrdersClient, PO_VIEW_COOKIE, type PoView } from "./_po-client";

// ── Pedidos de Compra ──────────────────────────────────────────
//
// Esta tela responde UMA pergunta: "quais pedidos eu tenho e em que situação
// eles estão?". Ela não sugere compras (isso é
// /cotacoes/reposicao-inteligente) e não recebe mercadoria (isso é
// /recebimento).
//
// A separação com Recebimentos é a regra do módulo: um pedido gera 0..N
// recebimentos e nunca "vira" um. O que chega de volta para cá é o resultado
// — a coluna Recebimento e o status derivado dela (Parcialmente recebido,
// Concluído).

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
    const [pagina, sites, resumo, fornecedores] = await Promise.all([
      loadPedidosCompraPagina(
        filtroDoBanco(filtros, {
          skip: paginado ? (filtros.pagina - 1) * POR_PAGINA : 0,
          take: paginado ? POR_PAGINA : TETO_KANBAN,
        }),
      ),
      listSites(),
      // O resumo é do TENANT, não da página: cinco números que mudam conforme
      // o filtro não são resumo, são ruído.
      loadResumoPedidos(),
      loadFornecedoresComPedido(),
    ]);
    return {
      pedidos: pagina.rows,
      total: pagina.total,
      sites,
      activeSiteId,
      resumo,
      fornecedores,
    };
  });

  const pedidosSerial = data.pedidos.map(serialPedido);

  return (
    <FormOptionsProvider>
      <NovoPedidoProvider empresa={ctx.tenant.nome}>
        <div className="flex flex-col gap-5">
          <PageHeader
            title="Pedidos de Compra"
            icon={navIcon("/pedidos")}
            description="Acompanhe seus pedidos de compra do envio à conclusão."
            innerClassName="max-w-none"
            actions={<ComprasAcoes />}
          >
            <div className="flex justify-end print:hidden">
              <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
            </div>
          </PageHeader>

          <PurchaseOrdersClient
            pedidos={pedidosSerial}
            total={data.total}
            porPagina={POR_PAGINA}
            filtros={filtros}
            fornecedores={data.fornecedores}
            resumo={data.resumo}
            empresa={ctx.tenant.nome}
            initialView={view}
          />
        </div>
      </NovoPedidoProvider>
    </FormOptionsProvider>
  );
}
