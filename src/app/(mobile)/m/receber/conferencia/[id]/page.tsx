import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { can } from "@/lib/permissoes";
import { diaDaLoja } from "@/lib/datas";
import { carregarRecebimento } from "@/app/(app)/recebimento/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConferenciaMobile } from "./_client";

export const metadata = { title: "Conferência" };

/**
 * A conferência de UM recebimento no celular — a mesma do computador, com o
 * que a doca faz de pé: bipar, contar no teclado grande e receber. Relacionar
 * produto, dividir lote e tratar a nota continuam no computador.
 */
export default async function ConferenciaMobilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissaoMobile("compras.receber");

  const dados = await withTenant(ctx, () => carregarRecebimento(ctx.tenant.id, id));
  if (!dados) notFound();

  const { recebimento, nota, pedido } = dados;
  const documento = nota
    ? `NF ${nota.numero}/${nota.serie}`
    : recebimento.numeroNota
      ? `NF ${recebimento.numeroNota}`
      : (pedido?.numero ?? null);

  return (
    <>
      <MobilePageHeader
        titulo={recebimento.supplierNome ?? "Recebimento"}
        descricao={
          <span className="font-mono text-xs">
            {recebimento.numero}
            {documento ? ` · ${documento}` : ""}
          </span>
        }
        voltar="/m/receber"
      />
      <ConferenciaMobile
        dados={dados}
        // Ver é com a permissão em alguma loja; contar e receber, na loja
        // DESTE recebimento — a régua das actions.
        podeReceber={can(ctx.acessos, "compras.receber", recebimento.siteId)}
        cega={ctx.tenant.conferenciaCega}
        validadeAlertaDias={ctx.tenant.validadeAlertaDias || 30}
        hoje={diaDaLoja(new Date())}
      />
    </>
  );
}
