import { notFound, redirect } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { db } from "@/lib/prisma";
import { camposDoTenant } from "@/lib/cadastro-campos";
import { garantirRecebimentoDaNota } from "@/lib/compras/recebimento";
import { carregarRecebimento, listarSubcategoriasParaCadastro } from "../_data";
import { RecebimentoClient } from "./_client";

export const metadata = { title: "Recebimento" };

/**
 * A tela de UM recebimento.
 *
 * O `id` da URL é o do RECEBIMENTO. Mas a tela morou por um tempo no id da
 * NOTA, e esses endereços estão em e-mails, QR de conferência e no histórico
 * do navegador de quem confere — então um id de nota é aceito e redirecionado
 * para o recebimento dela, em vez de virar um 404 sem explicação.
 */
export default async function RecebimentoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ origem?: string; etapa?: string }>;
}) {
  const { id } = await params;
  const { origem, etapa } = await searchParams;
  // Com a conferência aberta, a etapa da nota só aparece quando pedida: os
  // itens do XML e o fornecedor não entram na conta de quem está contando.
  const verNota = etapa === "nota";
  const ctx = await requireActiveTenant();
  // O recebimento é assunto das duas pontas: quem confere na doca e quem trata
  // o XML no escritório. Exigir só `compras.receber` trancava o contador para
  // fora da própria etapa de de-para.
  const podeReceber = podeEmAlguma(ctx.acessos, "compras.receber");
  const podeTratarNota = podeEmAlguma(ctx.acessos, "fiscal.importar");
  if (!podeReceber && !podeTratarNota) throw new SemPermissaoError();

  // Cadastro rápido de produto (item da nota sem catálogo) exige permissão
  // própria — quem só confere na porta pode não poder criar produto.
  const podeCriarProduto = podeEmAlguma(ctx.acessos, "produto.editar");
  // A decisão que o recebimento provoca FORA dele: aceitar o contato que o XML
  // trouxe para o fornecedor. Quem não pode vê a informação, sem o botão.
  const podeEditarFornecedor = podeEmAlguma(ctx.acessos, "fornecedor.editar");
  // A rota do XML exige esta permissão; sem ela, os botões só levariam a um
  // "sem permissão" depois do clique.
  const podeBaixarXml = podeEmAlguma(ctx.acessos, "fiscal.baixar");

  const destino = await withTenant(ctx, async () => {
    const existe = await db.goodsReceipt.findFirst({ where: { id }, select: { id: true } });
    if (existe) return null;
    const nota = await db.fiscalInbound.findFirst({ where: { id }, select: { id: true } });
    if (!nota) return null;
    const r = await garantirRecebimentoDaNota({
      tenantId: ctx.tenant.id,
      inboundId: nota.id,
      userId: ctx.user.id,
    });
    return r.id;
  });
  if (destino) redirect(`/recebimento/${destino}`);

  const [dados, subcategorias] = await withTenant(ctx, () =>
    Promise.all([
      carregarRecebimento(ctx.tenant.id, id, { origem: origem ?? null, verNota }),
      podeCriarProduto ? listarSubcategoriasParaCadastro() : Promise.resolve([]),
    ]),
  );
  if (!dados) notFound();

  return (
    <RecebimentoClient
      dados={dados}
      verNota={verNota}
      podeReceber={podeReceber}
      podeTratarNota={podeTratarNota}
      podeCriarProduto={podeCriarProduto}
      podeEditarFornecedor={podeEditarFornecedor}
      podeBaixarXml={podeBaixarXml}
      // SKU desligado nas configurações de produto some daqui também.
      mostrarSku={camposDoTenant(ctx.tenant).sku}
      cega={ctx.tenant.conferenciaCega}
      subcategorias={subcategorias}
    />
  );
}
