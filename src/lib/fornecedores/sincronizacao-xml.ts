import "server-only";
import { db } from "@/lib/prisma";
import type { NotaXml } from "@/lib/fiscal/nfe-xml";

// ============================================================
// Sincronização inteligente do fornecedor pelo XML da NF-e.
//
// Toda nota que entra é um cadastro atualizado de graça: o bloco `emit` vem
// da SEFAZ, não da digitação de ninguém. Este módulo aproveita isso em três
// camadas, e a fronteira entre elas é a regra que manda no desenho:
//
//   AUTOMÁTICO — dado oficial (razão social, fantasia, IE, CRT, endereço).
//                Quem manda nele é a Receita; o operador não tem o que decidir.
//   SUGESTÃO   — telefone e e-mail. O XML traz o canal do FATURAMENTO; o
//                cadastro guarda o canal do VENDEDOR. Sobrescrever calado
//                mandaria a próxima cotação para o 0800 da matriz.
//   HISTÓRICO  — última compra, itens fornecidos, prazo praticado. Não mexe
//                no cadastro: constrói o relacionamento que as cotações usam.
//
// Tudo o que acontece vira linha em SupplierSyncChange — é o mesmo registro
// que alimenta a fila de sugestões e a trilha de alterações da ficha.
//
// Assume contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantas notas entram na média do prazo praticado. */
const NOTAS_PARA_PRAZO = 10;

export type AlteracaoSync = {
  id: string;
  campo: string;
  rotulo: string;
  antes: string | null;
  depois: string | null;
};

export type ResumoSincronizacao = {
  supplierId: string;
  nome: string;
  cnpj: string;
  /** O fornecedor não existia e nasceu desta nota. */
  criado: boolean;
  /** Dado oficial já gravado — a tela só informa. */
  automaticas: AlteracaoSync[];
  /** Esperando decisão do operador. Inclui pendências de notas anteriores. */
  sugestoes: AlteracaoSync[];
  historico: {
    notaNumero: string;
    dataEmissao: string;
    valorTotal: number;
    /** Itens do XML que nunca tinham vindo deste fornecedor. */
    produtosNovos: number;
    produtosTotal: number;
    /** Prazo praticado recalculado com esta nota. Null = notas à vista. */
    prazoMedioDias: number | null;
  };
};

/** Endereço como uma coisa só: mudar de rua muda 6 colunas de uma vez. */
type Endereco = {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoMunicipio: string | null;
  uf: string | null;
};

const enderecoDaNota = (e: NotaXml["emitente"]): Endereco => ({
  cep: e.cep,
  logradouro: e.logradouro,
  numero: e.numero,
  complemento: e.complemento,
  bairro: e.bairro,
  municipio: e.municipio,
  codigoMunicipio: e.codigoMunicipio,
  uf: e.uf,
});

function enderecoEmUmaLinha(e: Partial<Endereco>): string | null {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const partes = [rua, e.bairro, [e.municipio, e.uf].filter(Boolean).join("/")].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : null;
}

const CRT_LABEL: Record<number, string> = {
  1: "Simples Nacional",
  2: "Simples Nacional — excesso de sublimite",
  3: "Regime normal",
  4: "MEI",
};

const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Telefone do XML vem sem máscara e às vezes sem DDD. Comparar formatado
 * apontaria mudança onde só houve máscara diferente.
 */
const mesmoTelefone = (a: string | null, b: string | null) => soDigitos(a) === soDigitos(b);

type Pendente = {
  campo: string;
  rotulo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
};

/**
 * Cria/atualiza o fornecedor do XML e devolve o que mudou.
 *
 * O cadastro nunca trava a nota: importar é o objetivo, e um nome fantasia
 * desatualizado não pode impedir a entrada de estoque.
 */
export async function sincronizarFornecedorComNota(input: {
  tenantId: string;
  nota: NotaXml;
  userId?: string | null;
}): Promise<{ supplierId: string; resumo: ResumoSincronizacao }> {
  const { tenantId, nota, userId } = input;
  const emit = nota.emitente;
  const notaNumero = `${nota.numero}/${nota.serie}`;

  const existente = await db.supplier.findFirst({
    where: { cnpj: emit.cnpj },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      ie: true,
      crt: true,
      telefone: true,
      email: true,
      cep: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      municipio: true,
      codigoMunicipio: true,
      uf: true,
    },
  });

  const endereco = enderecoDaNota(emit);

  // ── Fornecedor novo: o XML É o cadastro ─────────────────
  if (!existente) {
    const criado = await db.supplier.create({
      data: {
        tenantId,
        cnpj: emit.cnpj,
        razaoSocial: emit.razaoSocial,
        nomeFantasia: emit.nomeFantasia,
        ie: emit.ie,
        crt: emit.crt,
        telefone: emit.telefone,
        ...endereco,
      },
      select: { id: true },
    });

    // O e-mail do XML é do fiscal — vira contato identificado como tal, nunca
    // o e-mail "da empresa" que a cotação usaria como destino padrão.
    if (emit.email) {
      await db.supplierContact.create({
        data: {
          tenantId,
          supplierId: criado.id,
          nome: "Contato fiscal",
          cargo: "Faturamento",
          email: emit.email,
          observacao: `Encontrado no XML da NF-e ${notaNumero}.`,
          principal: false,
        },
      });
    }

    const automaticas = await registrar(tenantId, criado.id, nota, "AUTOMATICO", "APLICADA", [
      {
        campo: "cadastro",
        rotulo: "Fornecedor criado a partir do XML",
        valorAnterior: null,
        valorNovo: emit.nomeFantasia ?? emit.razaoSocial,
      },
    ]);

    const historico = await atualizarHistorico({ tenantId, supplierId: criado.id, nota, userId });

    return {
      supplierId: criado.id,
      resumo: {
        supplierId: criado.id,
        nome: emit.nomeFantasia ?? emit.razaoSocial,
        cnpj: emit.cnpj,
        criado: true,
        automaticas,
        sugestoes: [],
        historico,
      },
    };
  }

  // ── Fornecedor conhecido: comparar campo a campo ────────
  const supplierId = existente.id;
  const dados: Record<string, unknown> = {};
  const mudancas: Pendente[] = [];

  const oficial = (
    campo: string,
    rotulo: string,
    atual: string | null,
    novo: string | null,
  ) => {
    if (!novo || novo === atual) return;
    dados[campo] = novo;
    mudancas.push({ campo, rotulo, valorAnterior: atual, valorNovo: novo });
  };

  oficial("razaoSocial", "Razão social atualizada", existente.razaoSocial, emit.razaoSocial);
  oficial("nomeFantasia", "Nome fantasia atualizado", existente.nomeFantasia, emit.nomeFantasia);
  oficial("ie", "Inscrição estadual atualizada", existente.ie, emit.ie);

  if (emit.crt != null && emit.crt !== existente.crt) {
    dados.crt = emit.crt;
    mudancas.push({
      campo: "crt",
      rotulo: "Regime tributário atualizado",
      valorAnterior:
        existente.crt == null ? null : (CRT_LABEL[existente.crt] ?? String(existente.crt)),
      valorNovo: CRT_LABEL[emit.crt] ?? String(emit.crt),
    });
  }

  // Endereço muda como bloco: rua nova com bairro velho é endereço que não
  // existe. Só entra quando a nota traz logradouro — XML incompleto não pode
  // apagar o que o operador digitou.
  if (emit.logradouro) {
    const diferente = (Object.keys(endereco) as (keyof Endereco)[]).some((k) => {
      const novo = endereco[k];
      if (!novo) return false;
      const atual = existente[k];
      return k === "cep" ? soDigitos(novo) !== soDigitos(atual) : novo !== atual;
    });
    if (diferente) {
      Object.assign(dados, endereco);
      mudancas.push({
        campo: "endereco",
        rotulo: "Endereço atualizado",
        valorAnterior: enderecoEmUmaLinha(existente),
        valorNovo: enderecoEmUmaLinha(endereco),
      });
    }
  }

  if (Object.keys(dados).length > 0) {
    await db.supplier.update({ where: { id: supplierId }, data: dados });
  }
  const automaticas = await registrar(
    tenantId,
    supplierId,
    nota,
    "AUTOMATICO",
    "APLICADA",
    mudancas,
  );

  // ── Sugestões: canal de contato ─────────────────────────
  const propostas: Pendente[] = [];

  if (emit.telefone && !mesmoTelefone(existente.telefone, emit.telefone)) {
    propostas.push({
      campo: "telefone",
      rotulo: existente.telefone ? "Telefone diferente do cadastro" : "Telefone encontrado no XML",
      valorAnterior: existente.telefone,
      valorNovo: emit.telefone,
    });
  }

  if (emit.email) {
    const jaConhecido =
      existente.email?.toLowerCase() === emit.email ||
      (await db.supplierContact.count({
        where: { supplierId, email: { equals: emit.email, mode: "insensitive" } },
      })) > 0;
    if (!jaConhecido) {
      propostas.push({
        campo: "email",
        rotulo: "E-mail encontrado no XML",
        valorAnterior: existente.email,
        valorNovo: emit.email,
      });
    }
  }

  await registrarSugestoes(tenantId, supplierId, nota, propostas);
  const historico = await atualizarHistorico({ tenantId, supplierId, nota, userId });

  // Pendências de notas anteriores entram no painel junto: quem clicou
  // "Revisar depois" na semana passada não deveria precisar caçá-las.
  const sugestoes = await listarSugestoesPendentes(supplierId);

  return {
    supplierId,
    resumo: {
      supplierId,
      nome: (dados.nomeFantasia as string) ?? existente.nomeFantasia ?? existente.razaoSocial,
      cnpj: emit.cnpj,
      criado: false,
      automaticas,
      sugestoes,
      historico,
    },
  };
}

/** Grava linhas da trilha e devolve no formato que a tela consome. */
async function registrar(
  tenantId: string,
  supplierId: string,
  nota: NotaXml,
  tipo: "AUTOMATICO" | "SUGESTAO" | "HISTORICO",
  status: "APLICADA" | "PENDENTE" | "IGNORADA",
  itens: Pendente[],
): Promise<AlteracaoSync[]> {
  if (itens.length === 0) return [];
  const notaNumero = `${nota.numero}/${nota.serie}`;

  const criadas: AlteracaoSync[] = [];
  for (const i of itens) {
    const linha = await db.supplierSyncChange.create({
      data: {
        tenantId,
        supplierId,
        chave: nota.chave,
        notaNumero,
        tipo,
        status,
        campo: i.campo,
        rotulo: i.rotulo,
        valorAnterior: i.valorAnterior,
        valorNovo: i.valorNovo,
      },
      select: { id: true },
    });
    criadas.push({
      id: linha.id,
      campo: i.campo,
      rotulo: i.rotulo,
      antes: i.valorAnterior,
      depois: i.valorNovo,
    });
  }
  return criadas;
}

/**
 * Sugestões com memória. A mesma nota chega duas vezes por canais diferentes,
 * e o fornecedor repete o mesmo 0800 em todas as notas do mês: recriar a
 * pergunta a cada importação viraria ruído — e reperguntar o que o operador já
 * recusou é pior ainda.
 */
async function registrarSugestoes(
  tenantId: string,
  supplierId: string,
  nota: NotaXml,
  propostas: Pendente[],
): Promise<AlteracaoSync[]> {
  const novas: Pendente[] = [];
  for (const p of propostas) {
    const jaPerguntada = await db.supplierSyncChange.count({
      where: {
        supplierId,
        tipo: "SUGESTAO",
        campo: p.campo,
        valorNovo: p.valorNovo,
        status: { in: ["PENDENTE", "IGNORADA"] },
      },
    });
    if (jaPerguntada === 0) novas.push(p);
  }
  return registrar(tenantId, supplierId, nota, "SUGESTAO", "PENDENTE", novas);
}

export async function listarSugestoesPendentes(supplierId: string): Promise<AlteracaoSync[]> {
  const linhas = await db.supplierSyncChange.findMany({
    where: { supplierId, tipo: "SUGESTAO", status: "PENDENTE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, campo: true, rotulo: true, valorAnterior: true, valorNovo: true },
  });
  return linhas.map((l) => ({
    id: l.id,
    campo: l.campo,
    rotulo: l.rotulo,
    antes: l.valorAnterior,
    depois: l.valorNovo,
  }));
}

/**
 * Histórico de relacionamento: última compra, itens fornecidos e prazo
 * praticado. Roda em toda importação — é o que a cotação lê depois para dizer
 * "este fornecedor já vendeu isto, por tanto, nesta data".
 */
async function atualizarHistorico(input: {
  tenantId: string;
  supplierId: string;
  nota: NotaXml;
  userId?: string | null;
}): Promise<ResumoSincronizacao["historico"]> {
  const { tenantId, supplierId, nota } = input;
  const notaNumero = `${nota.numero}/${nota.serie}`;

  let novos = 0;
  for (const item of nota.itens) {
    const atual = await db.supplierProductHistory.findFirst({
      where: { supplierId, codigoFornecedor: item.codigoFornecedor },
      select: { id: true, vezes: true, quantidadeTotal: true, ultimaCompraEm: true },
    });

    if (!atual) {
      novos++;
      await db.supplierProductHistory.create({
        data: {
          tenantId,
          supplierId,
          codigoFornecedor: item.codigoFornecedor,
          gtin: item.gtin,
          descricao: item.descricao,
          ncm: item.ncm,
          cest: item.cest,
          unidade: item.unidade,
          vezes: 1,
          quantidadeTotal: item.quantidade,
          // Bonificação não é preço: gravar zero faria a cotação comparar com
          // um valor que ninguém pratica.
          ultimoPreco: item.bonificacao ? null : item.valorUnitario,
          ultimaNota: notaNumero,
          primeiraCompraEm: nota.dataEmissao,
          ultimaCompraEm: nota.dataEmissao,
        },
      });
      continue;
    }

    // Nota velha importada depois da recente não pode reescrever o "último
    // preço" com um preço mais antigo.
    const maisRecente = nota.dataEmissao >= atual.ultimaCompraEm;
    await db.supplierProductHistory.update({
      where: { id: atual.id },
      data: {
        vezes: atual.vezes + 1,
        quantidadeTotal: Number(atual.quantidadeTotal) + item.quantidade,
        ...(maisRecente
          ? {
              descricao: item.descricao,
              gtin: item.gtin ?? undefined,
              ncm: item.ncm ?? undefined,
              cest: item.cest ?? undefined,
              unidade: item.unidade,
              ultimoPreco: item.bonificacao ? undefined : item.valorUnitario,
              ultimaNota: notaNumero,
              ultimaCompraEm: nota.dataEmissao,
            }
          : {}),
      },
    });
  }

  const prazoMedioDias = await recalcularPrazoMedio(supplierId, nota);

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId },
    select: { ultimaCompraEm: true, comprasNotas: true },
  });
  const maisNova = !supplier?.ultimaCompraEm || nota.dataEmissao >= supplier.ultimaCompraEm;

  await db.supplier.update({
    where: { id: supplierId },
    data: {
      comprasNotas: (supplier?.comprasNotas ?? 0) + 1,
      prazoMedioDias,
      ...(maisNova
        ? {
            ultimaCompraEm: nota.dataEmissao,
            ultimaCompraNota: notaNumero,
            ultimaCompraValor: nota.valorTotal,
          }
        : {}),
    },
  });

  await registrar(tenantId, supplierId, nota, "HISTORICO", "APLICADA", [
    {
      campo: "ultimaCompra",
      rotulo: `Compra registrada — NF-e ${notaNumero}`,
      valorAnterior: null,
      valorNovo: nota.valorTotal.toFixed(2),
    },
    ...(novos > 0
      ? [
          {
            campo: "produtos",
            rotulo: `${novos} produto(s) novo(s) no histórico deste fornecedor`,
            valorAnterior: null,
            valorNovo: String(novos),
          },
        ]
      : []),
  ]);

  return {
    notaNumero,
    dataEmissao: nota.dataEmissao.toISOString(),
    valorTotal: nota.valorTotal,
    produtosNovos: novos,
    produtosTotal: nota.itens.length,
    prazoMedioDias,
  };
}

/**
 * Prazo praticado = média de (vencimento − emissão) das duplicatas das últimas
 * notas. Nota à vista não tem `cobr` e simplesmente não entra na conta — zero
 * dias puxaria a média para baixo e faria o indicador mentir.
 *
 * A nota sendo importada entra pelo parâmetro porque ainda não foi gravada
 * quando esta função roda.
 */
async function recalcularPrazoMedio(supplierId: string, atual: NotaXml): Promise<number | null> {
  const anteriores = await db.fiscalInbound.findMany({
    where: { supplierId, duplicatas: { some: {} } },
    orderBy: { dataEmissao: "desc" },
    take: NOTAS_PARA_PRAZO - 1,
    select: { dataEmissao: true, duplicatas: { select: { vencimento: true } } },
  });

  const prazos: number[] = [];
  const somar = (emissao: Date, vencimentos: Date[]) => {
    for (const v of vencimentos) {
      const dias = Math.round((v.getTime() - emissao.getTime()) / DIA_MS);
      // Vencimento antes da emissão é erro de digitação do emitente; acima de
      // 365 dias não é prazo de bebida, é ruído.
      if (dias >= 0 && dias <= 365) prazos.push(dias);
    }
  };

  somar(
    atual.dataEmissao,
    atual.duplicatas.map((d) => d.vencimento),
  );
  for (const n of anteriores) {
    somar(
      n.dataEmissao,
      n.duplicatas.map((d) => d.vencimento),
    );
  }

  if (prazos.length === 0) return null;
  return Math.round(prazos.reduce((s, d) => s + d, 0) / prazos.length);
}

/** Liga a trilha desta importação à nota que a originou. */
export async function vincularSincronizacaoAoInbound(chave: string, inboundId: string) {
  await db.supplierSyncChange.updateMany({
    where: { chave, inboundId: null },
    data: { inboundId },
  });
}
