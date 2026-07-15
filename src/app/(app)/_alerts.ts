"use server";

import { db } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import type { AlertItem } from "@/lib/alerts-types";
import { sortAlerts } from "@/lib/alerts-types";
import { loadCouponCandidates } from "./clientes/_data";

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** Roda a leitura no contexto de tenant, entregando o tenant resolvido. */
async function withTenant<T>(
  fn: (ctx: Awaited<ReturnType<typeof requireActiveTenant>>) => Promise<T>,
): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

const DIA = 86_400_000;

/** Janela de carência após o cadastro — não incomoda o operador com alertas
 *  de estoque/preço/custo enquanto ele ainda está terminando de configurar. */
const GRACA_NOVO = DIA;

/**
 * Central de alertas do sino — tudo que exige atenção do operador, computado ao
 * vivo sobre os dados de estoque, compras e inventário (só leitura, via `db`).
 * O que precisa de série histórica de vendas/consumo aberto (Inteligência,
 * Consumo) ainda não entra — o painel só renderiza as categorias com alertas.
 */
export async function getAlerts(): Promise<AlertItem[]> {
  return withTenant(async (ctx) => {
    const agora = Date.now();
    const paradoMs = (ctx.tenant.produtoParadoDias || 45) * DIA;

    const [produtos, movs, inventarios, transferencias, pedidos] = await Promise.all([
      db.product.findMany({
        where: { ativo: true },
        select: {
          id: true,
          nome: true,
          tipo: true,
          precoVenda: true,
          custo: true,
          custoMedio: true,
          createdAt: true,
          stocks: {
            select: {
              estoqueFechado: true,
              estoqueAberto: true,
              estoqueMinimo: true,
              estoqueIdeal: true,
            },
          },
        },
      }),
      db.stockMovement.groupBy({
        by: ["productId"],
        _max: { createdAt: true },
      }),
      db.inventory.findMany({
        where: { status: "ABERTO" },
        select: { id: true, createdAt: true, site: { select: { nome: true } } },
      }),
      db.transfer.findMany({
        where: { status: "EXPEDIDO" },
        select: {
          id: true,
          expedidoEm: true,
          createdAt: true,
          destino: { select: { nome: true } },
        },
      }),
      db.purchaseOrder.findMany({
        where: { status: { in: ["RASCUNHO", "ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"] } },
        select: {
          id: true,
          numero: true,
          status: true,
          createdAt: true,
          supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        },
      }),
    ]);

    const ultimoMov = new Map<string, number>();
    for (const m of movs) {
      if (m._max.createdAt) ultimoMov.set(m.productId, new Date(m._max.createdAt).getTime());
    }

    const alerts: AlertItem[] = [];

    // ── Produtos: estoque, preço, custo, movimentação ──────────
    for (const p of produtos) {
      const criadoHa = agora - new Date(p.createdAt).getTime();
      // Recém cadastrado: ainda em configuração, não gera alerta nenhum.
      if (criadoHa < GRACA_NOVO) continue;

      const href = `/produtos/${p.id}/editar`;
      const abrir = "Abrir produto";
      const temStock = p.stocks.length > 0;
      const total = p.stocks.reduce((s, e) => s + n(e.estoqueFechado) + n(e.estoqueAberto), 0);
      const minimo = p.stocks.reduce((s, e) => s + n(e.estoqueMinimo), 0);
      const ideal = p.stocks.reduce((s, e) => s + n(e.estoqueIdeal), 0);

      if (temStock) {
        if (total < 0) {
          alerts.push({
            id: `estoque-negativo:${p.id}`,
            priority: "critico",
            category: "criticos",
            icon: "divergencia",
            titulo: p.nome,
            descricao: "Estoque negativo — revise as movimentações.",
            href,
            acaoLabel: abrir,
          });
        } else if (total === 0) {
          alerts.push({
            id: `sem-estoque:${p.id}`,
            priority: "critico",
            category: "criticos",
            icon: "sem-estoque",
            titulo: p.nome,
            descricao: "Sem estoque — você está perdendo venda.",
            href,
            acaoLabel: abrir,
          });
        } else if (minimo > 0 && total <= minimo) {
          alerts.push({
            id: `minimo:${p.id}`,
            priority: "alto",
            category: "criticos",
            icon: "minimo",
            titulo: p.nome,
            descricao: `Abaixo do mínimo (${total} de ${minimo}).`,
            href,
            acaoLabel: abrir,
          });
        } else if (ideal > 0 && total < ideal) {
          alerts.push({
            id: `reposicao:${p.id}`,
            priority: "medio",
            category: "operacao",
            icon: "reposicao",
            titulo: p.nome,
            descricao: `Abaixo do ideal (${total} de ${ideal}) — considere repor.`,
            href,
            acaoLabel: abrir,
          });
        }
      }

      if (p.precoVenda == null && p.tipo !== "INSUMO") {
        alerts.push({
          id: `sem-preco:${p.id}`,
          priority: "critico",
          category: "criticos",
          icon: "sem-preco",
          titulo: p.nome,
          descricao: "Sem preço de venda — não pode ser vendido.",
          href,
          acaoLabel: abrir,
        });
      }

      if (p.custo == null && p.custoMedio == null) {
        alerts.push({
          id: `sem-custo:${p.id}`,
          priority: "medio",
          category: "financeiro",
          icon: "custo",
          titulo: p.nome,
          descricao: "Sem custo cadastrado — margem indefinida.",
          href,
          acaoLabel: abrir,
        });
      }

      const ultimo = ultimoMov.get(p.id);
      if (ultimo == null && criadoHa <= 7 * DIA) {
        alerts.push({
          id: `novo-sem-mov:${p.id}`,
          priority: "info",
          category: "operacao",
          icon: "novo",
          titulo: p.nome,
          descricao: "Recém cadastrado, ainda sem movimentação.",
          at: new Date(p.createdAt).toISOString(),
          href,
          acaoLabel: abrir,
        });
      } else if (ultimo != null && agora - ultimo >= paradoMs && total > 0) {
        const dias = Math.round((agora - ultimo) / DIA);
        alerts.push({
          id: `parado:${p.id}`,
          priority: "baixo",
          category: "operacao",
          icon: "parado",
          titulo: p.nome,
          descricao: `Estoque parado há ${dias} dias.`,
          at: new Date(ultimo).toISOString(),
          href,
          acaoLabel: abrir,
        });
      }
    }

    // ── Inventário ─────────────────────────────────────────────
    for (const inv of inventarios) {
      const atrasado = agora - new Date(inv.createdAt).getTime() >= 3 * DIA;
      alerts.push({
        id: `inventario:${inv.id}`,
        priority: atrasado ? "alto" : "medio",
        category: "inventario",
        icon: "inventario",
        titulo: atrasado ? "Inventário atrasado" : "Inventário em aberto",
        descricao: `${inv.site.nome} — contagem ainda não fechada.`,
        at: new Date(inv.createdAt).toISOString(),
        href: "/estoque/inventarios",
        acaoLabel: "Ver inventário",
      });
    }

    // ── Transferências aguardando confirmação ──────────────────
    for (const t of transferencias) {
      alerts.push({
        id: `transferencia:${t.id}`,
        priority: "alto",
        category: "operacao",
        icon: "transferencia",
        titulo: "Transferência aguardando",
        descricao: `Em trânsito para ${t.destino.nome} — confirme o recebimento.`,
        at: new Date(t.expedidoEm ?? t.createdAt).toISOString(),
        href: "/estoque/movimentacoes",
        acaoLabel: "Confirmar",
      });
    }

    // ── Compras / recebimentos ─────────────────────────────────
    for (const pc of pedidos) {
      const fornecedor = pc.supplier.nomeFantasia ?? pc.supplier.razaoSocial;
      if (pc.status === "AGUARDANDO" || pc.status === "RECEBIDO_PARCIAL") {
        alerts.push({
          id: `recebimento:${pc.id}`,
          priority: "alto",
          category: "operacao",
          icon: "recebimento",
          titulo: `Entrada aguardando conferência`,
          descricao: `${pc.numero} · ${fornecedor}`,
          at: new Date(pc.createdAt).toISOString(),
          href: "/compras",
          acaoLabel: "Conferir",
        });
      } else {
        alerts.push({
          id: `compra:${pc.id}`,
          priority: pc.status === "ENVIADO" ? "medio" : "baixo",
          category: "financeiro",
          icon: "compra",
          titulo: pc.status === "ENVIADO" ? "Compra pendente" : "Pedido em rascunho",
          descricao: `${pc.numero} · ${fornecedor}`,
          at: new Date(pc.createdAt).toISOString(),
          href: "/compras",
          acaoLabel: "Abrir",
        });
      }
    }

    // ── Fidelização: cupons sugeridos (risco / aniversário) ────
    const candidatos = await loadCouponCandidates(ctx.tenant.cupomDiasRisco);
    for (const c of candidatos) {
      if (c.jaEnviado) continue;
      if (c.tipo === "ANIVERSARIO") {
        alerts.push({
          id: `aniversario:${c.customerId}`,
          priority: "medio",
          category: "inteligencia",
          icon: "aniversario",
          titulo: c.nome,
          descricao: `Faz aniversário (${c.aniversario}) — envie um cupom de presente.`,
          href: "/clientes",
          acaoLabel: "Enviar cupom",
        });
      } else {
        alerts.push({
          id: `cliente-risco:${c.customerId}`,
          priority: "baixo",
          category: "inteligencia",
          icon: "cliente-risco",
          titulo: c.nome,
          descricao: `Cliente sem comprar há ${c.dias} dias — recupere com um cupom.`,
          href: "/clientes",
          acaoLabel: "Enviar cupom",
        });
      }
    }

    // Categorias desligadas em Configurações → Notificações.
    const off = new Set(ctx.tenant.alertasDesativados);
    return sortAlerts(off.size ? alerts.filter((a) => !off.has(a.category)) : alerts);
  });
}
