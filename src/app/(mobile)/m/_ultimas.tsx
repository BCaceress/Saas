import Link from "next/link";
import {
  ArrowLeftRight,
  Boxes,
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { withTenant } from "@/lib/current-tenant";
import { db } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { Bolha, MCard, MCardLink, type Tom } from "@/components/mobile/ui";
import type { MobileCtx } from "./_sections";

/**
 * "Últimas movimentações" — as três coisas mais recentes que mexeram no
 * estoque, seja venda, entrada, contagem ou perda.
 *
 * A fonte é o `StockMovement` e não uma junção de venda + compra + inventário:
 * toda operação que muda saldo já passa por lá (é o que `aplicarMovimento`
 * garante), então UMA leitura ordenada por data responde a pergunta inteira. A
 * origem sai do próprio lançamento — `saleId`, `purchaseId`, `transferId`.
 *
 * Três linhas, nunca mais: isto é sinal de vida ("o que acabou de acontecer na
 * loja"), não o extrato — esse mora na tela de movimentações.
 */

const TIPO: Record<
  string,
  { label: string; icone: LucideIcon; tom: Tom }
> = {
  ENTRADA: { label: "Entrada", icone: PackagePlus, tom: "ok" },
  SAIDA: { label: "Saída", icone: PackageMinus, tom: "info" },
  AJUSTE: { label: "Ajuste", icone: SlidersHorizontal, tom: "warn" },
  TRANSFERENCIA: { label: "Transferência", icone: ArrowLeftRight, tom: "brand" },
  ABERTURA: { label: "Abertura de unidade", icone: Boxes, tom: "accent" },
  PRODUCAO: { label: "Produção", icone: Boxes, tom: "violeta" },
  PERDA: { label: "Perda", icone: TriangleAlert, tom: "danger" },
  DEVOLUCAO_CLIENTE: { label: "Devolução do cliente", icone: Undo2, tom: "ok" },
  DEVOLUCAO_FORNECEDOR: { label: "Devolução ao fornecedor", icone: Undo2, tom: "warn" },
};

const PADRAO = { label: "Movimentação", icone: Boxes, tom: "neutro" as Tom };

export async function UltimasSection({ d }: { d: MobileCtx }) {
  const linhas = await withTenant(d.ctx, async () => {
    const movs = await db.stockMovement.findMany({
      where: d.siteId ? { siteId: d.siteId } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
      select: {
        id: true,
        tipo: true,
        productId: true,
        deltaFechado: true,
        deltaAberto: true,
        createdAt: true,
        saleId: true,
        purchaseId: true,
        transferId: true,
      },
    });
    if (movs.length === 0) return [];

    // Nome do produto numa segunda ida, e não por `include`: o `StockMovement`
    // não declara a relação com Product (ver schema), e três ids fazem uma
    // consulta que cabe no mesmo tempo de rede.
    const produtos = await db.product.findMany({
      where: { id: { in: movs.map((m) => m.productId) } },
      select: { id: true, nome: true, unidadeBase: true },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));

    return movs.map((m) => {
      const p = porId.get(m.productId);
      const delta = Number(m.deltaFechado) || Number(m.deltaAberto);
      return {
        id: m.id,
        productId: m.productId,
        produto: p?.nome ?? "Produto removido",
        unidade: p?.unidadeBase ?? "UN",
        tipo: m.tipo as string,
        // A venda é uma SAIDA como outra qualquer no banco; quem a distingue é
        // o vínculo. Sem isso a home diria "saída" para o que o operador chama
        // de venda o dia inteiro.
        venda: m.saleId != null,
        compra: m.purchaseId != null,
        transferencia: m.transferId != null,
        delta,
        em: m.createdAt,
      };
    });
  });

  if (linhas.length === 0) {
    return (
      <MCard className="fade-in-m p-4 text-center">
        <p className="text-sm text-ink-2">Nenhuma movimentação por aqui ainda.</p>
        <p className="mt-0.5 text-[13px] text-muted">
          Vendas, entradas e contagens aparecem aqui assim que acontecerem.
        </p>
      </MCard>
    );
  }

  return (
    <ul className="space-y-2">
      {linhas.map((l) => {
        const base = TIPO[l.tipo] ?? PADRAO;
        const rotulo = l.venda
          ? { ...base, label: "Venda", icone: ShoppingCart, tom: "accent" as Tom }
          : l.compra && l.tipo === "ENTRADA"
            ? { ...base, label: "Entrada de compra" }
            : l.transferencia
              ? { ...base, label: "Transferência", icone: ArrowLeftRight, tom: "brand" as Tom }
              : base;

        return (
          <li key={l.id}>
            <MCardLink href={`/m/produto/${l.productId}?de=/m`} className="flex items-center gap-3 p-3">
              <Bolha icone={rotulo.icone} tom={rotulo.tom} tamanho="md" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{l.produto}</p>
                <p className="truncate text-xs text-muted">
                  {rotulo.label} · {quando(l.em)}
                </p>
              </div>

              <p
                className={cn(
                  "shrink-0 font-display text-base leading-none font-semibold tabular-nums",
                  l.delta < 0 ? "text-danger" : "text-ok",
                )}
              >
                {l.delta > 0 ? "+" : ""}
                {l.delta.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
                <span className="text-[11px] font-medium text-muted">
                  {l.unidade.toLowerCase()}
                </span>
              </p>
            </MCardLink>
          </li>
        );
      })}
    </ul>
  );
}

export function UltimasFallback() {
  return (
    <div className="space-y-2">
      <MCard className="h-16 animate-pulse bg-surface-2" />
      <MCard className="h-16 animate-pulse bg-surface-2" />
      <MCard className="h-16 animate-pulse bg-surface-2" />
    </div>
  );
}

/**
 * Distância em palavras, curta o bastante para caber na linha do cartão. Fica
 * aqui e não em `lib/utils` porque é a única tela que precisa desse formato —
 * o resto do app mostra data e hora cheias.
 */
function quando(data: Date): string {
  const min = Math.round((Date.now() - data.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/* Um link para o extrato completo mora no rodapé da seção, não em cada linha:
   a linha leva ao produto, que é a pergunta seguinte mais provável. */
export function VerExtrato() {
  return (
    <Link
      href="/estoque/movimentacoes"
      className="shrink-0 text-[13px] font-medium text-accent hover:underline"
    >
      Ver todas
    </Link>
  );
}
