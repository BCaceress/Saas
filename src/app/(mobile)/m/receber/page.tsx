import Link from "next/link";
import { ChevronRight, MapPin, Truck } from "lucide-react";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadPedidosAReceber } from "@/app/(app)/estoque/_data";
import { StatusBadge, SupplierAvatar } from "@/app/(app)/compras/_ui";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Card } from "@/components/ui/misc";
import { brl } from "@/lib/utils";

/** Pedidos de compra esperando conferência na porta. */
export default async function ReceberPage() {
  const ctx = await requirePermissaoMobile("compras.receber");

  const { pedidos, multiSite } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [pedidos, sites] = await Promise.all([
      loadPedidosAReceber(siteId),
      listSites(),
    ]);
    return { pedidos, multiSite: sites.length > 1 };
  });

  return (
    <>
      <MobilePageHeader titulo="Receber" descricao="Conferir e dar entrada." />

      {pedidos.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <Truck className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">
            Nenhum pedido a receber
          </p>
          <p className="text-sm text-ink-2">
            Quando um pedido for enviado ao fornecedor, ele aparece aqui.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {pedidos.map((p) => (
            <li key={p.id}>
              <Link href={`/m/receber/${p.id}`}>
                {/* Logo à esquerda: na porta, quem confere reconhece o
                    fornecedor pela marca do caminhão antes de ler a razão
                    social. O selo de status usa o MESMO componente do
                    /compras/pedidos — cor e ícone de "em trânsito" não podem
                    mudar de significado entre as duas superfícies. */}
                <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  <SupplierAvatar
                    nome={p.supplierNome}
                    logoUrl={p.supplierLogoUrl}
                    size={40}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{p.supplierNome}</p>
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">{p.numero}</span> · {p.totalItems}{" "}
                      {p.totalItems === 1 ? "item" : "itens"} · {brl(p.valorTotal)}
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      {/* A loja só aparece quando existe mais de uma: numa
                          operação de ponto único ela seria a mesma etiqueta em
                          todas as linhas. */}
                      {multiSite && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-2">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {p.siteNome}
                        </span>
                      )}
                    </div>

                    {p.previsaoEntrega && (
                      <p className="mt-1 text-xs text-ink-2">
                        previsto {new Date(p.previsaoEntrega).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
