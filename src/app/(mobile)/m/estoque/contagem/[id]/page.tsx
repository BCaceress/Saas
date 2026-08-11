import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { loadInventario } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { ContagemClient } from "./_client";
import { IniciarContagem } from "./_iniciar";

export default async function ContagemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissaoMobile("estoque.inventario");

  const inventario = await withTenant(ctx, () => loadInventario(id));
  if (!inventario) notFound();

  if (inventario.status === "FECHADO" || inventario.status === "CANCELADO") {
    return (
      <>
        <MobilePageHeader
          titulo="Contagem encerrada"
          voltar="/m/estoque/contagem"
          descricao={inventario.escopoLabel}
        />
        <p className="text-sm text-ink-2">
          Este inventário já foi {inventario.status === "FECHADO" ? "fechado" : "cancelado"}.
          Veja o resultado no computador.
        </p>
      </>
    );
  }

  return (
    <>
      <MobilePageHeader
        titulo={inventario.escopoLabel}
        descricao={`${inventario.siteNome}${inventario.modoCego ? " · contagem cega" : ""}`}
        voltar="/m/estoque/contagem"
      />
      {/* PROGRAMADO ainda não tem InventoryItem nenhum: o escopo só é resolvido
          (e o saldo fotografado) ao iniciar. Cair direto na contagem mostraria
          uma lista vazia que não salva nada. */}
      {inventario.status === "PROGRAMADO" ? (
        <IniciarContagem
          inventoryId={inventario.id}
          qtdProdutos={inventario.qtdProdutos}
          modoCego={inventario.modoCego}
        />
      ) : (
        <ContagemClient inventario={inventario} />
      )}
    </>
  );
}
