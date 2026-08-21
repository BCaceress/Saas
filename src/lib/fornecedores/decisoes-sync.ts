import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// O que fazer com uma sugestão da sincronização por XML.
//
// A sugestão existe justamente porque o sistema NÃO sabe a resposta: o
// telefone do XML pode ser o da matriz, do transportador ou do vendedor que
// atende esta loja. Cada decisão é gravada na própria linha da trilha — a
// pergunta e a resposta ficam no mesmo lugar, e o "por que meu telefone
// mudou?" tem uma resposta com data e autor.
// ============================================================

export type DecisaoSync =
  /** Telefone: passa a ser o do cadastro. */
  | "ATUALIZAR"
  /** Vira um contato a mais, sem mexer no cadastro nem em quem é principal. */
  | "CONTATO"
  /** Vira contato E assume como principal (é para lá que a cotação vai). */
  | "PRINCIPAL"
  /** Fica como está — e a mesma sugestão não volta a ser feita. */
  | "MANTER";

const DECISOES_POR_CAMPO: Record<string, DecisaoSync[]> = {
  telefone: ["ATUALIZAR", "CONTATO", "MANTER"],
  email: ["CONTATO", "PRINCIPAL", "MANTER"],
};

/** Nome do contato criado a partir do XML — o operador renomeia depois. */
const NOME_CONTATO_FISCAL = "Contato fiscal";

/** Um único principal por fornecedor: dois fariam o envio escolher errado. */
async function tornarUnicoPrincipal(supplierId: string, contactId: string) {
  await db.supplierContact.updateMany({
    where: { supplierId, id: { not: contactId }, principal: true },
    data: { principal: false },
  });
  await db.supplierContact.updateMany({ where: { id: contactId }, data: { principal: true } });
}

/**
 * Contato do XML: reaproveita o que já existe com o mesmo canal em vez de
 * empilhar "Contato fiscal" repetido a cada nota.
 */
async function contatoDoXml(input: {
  tenantId: string;
  supplierId: string;
  telefone?: string | null;
  email?: string | null;
  notaNumero: string | null;
}): Promise<string> {
  const { tenantId, supplierId, telefone, email, notaNumero } = input;

  const existente = email
    ? await db.supplierContact.findFirst({
        where: { supplierId, email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      })
    : telefone
      ? await db.supplierContact.findFirst({
          where: { supplierId, telefone },
          select: { id: true },
        })
      : null;

  if (existente) {
    await db.supplierContact.updateMany({
      where: { id: existente.id },
      data: { ativo: true, ...(telefone ? { telefone } : {}), ...(email ? { email } : {}) },
    });
    return existente.id;
  }

  const criado = await db.supplierContact.create({
    data: {
      tenantId,
      supplierId,
      nome: NOME_CONTATO_FISCAL,
      cargo: "Faturamento",
      telefone: telefone ?? null,
      email: email ?? null,
      observacao: notaNumero
        ? `Encontrado no XML da NF-e ${notaNumero}.`
        : "Encontrado no XML da NF-e.",
      principal: false,
    },
    select: { id: true },
  });
  return criado.id;
}

/**
 * Aplica a decisão do operador sobre uma sugestão. Idempotente por status:
 * decidir duas vezes a mesma linha não duplica contato.
 */
export async function decidirSugestaoSync(input: {
  tenantId: string;
  id: string;
  decisao: DecisaoSync;
  userId?: string | null;
}): Promise<{ supplierId: string; campo: string }> {
  const { tenantId, id, decisao, userId } = input;

  const sugestao = await db.supplierSyncChange.findFirst({
    where: { id, tipo: "SUGESTAO" },
    select: {
      id: true,
      supplierId: true,
      campo: true,
      valorNovo: true,
      status: true,
      notaNumero: true,
    },
  });
  if (!sugestao) throw new Error("Sugestão não encontrada.");
  if (sugestao.status !== "PENDENTE") {
    return { supplierId: sugestao.supplierId, campo: sugestao.campo };
  }

  const permitidas = DECISOES_POR_CAMPO[sugestao.campo] ?? ["ATUALIZAR", "MANTER"];
  if (!permitidas.includes(decisao)) {
    throw new Error("Essa decisão não vale para este tipo de sugestão.");
  }

  const valor = sugestao.valorNovo;
  if (!valor) throw new Error("Sugestão sem valor — nada a aplicar.");

  if (decisao === "ATUALIZAR") {
    if (sugestao.campo === "telefone") {
      await db.supplier.update({
        where: { id: sugestao.supplierId },
        data: { telefone: valor },
      });
    }
  }

  if (decisao === "CONTATO" || decisao === "PRINCIPAL") {
    const contactId = await contatoDoXml({
      tenantId,
      supplierId: sugestao.supplierId,
      telefone: sugestao.campo === "telefone" ? valor : null,
      email: sugestao.campo === "email" ? valor : null,
      notaNumero: sugestao.notaNumero,
    });
    if (decisao === "PRINCIPAL") {
      await tornarUnicoPrincipal(sugestao.supplierId, contactId);
      // O e-mail "da empresa" acompanha quem responde por ela: é o que a ficha
      // e o envio de cotação mostram no cabeçalho.
      if (sugestao.campo === "email") {
        await db.supplier.update({
          where: { id: sugestao.supplierId },
          data: { email: valor },
        });
      }
    }
  }

  await db.supplierSyncChange.update({
    where: { id: sugestao.id },
    data: {
      // MANTER continua sendo uma resposta: IGNORADA é o que impede a mesma
      // sugestão de voltar na próxima nota.
      status: decisao === "MANTER" ? "IGNORADA" : "APLICADA",
      decisao,
      decididoEm: new Date(),
      decididoPor: userId ?? null,
    },
  });

  return { supplierId: sugestao.supplierId, campo: sugestao.campo };
}
