import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadInventarios } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Badge, Card } from "@/components/ui/misc";

/**
 * Inventários em aberto. Criar inventário continua no computador — definir
 * escopo, categoria e recorrência é trabalho de mesa. O celular faz a parte
 * que só se faz de pé: contar.
 */
export default async function ContagemListaPage() {
  const ctx = await requirePermissaoMobile("estoque.inventario");

  const inventarios = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const todos = await loadInventarios(siteId);
    return todos.filter((i) => i.status === "ABERTO" || i.status === "EM_ANDAMENTO");
  });

  return (
    <>
      <MobilePageHeader titulo="Contagem" descricao="Inventários para contar agora." />

      {inventarios.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <ClipboardList className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">
            Nenhum inventário aberto
          </p>
          <p className="text-sm text-ink-2">
            Programe um inventário no computador e ele aparece aqui para contar.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {inventarios.map((i) => {
            const contados = i.items.filter((it) => it.qtdContada != null).length;
            const total = i.items.length || i.qtdProdutos;
            return (
              <li key={i.id}>
                <Link href={`/m/estoque/contagem/${i.id}`}>
                  <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{i.escopoLabel}</p>
                      <p className="truncate text-xs text-muted">
                        {i.siteNome} ·{" "}
                        {new Date(i.dataProgramada).toLocaleDateString("pt-BR")}
                      </p>
                      <p className="mt-1 text-xs text-ink-2">
                        {contados} de {total} contados
                      </p>
                    </div>
                    {i.modoCego && <Badge tone="accent">Cego</Badge>}
                    <Badge tone={i.status === "EM_ANDAMENTO" ? "brand" : "neutral"}>
                      {i.status === "EM_ANDAMENTO" ? "Em andamento" : "Aberto"}
                    </Badge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
