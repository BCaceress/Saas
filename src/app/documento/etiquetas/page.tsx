import { redirect } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { db } from "@/lib/prisma";
import { brl } from "@/lib/utils";
import { eanParaSvg } from "@/lib/barcode-svg";
import { DocActions } from "../[modelo]/print-button";

/**
 * Folha de etiquetas de prateleira.
 *
 * Não usa `FolhaDocumento`: aquela é papel de relatório (cabeçalho, KPIs,
 * tabelas) e aqui o papel É a grade de etiquetas — cabeçalho gastaria a
 * primeira linha de adesivos.
 *
 * Preço e SKU vêm do BANCO agora, não da fila guardada no celular: entre montar
 * a fila e mandar imprimir alguém pode ter mudado o preço, e etiqueta com preço
 * velho é o erro que esta tela existe para não cometer.
 *
 * Formato: 3 colunas × 8 linhas, o layout de etiqueta adesiva mais comum no
 * Brasil (63,5 × 38,1 mm). Quem usa outro papel imprime e recorta — melhor uma
 * grade previsível do que um seletor de 20 formatos que ninguém configura.
 */

export const dynamic = "force-dynamic";

type Pedido = { productId: string; quantidade: number };

/** `itens=id:2,outro:1` — o formato que `urlDaFolha` monta. */
function parsePedidos(valor: string | undefined): Pedido[] {
  if (!valor) return [];
  return valor
    .split(",")
    .map((par) => {
      const [productId, qtd] = par.split(":");
      const quantidade = Math.min(50, Math.max(1, Number(qtd) || 1));
      return productId ? { productId, quantidade } : null;
    })
    .filter((p): p is Pedido => p !== null)
    .slice(0, 60);
}

export default async function EtiquetasPage({
  searchParams,
}: {
  searchParams: Promise<{ itens?: string }>;
}) {
  const { itens } = await searchParams;
  const ctx = await requireActiveTenant();
  // `produto.preco`: a etiqueta É o preço impresso. Quem não pode ver preço no
  // app não deveria conseguir imprimi-lo por uma URL.
  if (!podeEmAlguma(ctx.acessos, "produto.preco")) redirect("/sem-acesso");

  const pedidos = parsePedidos(itens);
  const produtos = await withTenant(ctx, () =>
    db.product.findMany({
      where: { id: { in: pedidos.map((p) => p.productId) } },
      select: {
        id: true,
        nome: true,
        sku: true,
        ean: true,
        precoVenda: true,
        unidadeBase: true,
        brand: { select: { nome: true } },
      },
    }),
  );

  const porId = new Map(produtos.map((p) => [p.id, p]));
  // Uma etiqueta por unidade pedida — é isso que sai do cortador de adesivo.
  const etiquetas = pedidos.flatMap((pedido) => {
    const p = porId.get(pedido.productId);
    if (!p) return [];
    return Array.from({ length: pedido.quantidade }, (_, i) => ({
      chave: `${p.id}-${i}`,
      nome: p.nome,
      marca: p.brand?.nome ?? null,
      sku: p.sku,
      ean: p.ean,
      preco: p.precoVenda == null ? null : Number(p.precoVenda),
      unidade: p.unidadeBase,
    }));
  });

  return (
    <main className="min-h-screen bg-zinc-100 py-0 text-zinc-900 sm:py-8 print:bg-white print:py-0">
      <style>{`@page{size:A4;margin:8mm}@media print{.no-print{display:none!important}body{background:#fff!important}}`}</style>

      <DocActions />

      {etiquetas.length === 0 ? (
        <p className="mx-auto max-w-[210mm] bg-white px-8 py-16 text-center text-sm text-zinc-500">
          Nenhuma etiqueta na fila.
        </p>
      ) : (
        <div className="mx-auto grid w-full max-w-[210mm] grid-cols-3 gap-[2mm] bg-white p-[4mm] shadow-sm print:max-w-none print:p-0 print:shadow-none">
          {etiquetas.map((e) => (
            <article
              key={e.chave}
              className="flex h-[38mm] flex-col justify-between overflow-hidden rounded-[1mm] border border-dashed border-zinc-300 px-[3mm] py-[2mm] break-inside-avoid print:border-zinc-200"
            >
              <div className="min-h-0">
                {e.marca && (
                  <p className="truncate font-mono text-[7px] uppercase tracking-[0.14em] text-zinc-500">
                    {e.marca}
                  </p>
                )}
                <p className="line-clamp-2 text-[9px] leading-tight font-semibold text-zinc-900">
                  {e.nome}
                </p>
              </div>

              <p className="font-display text-[20px] leading-none font-bold tracking-tight text-zinc-900 tabular-nums">
                {e.preco == null ? "—" : brl(e.preco)}
                <span className="ml-1 text-[8px] font-normal text-zinc-500">
                  /{e.unidade.toLowerCase()}
                </span>
              </p>

              <div className="flex items-end gap-2">
                <span className="shrink-0 font-mono text-[7px] text-zinc-500">{e.sku}</span>
                {e.ean && (
                  <CodigoBarras codigo={e.ean} />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

/** SVG gerado no servidor; sem EAN desenhável, a etiqueta fica só com o SKU. */
function CodigoBarras({ codigo }: { codigo: string }) {
  const svg = eanParaSvg(codigo, { altura: 26, comLegenda: true });
  if (!svg) return <span className="font-mono text-[7px] text-zinc-500">{codigo}</span>;
  return (
    <div
      className="h-[9mm] min-w-0 flex-1"
      aria-label={`Código de barras ${codigo}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
