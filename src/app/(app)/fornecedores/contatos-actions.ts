"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";

// ============================================================
// Contatos do fornecedor — quem, de carne e osso, recebe a cotação.
//
// O fornecedor é a empresa; a cotação vai para uma PESSOA. Uma AMBEV tem João,
// Maria e Pedro, e cada comprador fala com o seu. Guardar só o telefone da
// empresa obrigava o operador a lembrar de cabeça para quem mandar.
//
// Regra que manda no desenho: um único contato PRINCIPAL por fornecedor — é
// ele que já vem escolhido no envio, e por isso marcar um novo desmarca o
// anterior na mesma transação (nunca em duas escritas separadas).
// ============================================================

const contatoSchema = z
  .object({
    id: z.string().min(1).optional(),
    supplierId: z.string().min(1),
    nome: z.string().trim().min(2, "Informe o nome do contato."),
    cargo: z.string().trim().max(80).optional().nullable(),
    telefone: z.string().trim().max(20).optional().nullable(),
    email: z
      .string()
      .trim()
      .email("E-mail inválido.")
      .optional()
      .nullable()
      .or(z.literal("")),
    observacao: z.string().trim().max(500).optional().nullable(),
    principal: z.boolean().default(false),
  })
  // Contato sem telefone nem e-mail não recebe cotação nenhuma — é cadastro
  // morto que só atrapalha na hora do envio.
  .refine((d) => Boolean(d.telefone?.trim()) || Boolean(d.email?.trim()), {
    message: "Informe ao menos um WhatsApp ou e-mail — é por onde a cotação sai.",
    path: ["telefone"],
  });

export type ContatoSalvo = {
  id: string;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

function ok(supplierId: string) {
  revalidatePath("/fornecedores", "layout");
  revalidatePath(`/fornecedores/${supplierId}`, "layout");
  revalidatePath("/cotacoes", "layout");
  revalidatePath("/m/cotacoes", "layout");
}

/**
 * Deixa só `contactId` como principal do fornecedor. Roda dentro da mesma
 * escrita que cria/edita o contato: dois principais, mesmo por um instante,
 * fariam o envio escolher o destinatário errado.
 */
async function tornarUnicoPrincipal(supplierId: string, contactId: string) {
  await db.supplierContact.updateMany({
    where: { supplierId, id: { not: contactId }, principal: true },
    data: { principal: false },
  });
  await db.supplierContact.updateMany({
    where: { id: contactId },
    data: { principal: true },
  });
}

/** Cria ou edita um contato. Devolve o contato salvo — o modal de envio da
 *  cotação usa isso para já selecionar quem acabou de ser cadastrado. */
export async function salvarContatoAction(
  input: z.input<typeof contatoSchema>,
): Promise<ContatoSalvo> {
  const d = contatoSchema.parse(input);
  const ctx = await guardAction("fornecedor.editar");

  const salvo = await runWithTenant(ctx.tenant.id, async () => {
    const fornecedor = await db.supplier.findFirst({
      where: { id: d.supplierId },
      select: { id: true },
    });
    if (!fornecedor) throw new Error("Fornecedor não encontrado.");

    const dados = {
      nome: d.nome.trim(),
      cargo: d.cargo?.trim() || null,
      telefone: d.telefone?.trim() || null,
      email: d.email?.trim() || null,
      observacao: d.observacao?.trim() || null,
    };

    // O primeiro contato do fornecedor é principal por definição: cadastrar
    // uma pessoa e ela não receber a cotação não faz sentido para ninguém.
    const quantos = await db.supplierContact.count({
      where: { supplierId: d.supplierId, ativo: true },
    });
    // Editar um contato inativo o traz de volta: quem abre a ficha para
    // corrigir o telefone quer usá-lo de novo.
    const dadosComAtivo = { ...dados, ativo: true };

    let id = d.id ?? "";
    if (d.id) {
      const atual = await db.supplierContact.findFirst({
        where: { id: d.id, supplierId: d.supplierId },
        select: { id: true },
      });
      if (!atual) throw new Error("Contato não encontrado.");
      await db.supplierContact.updateMany({ where: { id: d.id }, data: dadosComAtivo });
    } else {
      const criado = await db.supplierContact.create({
        // tenantId é exigido pelo tipo e reescrito pelo extension com o mesmo
        // valor do contexto — declarar aqui não escapa do isolamento.
        data: {
          ...dados,
          tenantId: ctx.tenant.id,
          supplierId: d.supplierId,
          principal: false,
        },
      });
      id = criado.id;
    }

    const viraPrincipal = d.principal || quantos === 0;
    if (viraPrincipal) await tornarUnicoPrincipal(d.supplierId, id);

    const final = await db.supplierContact.findFirst({
      where: { id },
      select: { id: true, nome: true, cargo: true, telefone: true, email: true, principal: true },
    });
    if (!final) throw new Error("Contato não encontrado.");
    return final;
  });

  ok(d.supplierId);
  return salvo;
}

/** Marca quem recebe a cotação por padrão neste fornecedor. */
export async function definirContatoPrincipalAction(contactId: string) {
  const ctx = await guardAction("fornecedor.editar");
  const supplierId = await runWithTenant(ctx.tenant.id, async () => {
    const c = await db.supplierContact.findFirst({
      where: { id: contactId },
      select: { supplierId: true },
    });
    if (!c) throw new Error("Contato não encontrado.");
    await tornarUnicoPrincipal(c.supplierId, contactId);
    return c.supplierId;
  });

  ok(supplierId);
  return { ok: true as const };
}

/**
 * Liga/desliga o contato sem apagar nada. É a saída para quem já recebeu
 * cotação: some das listas de envio, continua no histórico.
 */
export async function definirContatoAtivoAction(contactId: string, ativo: boolean) {
  const ctx = await guardAction("fornecedor.editar");
  const supplierId = await runWithTenant(ctx.tenant.id, async () => {
    const c = await db.supplierContact.findFirst({
      where: { id: contactId },
      select: { supplierId: true, principal: true },
    });
    if (!c) throw new Error("Contato não encontrado.");

    await db.supplierContact.updateMany({
      where: { id: contactId },
      // Inativo não pode continuar principal: o envio abriria com quem não
      // atende mais.
      data: { ativo, ...(ativo ? {} : { principal: false }) },
    });

    if (!ativo && c.principal) await promoverProximoPrincipal(c.supplierId);
    return c.supplierId;
  });

  ok(supplierId);
  return { ok: true as const };
}

/** O contato ativo mais antigo assume a vaga de principal, se houver algum. */
async function promoverProximoPrincipal(supplierId: string) {
  const proximo = await db.supplierContact.findFirst({
    where: { supplierId, ativo: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (proximo) await tornarUnicoPrincipal(supplierId, proximo.id);
}

/**
 * Remove um contato — só enquanto ele nunca recebeu nada. Depois do primeiro
 * envio, apagar levaria junto o "para quem foi" do histórico da cotação; aí a
 * saída é inativar (`definirContatoAtivoAction`), e a tela já oferece isso.
 */
export async function removerContatoAction(contactId: string) {
  const ctx = await guardAction("fornecedor.editar");
  const supplierId = await runWithTenant(ctx.tenant.id, async () => {
    const c = await db.supplierContact.findFirst({
      where: { id: contactId },
      select: { id: true, supplierId: true, principal: true, _count: { select: { envios: true } } },
    });
    if (!c) throw new Error("Contato não encontrado.");
    if (c._count.envios > 0) {
      throw new Error(
        "Este contato já recebeu cotação — inative em vez de excluir, para não apagar o histórico.",
      );
    }

    await db.supplierContact.deleteMany({ where: { id: contactId } });

    // Fornecedor sem principal é fornecedor que o envio não sabe alcançar:
    // o mais antigo que sobrou assume a vaga.
    if (c.principal) await promoverProximoPrincipal(c.supplierId);
    return c.supplierId;
  });

  ok(supplierId);
  return { ok: true as const };
}
