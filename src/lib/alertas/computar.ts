import "server-only";

import { db } from "@/lib/prisma";
import type { Tenant } from "@/generated/prisma";
import type { AlertItem, AlertCategory, AlertPriority } from "@/lib/alerts-types";
import { sortAlerts } from "@/lib/alerts-types";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import { estaAprendendo, mediaDiaria, policyDoTenant } from "@/lib/estoque-estrategia";
import {
  CATALOGO,
  alertaDeEstoque,
  kindDeAlerta,
  resolverAlertas,
  type AlertKind,
  type ResolucaoAlerta,
} from "@/lib/alertas/catalogo";
import {
  chaveProdutoSite,
  consumoPorProdutoSite,
  diasDeHistoricoVendas,
} from "@/lib/estoque-giro";
import { loadCouponCandidates } from "@/app/(app)/clientes/_data";

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type CamposAlerta = {
  titulo: string;
  descricao: string;
  href?: string;
  acaoLabel?: string;
  at?: string;
  /** Gravidade que só o contexto conhece (inventário atrasado, pedido em rascunho). */
  prioridade?: AlertPriority;
};

/**
 * Emissor de alertas do tenant. Categoria, ícone e prioridade NÃO são
 * escolhidos no motor: vêm do catálogo, com a preferência da empresa por cima
 * (`Tenant.alertasConfig`). Tipo desligado nem chega a virar item — o corte é
 * aqui, uma vez por tenant, e não N vezes no filtro de cada pessoa.
 *
 * Ordem da prioridade: contexto > preferência da empresa > padrão do catálogo.
 */
function criarEmissor(prefs: Record<AlertKind, ResolucaoAlerta>) {
  return function emitir(
    lista: AlertItem[],
    kind: AlertKind,
    sujeito: string,
    campos: CamposAlerta,
  ): void {
    const pref = prefs[kind];
    if (!pref.ligado) return;
    const def = CATALOGO[kind];
    lista.push({
      id: `${kind}:${sujeito}`,
      priority: campos.prioridade ?? pref.prioridade,
      category: def.categoria,
      icon: def.icone,
      titulo: campos.titulo,
      descricao: campos.descricao,
      at: campos.at,
      href: campos.href,
      acaoLabel: campos.acaoLabel,
    });
  };
}

/**
 * Permissão mínima por categoria do sino. Sem isto, um operador de caixa via
 * alerta de margem, custo e ruptura — a mesma informação que a tela nega.
 */
const CATEGORIA_PERMISSAO: Record<AlertCategory, Permissao> = {
  criticos: "estoque.ver",
  operacao: "estoque.ver",
  consumo: "estoque.ver",
  inventario: "estoque.inventario",
  financeiro: "relatorio.financeiro",
  inteligencia: "relatorio.ver",
};

const podeVerCategoria = (acessos: Acesso[], c: AlertCategory) =>
  podeEmAlguma(acessos, CATEGORIA_PERMISSAO[c]);

const DIA = 86_400_000;

/** Nota importada e não conferida por mais que isso vira alerta. */
const NOTA_PARADA_MS = 2 * DIA;
/** Antecedência do aviso de vencimento do certificado A1. */
const CERTIFICADO_AVISO_DIAS = 30;

/** Janela de carência após o cadastro — não incomoda o operador com alertas
 *  de estoque/preço/custo enquanto ele ainda está terminando de configurar. */
const GRACA_NOVO = DIA;

/**
 * Central de alertas — tudo que exige atenção do operador, computado ao vivo
 * sobre os dados de estoque, compras e inventário (só leitura, via `db`). O que
 * precisa de série histórica de vendas/consumo aberto (Inteligência, Consumo)
 * ainda não entra — o painel só renderiza as categorias com alertas.
 *
 * SEM filtro de usuário: devolve tudo que o TENANT quer receber (tipos
 * desligados em Configurações → Notificações já não nascem). Quem corta por
 * permissão de cada pessoa é `filtrarAlertas`.
 *
 * O que cada alerta É (categoria, prioridade, ícone, em que estratégia existe)
 * mora em `lib/alertas/catalogo`. Aqui só se decide QUANDO ele nasce — e, no
 * caso do estoque, nem isso: a régua é `alertaDeEstoque`, compartilhada com o
 * dashboard e com a sugestão de compra.
 *
 * A separação existe porque há dois consumidores com necessidades opostas: o
 * sino, que quer os alertas de UMA pessoa, e o job de push, que precisa
 * computar UMA vez por tenant e depois filtrar para cada inscrito — sem isso,
 * cinco operadores custariam cinco vezes as consultas pesadas daqui.
 *
 * Precisa rodar dentro de `runWithTenant` — é o chamador que abre o contexto.
 */
export async function computarAlertas(tenant: Tenant): Promise<AlertItem[]> {
  const agora = Date.now();
  const paradoMs = (tenant.produtoParadoDias || 45) * DIA;
  const novoSemMovMs = (tenant.novoSemMovDias || 7) * DIA;
  const inventarioAtrasoMs = (tenant.inventarioAtrasoDias || 3) * DIA;
  const policy = policyDoTenant(tenant);
  const prefs = resolverAlertas(tenant, policy);
  const emitir = criarEmissor(prefs);

  // No modo rotatividade o alerta de estoque nasce do giro. Duas leituras
  // extras, e só nessa estratégia: o consumo da janela (por produto E ponto,
  // porque cobertura é de prateleira) e o tamanho do histórico — sem histórico
  // suficiente a média diária é chute, e chute não acorda ninguém.
  const [consumoJanela, diasHistorico] = policy.usaGiro
    ? await Promise.all([
        consumoPorProdutoSite(policy.periodoMediaDias),
        diasDeHistoricoVendas(),
      ])
    : [new Map<string, number>(), null];

  // Aprendendo: emite só o que independe de giro (saldo negativo e zerado).
  const aprendendo = estaAprendendo(policy, diasHistorico);

  const semDocumentoMs = (tenant.entradaSemDocumentoDias || 3) * DIA;
  const saldoPendenteMs = (tenant.saldoPendenteDias || 5) * DIA;

  const janelaValidade = new Date(agora + (tenant.validadeAlertaDias || 30) * DIA);
  const olhaValidade = prefs["validade-vencida"].ligado || prefs["validade-proxima"].ligado;

  const [
    produtos,
    movs,
    inventarios,
    transferencias,
    pedidos,
    sites,
    lotes,
    notasParadas,
    caixasComFalha,
    certificados,
    cotacoes,
    entradasSemDocumento,
    pedidosSemDecisao,
    titulosVencidos,
  ] = await Promise.all([
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
        controlaEstoque: true,
        stocks: {
          select: {
            siteId: true,
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
      where: { status: { in: ["RASCUNHO", "ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] } },
      select: {
        id: true,
        numero: true,
        status: true,
        createdAt: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    }),
    // Nome do ponto de estoque: uma consulta, não um join por linha de saldo.
    db.site.findMany({ select: { id: true, nome: true } }),
    olhaValidade
      ? db.stockLot.findMany({
          where: { quantidade: { gt: 0 }, validade: { not: null, lte: janelaValidade } },
          select: {
            siteId: true,
            productId: true,
            validade: true,
            quantidade: true,
            product: { select: { nome: true } },
          },
        })
      : Promise.resolve([]),
    // Nota que entrou e ninguém conferiu. O XML sozinho não move estoque —
    // até a conferência, o saldo do sistema está mentindo para menos.
    db.fiscalInbound.findMany({
      where: {
        status: { in: ["PENDENTE", "CONCILIADO"] },
        createdAt: { lt: new Date(agora - NOTA_PARADA_MS) },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        id: true,
        numero: true,
        emitRazaoSocial: true,
        valorTotal: true,
        createdAt: true,
        siteId: true,
      },
    }),
    db.fiscalEmailInbox.findMany({
      where: { ativo: true, ultimoErro: { not: null } },
      select: { id: true, nome: true, email: true, ultimoErro: true, ultimaSincronizacao: true },
    }),
    db.fiscalEmitente.findMany({
      where: { certificadoValidade: { not: null } },
      select: { siteId: true, certificadoValidade: true, site: { select: { nome: true } } },
    }),
    // Cotações abertas: o alerta nasce da CONTAGEM de convites, a mesma régua
    // que a tela usa para dizer "2 de 4 responderam".
    db.quotation.findMany({
      where: { status: "ABERTA" },
      select: {
        id: true,
        numero: true,
        prazoResposta: true,
        enviadaEm: true,
        createdAt: true,
        siteId: true,
        suppliers: { select: { status: true } },
      },
    }),
    // ── Documento de Compra ──────────────────────────────────
    // Entrada lançada à mão que ainda espera o XML. É a pendência mais cara de
    // descobrir tarde: quando a nota chega e alguém recebe, o estoque dobra.
    db.purchase.findMany({
      where: {
        aguardandoDocumento: true,
        chaveNfe: null,
        data: { lt: new Date(agora - semDocumentoMs) },
      },
      orderBy: { data: "asc" },
      take: 20,
      select: {
        id: true,
        data: true,
        siteId: true,
        numeroNota: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        items: { select: { custoTotal: true } },
      },
    }),
    // Pedido parcial que ninguém resolveu: o resto vem, não vem, ou virou
    // pedido novo? Sem decisão ele fica na fila para sempre.
    db.purchaseOrder.findMany({
      where: {
        status: "RECEBIDO_PARCIAL",
        saldoResolucao: "PENDENTE",
        updatedAt: { lt: new Date(agora - saldoPendenteMs) },
      },
      orderBy: { updatedAt: "asc" },
      take: 20,
      select: {
        id: true,
        numero: true,
        siteId: true,
        updatedAt: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        items: { select: { qtdPedida: true, qtdRecebida: true, custoUnitario: true } },
      },
    }),
    // Conta a pagar que passou do vencimento. Agrupa por fornecedor no emissor:
    // dez parcelas do mesmo distribuidor são UM problema, não dez alertas.
    db.accountPayable.findMany({
      where: { status: "ABERTO", vencimento: { lt: new Date() } },
      orderBy: { vencimento: "asc" },
      take: 100,
      select: {
        supplierId: true,
        vencimento: true,
        valor: true,
        valorPago: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    }),
  ]);

  // Com uma loja só, dizer o nome dela em todo alerta é ruído; com duas, é a
  // primeira coisa que a pessoa precisa saber.
  const nomeSite = new Map(sites.map((s) => [s.id, s.nome]));
  const multiSite = sites.length > 1;
  const comLocal = (siteId: string | null, texto: string) => {
    const nome = siteId ? nomeSite.get(siteId) : null;
    return multiSite && nome ? `${nome} — ${texto}` : texto;
  };

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
    const total = p.stocks.reduce((s, e) => s + n(e.estoqueFechado) + n(e.estoqueAberto), 0);

    // Saldo é POR PONTO DE ESTOQUE. Somar as lojas escondia ruptura: a sobra
    // no CD apagava a prateleira vazia da loja, e o alerta que chegasse
    // mandaria a pessoa olhar o lugar errado.
    if (p.controlaEstoque) {
      for (const st of p.stocks) {
        const saldo = n(st.estoqueFechado) + n(st.estoqueAberto);
        // Fora da rotatividade a média fica em zero — estratégia de meta fixa
        // não notifica por giro (ver `alertaDeEstoque`).
        const mediaDia =
          policy.usaGiro && !aprendendo
            ? mediaDiaria(
                consumoJanela.get(chaveProdutoSite(p.id, st.siteId)) ?? 0,
                policy.periodoMediaDias,
              )
            : 0;
        const nivel = alertaDeEstoque(policy, {
          estoque: saldo,
          minimo: n(st.estoqueMinimo),
          ideal: n(st.estoqueIdeal),
          mediaDia,
        });
        if (!nivel) continue;
        emitir(alerts, nivel.kind, `${p.id}:${st.siteId}`, {
          titulo: p.nome,
          descricao: comLocal(st.siteId, nivel.descricao),
          href,
          acaoLabel: abrir,
        });
      }
    }

    if (p.precoVenda == null && p.tipo !== "INSUMO") {
      emitir(alerts, "sem-preco", p.id, {
        titulo: p.nome,
        descricao: "Sem preço de venda — não pode ser vendido.",
        href,
        acaoLabel: abrir,
      });
    }

    if (p.custo == null && p.custoMedio == null) {
      emitir(alerts, "sem-custo", p.id, {
        titulo: p.nome,
        descricao: "Sem custo cadastrado — margem indefinida.",
        href,
        acaoLabel: abrir,
      });
    }

    const ultimo = ultimoMov.get(p.id);
    if (ultimo == null && criadoHa <= novoSemMovMs) {
      emitir(alerts, "novo-sem-mov", p.id, {
        titulo: p.nome,
        descricao: "Recém cadastrado, ainda sem movimentação.",
        at: new Date(p.createdAt).toISOString(),
        href,
        acaoLabel: abrir,
      });
    } else if (p.controlaEstoque && ultimo != null && agora - ultimo >= paradoMs && total > 0) {
      const dias = Math.round((agora - ultimo) / DIA);
      emitir(alerts, "parado", p.id, {
        titulo: p.nome,
        descricao: `Estoque parado há ${dias} dias.`,
        at: new Date(ultimo).toISOString(),
        href,
        acaoLabel: abrir,
      });
    }
  }

  // ── Validade dos lotes ─────────────────────────────────────
  // Um alerta por produto e ponto, não por lote: cinco caixas do mesmo leite
  // vencendo na mesma prateleira são uma ida até lá, não cinco.
  if (lotes.length > 0) {
    type Agregado = { nome: string; siteId: string; lotes: number; unidades: number };
    const vencidos = new Map<string, Agregado>();
    const proximos = new Map<string, Agregado>();
    for (const l of lotes) {
      if (!l.validade) continue;
      const alvo = l.validade.getTime() < agora ? vencidos : proximos;
      const chave = `${l.productId}:${l.siteId}`;
      const atual =
        alvo.get(chave) ?? { nome: l.product.nome, siteId: l.siteId, lotes: 0, unidades: 0 };
      atual.lotes += 1;
      atual.unidades += n(l.quantidade);
      alvo.set(chave, atual);
    }

    const plural = (q: number, um: string, muitos: string) => (q === 1 ? um : muitos);

    for (const [chave, a] of vencidos) {
      emitir(alerts, "validade-vencida", chave, {
        titulo: a.nome,
        descricao: comLocal(
          a.siteId,
          `${a.lotes} ${plural(a.lotes, "lote vencido", "lotes vencidos")} · ${fmtQtd(a.unidades)} ${plural(a.unidades, "unidade", "unidades")} — retire da prateleira e dê baixa.`,
        ),
        href: "/estoque/validade",
        acaoLabel: "Ver validade",
      });
    }
    for (const [chave, a] of proximos) {
      // Vencido manda; o mesmo produto não pede atenção duas vezes no mesmo ponto.
      if (vencidos.has(chave)) continue;
      emitir(alerts, "validade-proxima", chave, {
        titulo: a.nome,
        descricao: comLocal(
          a.siteId,
          `${fmtQtd(a.unidades)} ${plural(a.unidades, "unidade perto de vencer", "unidades perto de vencer")} — priorize a saída.`,
        ),
        href: "/estoque/validade",
        acaoLabel: "Ver validade",
      });
    }
  }

  // ── Inventário ─────────────────────────────────────────────
  for (const inv of inventarios) {
    const atrasado = agora - new Date(inv.createdAt).getTime() >= inventarioAtrasoMs;
    emitir(alerts, "inventario", inv.id, {
      // Atraso não muda o tipo do alerta, muda a urgência dele.
      prioridade: atrasado ? "alto" : undefined,
      titulo: atrasado ? "Inventário atrasado" : "Inventário em aberto",
      descricao: `${inv.site.nome} — contagem ainda não fechada.`,
      at: new Date(inv.createdAt).toISOString(),
      href: "/estoque/inventarios",
      acaoLabel: "Ver inventário",
    });
  }

  // ── Transferências aguardando confirmação ──────────────────
  for (const t of transferencias) {
    emitir(alerts, "transferencia", t.id, {
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
    if (pc.status === "AGUARDANDO" || pc.status === "EM_TRANSITO" || pc.status === "RECEBIDO_PARCIAL") {
      emitir(alerts, "recebimento", pc.id, {
        titulo: "Entrada aguardando conferência",
        descricao: `${pc.numero} · ${fornecedor}`,
        at: new Date(pc.createdAt).toISOString(),
        href: "/pedidos",
        acaoLabel: "Conferir",
      });
    } else {
      emitir(alerts, "compra", pc.id, {
        // Rascunho é lembrete, pedido enviado é compromisso com dinheiro.
        prioridade: pc.status === "ENVIADO" ? undefined : "baixo",
        titulo: pc.status === "ENVIADO" ? "Compra pendente" : "Pedido em rascunho",
        descricao: `${pc.numero} · ${fornecedor}`,
        at: new Date(pc.createdAt).toISOString(),
        href: "/pedidos",
        acaoLabel: "Abrir",
      });
    }
  }

  // ── Cotações abertas ───────────────────────────────────────
  for (const c of cotacoes) {
    const total = c.suppliers.length;
    if (total === 0) continue;
    const respondidos = c.suppliers.filter((s) => s.status === "RESPONDIDA").length;
    const pendentes = c.suppliers.filter(
      (s) => s.status === "PENDENTE" || s.status === "ENVIADA",
    ).length;
    const href = `/cotacoes/${c.id}`;
    const quando = new Date(c.enviadaEm ?? c.createdAt).toISOString();

    // Todo mundo já falou: o trabalho agora é decidir, não esperar.
    if (pendentes === 0 && respondidos > 0) {
      emitir(alerts, "cotacao-resposta", c.id, {
        titulo: "Cotação pronta para comparar",
        descricao: comLocal(
          c.siteId,
          `${c.numero} · ${respondidos} ${respondidos === 1 ? "fornecedor respondeu" : "fornecedores responderam"} — escolha o melhor preço.`,
        ),
        at: quando,
        href,
        acaoLabel: "Comparar",
      });
      continue;
    }

    // Prazo no fim com gente devendo resposta: dá tempo de cobrar hoje.
    if (pendentes > 0 && c.prazoResposta) {
      const faltaMs = new Date(c.prazoResposta).getTime() - agora;
      if (faltaMs < DIA) {
        emitir(alerts, "cotacao-prazo", c.id, {
          prioridade: faltaMs < 0 ? "alto" : undefined,
          titulo: faltaMs < 0 ? "Prazo da cotação venceu" : "Cotação termina hoje",
          descricao: comLocal(
            c.siteId,
            `${c.numero} · ${pendentes} ${pendentes === 1 ? "fornecedor ainda não respondeu" : "fornecedores ainda não responderam"}.`,
          ),
          at: new Date(c.prazoResposta).toISOString(),
          href,
          acaoLabel: "Cobrar",
        });
      }
    }
  }

  // ── Documento de Compra: o que entrou sem fechar o ciclo ───
  for (const entrada of entradasSemDocumento) {
    const dias = Math.floor((agora - entrada.data.getTime()) / DIA);
    const valor = entrada.items.reduce((a, i) => a + Number(i.custoTotal), 0);
    const fornecedor =
      entrada.supplier?.nomeFantasia || entrada.supplier?.razaoSocial || "sem fornecedor";
    emitir(alerts, "entrada-sem-documento", entrada.id, {
      titulo: "Entrada sem documento fiscal",
      descricao: comLocal(
        entrada.siteId,
        `${fornecedor} · ${fmtBRL(valor)} — lançada à mão há ${dias} dias e o XML não chegou.`,
      ),
      at: entrada.data.toISOString(),
      href: "/fiscal/notas-recebidas",
      acaoLabel: "Procurar a nota",
    });
  }

  for (const pedido of pedidosSemDecisao) {
    const dias = Math.floor((agora - pedido.updatedAt.getTime()) / DIA);
    const falta = pedido.items.reduce(
      (a, i) => a + Math.max(0, Number(i.qtdPedida) - Number(i.qtdRecebida)) * Number(i.custoUnitario),
      0,
    );
    const fornecedor = pedido.supplier.nomeFantasia || pedido.supplier.razaoSocial;
    emitir(alerts, "saldo-pendente", pedido.id, {
      titulo: "Saldo de pedido sem decisão",
      descricao: comLocal(
        pedido.siteId,
        `${pedido.numero} · ${fornecedor} — faltam ${fmtBRL(falta)} há ${dias} dias. O resto vem?`,
      ),
      at: pedido.updatedAt.toISOString(),
      href: "/pedidos",
      acaoLabel: "Resolver saldo",
    });
  }

  // Um alerta por FORNECEDOR: dez parcelas vencidas do mesmo distribuidor são
  // uma conversa só, e dez linhas no sino esconderiam os outros avisos.
  const vencidoPorFornecedor = new Map<
    string,
    { nome: string; total: number; parcelas: number; maisAntigo: Date }
  >();
  for (const t of titulosVencidos) {
    const chave = t.supplierId ?? "sem-fornecedor";
    const nome = t.supplier?.nomeFantasia || t.supplier?.razaoSocial || "Fornecedor não informado";
    const saldo = Math.max(0, Number(t.valor) - Number(t.valorPago));
    const atual = vencidoPorFornecedor.get(chave);
    if (atual) {
      atual.total += saldo;
      atual.parcelas += 1;
      if (t.vencimento < atual.maisAntigo) atual.maisAntigo = t.vencimento;
    } else {
      vencidoPorFornecedor.set(chave, {
        nome,
        total: saldo,
        parcelas: 1,
        maisAntigo: t.vencimento,
      });
    }
  }
  for (const [chave, v] of vencidoPorFornecedor) {
    const dias = Math.floor((agora - v.maisAntigo.getTime()) / DIA);
    emitir(alerts, "titulo-vencido", chave, {
      titulo: v.parcelas === 1 ? "Título vencido" : `${v.parcelas} títulos vencidos`,
      descricao: `${v.nome} · ${fmtBRL(v.total)} em aberto — o mais antigo venceu há ${dias} dia(s).`,
      at: v.maisAntigo.toISOString(),
      href: "/financeiro/contas-a-pagar?status=VENCIDO",
      acaoLabel: "Ver contas",
    });
  }

  // ── Entrada de NF-e: a automação está viva? ────────────────
  for (const nota of notasParadas) {
    const dias = Math.floor((agora - new Date(nota.createdAt).getTime()) / DIA);
    emitir(alerts, "nota-parada", nota.id, {
      titulo: "Nota esperando conferência",
      descricao: comLocal(
        nota.siteId,
        `NF ${nota.numero} · ${nota.emitRazaoSocial} — importada há ${dias} dias e ainda sem entrada.`,
      ),
      at: new Date(nota.createdAt).toISOString(),
      href: `/recebimento/${nota.id}`,
      acaoLabel: "Conferir",
    });
  }

  for (const caixa of caixasComFalha) {
    emitir(alerts, "canal-nfe", caixa.id, {
      titulo: "Caixa de e-mail sem conectar",
      descricao: `${caixa.nome} (${caixa.email}) — ${caixa.ultimoErro ?? "falha na última verificação"}`,
      at: caixa.ultimaSincronizacao?.toISOString(),
      href: "/configuracoes/notas-fiscais",
      acaoLabel: "Revisar conta",
    });
  }

  for (const cert of certificados) {
    const validade = cert.certificadoValidade;
    if (!validade) continue;
    const dias = Math.ceil((validade.getTime() - agora) / DIA);
    if (dias > CERTIFICADO_AVISO_DIAS) continue;

    emitir(alerts, "certificado", cert.siteId, {
      // Vencido não é aviso, é parada de operação: nada é emitido nem consultado.
      prioridade: dias <= 0 ? "critico" : undefined,
      titulo: dias <= 0 ? "Certificado A1 vencido" : "Certificado A1 vencendo",
      descricao: comLocal(
        cert.siteId,
        dias <= 0
          ? "Sem certificado válido não há emissão nem consulta de notas na SEFAZ."
          : `Vence em ${dias} dia(s) — renove antes de parar a emissão.`,
      ),
      href: "/configuracoes/notas-fiscais",
      acaoLabel: "Ver certificado",
    });
  }

  // ── Fidelização: cupons sugeridos (risco / aniversário) ────
  // A consulta só se paga se pelo menos um dos dois avisos estiver ligado.
  if (prefs.aniversario.ligado || prefs["cliente-risco"].ligado) {
    const candidatos = await loadCouponCandidates(tenant.cupomDiasRisco);
    for (const c of candidatos) {
      if (c.jaEnviado) continue;
      if (c.tipo === "ANIVERSARIO") {
        emitir(alerts, "aniversario", c.customerId, {
          titulo: c.nome,
          descricao: `Faz aniversário (${c.aniversario}) — envie um cupom de presente.`,
          href: "/clientes",
          acaoLabel: "Enviar cupom",
        });
      } else {
        emitir(alerts, "cliente-risco", c.customerId, {
          titulo: c.nome,
          descricao: `Cliente sem comprar há ${c.dias} dias — recupere com um cupom.`,
          href: "/clientes",
          acaoLabel: "Enviar cupom",
        });
      }
    }
  }

  return alerts;
}

/** O que `filtrarAlertas` precisa saber do Tenant. */
export type TenantFiltro = Pick<
  Tenant,
  | "alertasDesativados"
  | "alertasConfig"
  | "tipoControleEstoque"
  | "periodoMediaDias"
  | "diasCobertura"
  | "coberturaCriticaPct"
>;

/**
 * Corta os alertas para UMA pessoa: permissão por categoria, e — como rede de
 * segurança — tipos que a empresa desligou ou que não existem na estratégia
 * ativa. O motor já não gera nenhum dos dois; o corte aqui garante que uma
 * lista computada antes de uma troca de configuração não vaze pelo caminho.
 *
 * Puro e síncrono de propósito — o job de push chama isto uma vez por inscrito
 * sobre a mesma lista computada.
 */
export function filtrarAlertas(
  alerts: AlertItem[],
  tenant: TenantFiltro,
  acessos: Acesso[],
): AlertItem[] {
  const prefs = resolverAlertas(tenant, policyDoTenant(tenant));
  const visiveis = alerts.filter((a) => {
    const kind = kindDeAlerta(a.id);
    if (kind && !prefs[kind].ligado) return false;
    return podeVerCategoria(acessos, a.category);
  });
  return sortAlerts(visiveis);
}
