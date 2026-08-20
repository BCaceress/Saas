import { db } from "@/lib/prisma";
import { sinaisDosLinks } from "@/lib/compras/cotacao-link";
import type {
  CanalResposta,
  EstadoResposta,
  RespostaRow,
  ResumoRespostas,
} from "./_types";

// ============================================================
// Central de Respostas — a caixa de entrada do módulo de Compras.
//
// O problema que ela resolve: hoje a informação de preço chega por caminhos
// diferentes (link da cotação, arquivo importado, API, transcrição do
// operador) e cada caminho tinha sua própria tela. Quem compra não pensa em
// "importações" e "cotações" — pensa em "quem já me respondeu e quem não".
//
// Por isso aqui as duas fontes viram UMA lista ordenada por quando chegou.
// Nada é gravado nesta tela: ela só junta e manda para o lugar certo.
// ============================================================

const LIMITE = 120;

const n = (v: unknown) => Number(v ?? 0);

/** Rótulo do arquivo/integração que originou a importação. */
const CANAL_POR_KIND: Record<string, CanalResposta> = {
  API: "API",
  PLANILHA: "ARQUIVO",
  CSV: "ARQUIVO",
  PDF: "ARQUIVO",
  IMAGEM: "ARQUIVO",
  XML: "ARQUIVO",
  JSON: "ARQUIVO",
  MANUAL: "OPERADOR",
};

const KIND_LABEL: Record<string, string> = {
  API: "integração",
  PLANILHA: "planilha",
  CSV: "CSV",
  PDF: "PDF",
  IMAGEM: "imagem",
  XML: "XML",
  JSON: "JSON",
  MANUAL: "digitado",
};

function inicioDeHoje(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Cotações ────────────────────────────────────────────────

async function linhasDeCotacao(): Promise<RespostaRow[]> {
  // Só cotação viva: rascunho ainda não perguntou nada, e cancelada não espera
  // resposta de ninguém.
  const convites = await db.quotationSupplier.findMany({
    where: {
      status: { in: ["ENVIADA", "RESPONDIDA", "RECUSADA"] },
      quotation: { status: { in: ["ABERTA", "ENCERRADA", "DECIDIDA"] } },
    },
    orderBy: [{ respondidaEm: "desc" }, { enviadaEm: "desc" }],
    take: LIMITE,
    select: {
      id: true,
      supplierId: true,
      status: true,
      respondidaVia: true,
      enviadaEm: true,
      respondidaEm: true,
      frete: true,
      observacao: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      responses: {
        select: { quotationItemId: true, disponivel: true, precoUnitario: true },
      },
      quotation: {
        select: {
          id: true,
          numero: true,
          titulo: true,
          prazoResposta: true,
          items: { select: { id: true, quantidade: true } },
        },
      },
    },
  });

  // Sinal de leitura do link: separa "ignorou" de "abriu e está pensando".
  // Vem de QuotationLink (tabela de controle, ver lib/compras/cotacao-link).
  const sinais = await sinaisDosLinks(convites.map((c) => c.id));

  return convites.map((c) => {
    const quantidades = new Map(c.quotation.items.map((i) => [i.id, n(i.quantidade)]));
    const disponiveis = c.responses.filter((r) => r.disponivel);
    const total =
      disponiveis.reduce(
        (acc, r) => acc + n(r.precoUnitario) * (quantidades.get(r.quotationItemId) ?? 0),
        0,
      ) + n(c.frete);

    const totalItens = c.quotation.items.length;
    const naoCotados = totalItens - disponiveis.length;

    let estado: EstadoResposta;
    if (c.status === "RECUSADA") estado = "RECUSADO";
    else if (c.status === "RESPONDIDA") estado = naoCotados > 0 ? "REVISAR" : "CHEGOU";
    else estado = sinais.get(c.id)?.abertoEm ? "LIDO" : "AGUARDANDO";

    const canal: CanalResposta =
      c.status === "ENVIADA"
        ? "LINK"
        : c.respondidaVia === "OPERADOR"
          ? "OPERADOR"
          : "LINK";

    const detalhe =
      c.status === "RECUSADA"
        ? (c.observacao ?? "Não vai cotar desta vez")
        : c.status === "RESPONDIDA"
          ? `${disponiveis.length} de ${totalItens} itens cotados`
          : estado === "LIDO"
            ? "Abriu o link e ainda não respondeu"
            : `${totalItens} itens · aguardando`;

    return {
      id: `cot-${c.id}`,
      origem: "cotacao" as const,
      supplierId: c.supplierId,
      supplierNome: c.supplier.nomeFantasia ?? c.supplier.razaoSocial,
      canal,
      estado,
      titulo: `Cotação ${c.quotation.numero} — ${c.quotation.titulo}`,
      detalhe,
      quando: (c.respondidaEm ?? c.enviadaEm ?? new Date()).toISOString(),
      href: `/cotacoes/${c.quotation.id}`,
      pendencias: c.status === "RESPONDIDA" ? naoCotados : 0,
      valor: c.status === "RESPONDIDA" ? total : null,
    };
  });
}

// ── Importações de tabela ───────────────────────────────────

async function linhasDeImportacao(): Promise<RespostaRow[]> {
  const imports = await db.supplierImport.findMany({
    // `origem: "cotacao"` é o rastro de uma resposta de RFQ virando preço no
    // catálogo — a linha da cotação já conta esse fato. Mostrar as duas seria
    // a caixa de entrada repetindo a mesma notícia com dois títulos.
    where: { origem: { not: "cotacao" } },
    orderBy: { createdAt: "desc" },
    take: LIMITE,
    select: {
      id: true,
      supplierId: true,
      tipo: true,
      origem: true,
      arquivoNome: true,
      status: true,
      itensLidos: true,
      itensNovos: true,
      itensAtualizados: true,
      itensSemVinculo: true,
      mensagem: true,
      createdAt: true,
      concluidoEm: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
    },
  });

  return imports.map((i) => {
    let estado: EstadoResposta;
    if (i.status === "PENDENTE" || i.status === "PROCESSANDO") estado = "PROCESSANDO";
    else if (i.status === "FALHOU") estado = "ERRO";
    else if (i.status === "CONCLUIDA_COM_ERROS" || i.itensSemVinculo > 0) estado = "REVISAR";
    else estado = "CHEGOU";

    const detalhe =
      estado === "PROCESSANDO"
        ? "Lendo o arquivo…"
        : estado === "ERRO"
          ? (i.mensagem ?? "A leitura falhou")
          : `${i.itensLidos} itens · ${i.itensNovos} novos · ${i.itensAtualizados} atualizados` +
            (i.itensSemVinculo > 0 ? ` · ${i.itensSemVinculo} sem vínculo` : "");

    return {
      id: `imp-${i.id}`,
      origem: "importacao" as const,
      supplierId: i.supplierId,
      supplierNome: i.supplier.nomeFantasia ?? i.supplier.razaoSocial,
      canal: i.origem === "api" || i.origem === "agendado" ? "API" : CANAL_POR_KIND[i.tipo] ?? "ARQUIVO",
      estado,
      titulo: i.arquivoNome ?? `Tabela por ${KIND_LABEL[i.tipo] ?? "arquivo"}`,
      detalhe,
      quando: (i.concluidoEm ?? i.createdAt).toISOString(),
      // Item sem vínculo é o único trabalho que sobra de uma importação — e é
      // no catálogo do fornecedor, já filtrado, que ele se resolve.
      href:
        i.itensSemVinculo > 0
          ? `/fornecedores/${i.supplierId}/catalogo?pendentes=1`
          : `/fornecedores/${i.supplierId}/catalogo`,
      pendencias: i.itensSemVinculo,
      valor: null,
    };
  });
}

// ── Caixa de entrada ────────────────────────────────────────

export async function loadRespostas(): Promise<{
  linhas: RespostaRow[];
  resumo: ResumoRespostas;
}> {
  const [cotacoes, importacoes] = await Promise.all([
    linhasDeCotacao(),
    linhasDeImportacao(),
  ]);

  const linhas = [...cotacoes, ...importacoes]
    .sort((a, b) => b.quando.localeCompare(a.quando))
    .slice(0, LIMITE);

  const hoje = inicioDeHoje();
  const respondidas = linhas.filter(
    (l) => l.estado !== "AGUARDANDO" && l.estado !== "LIDO" && l.estado !== "PROCESSANDO",
  );

  return {
    linhas,
    resumo: {
      aguardando: linhas.filter((l) => l.estado === "AGUARDANDO" || l.estado === "LIDO").length,
      chegaramHoje: respondidas.filter((l) => new Date(l.quando).getTime() >= hoje).length,
      precisamRevisao: linhas.filter((l) => l.estado === "REVISAR" || l.estado === "ERRO").length,
      ultimaEm: respondidas[0]?.quando ?? null,
    },
  };
}
