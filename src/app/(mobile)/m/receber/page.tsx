import Link from "next/link";
import { ChevronRight, Truck } from "lucide-react";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadPedidosAReceber } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Badge, Card } from "@/components/ui/misc";
import { brl } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  ENVIADO: "Enviado",
  AGUARDANDO: "Aguardando",
  EM_TRANSITO: "Em trânsito",
  RECEBIDO_PARCIAL: "Parcial",
};

/** Pedidos de compra esperando conferência na porta. */
export default async function ReceberPage() {
  const ctx = await requirePermissaoMobile("compras.receber");

  const pedidos = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    return loadPedidosAReceber(siteId);
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
                <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{p.supplierNome}</p>
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">{p.numero}</span> · {p.totalItems}{" "}
                      {p.totalItems === 1 ? "item" : "itens"} · {brl(p.valorTotal)}
                    </p>
                    {p.previsaoEntrega && (
                      <p className="mt-0.5 text-xs text-ink-2">
                        previsto {new Date(p.previsaoEntrega).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <Badge tone={p.status === "RECEBIDO_PARCIAL" ? "warn" : "neutral"}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Badge>
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
