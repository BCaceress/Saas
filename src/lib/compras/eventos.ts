import "server-only";
import { basePrisma, comTenant } from "@/lib/prisma";
import type { Prisma, PurchaseEventType } from "@/generated/prisma";

// ============================================================
// Timeline do pedido de compra.
//
// Status guarda o "agora"; isto guarda o "como chegou aqui". Quando o
// fornecedor cobra por uma caixa que ninguém viu, a discussão se resolve com a
// linha do tempo — quem vinculou a nota, o que a conciliação achou, quem
// aceitou o custo novo, quem conferiu.
//
// Usa basePrisma + comTenant (não `db`) porque também é chamado de dentro do
// serviço de estoque, que trabalha com tenantId explícito e nem sempre roda
// dentro de um runWithTenant.
// ============================================================

export async function registrarEvento(input: {
  tenantId: string;
  /** Nulo no recebimento sem pedido — aí a história pendura na nota. */
  purchaseOrderId: string | null;
  inboundId?: string | null;
  tipo: PurchaseEventType;
  descricao: string;
  meta?: Prisma.InputJsonValue;
  createdBy?: string | null;
}): Promise<void> {
  // Evento sem pedido E sem nota não tem por onde ser lido de volta — é lixo
  // silencioso na tabela. Melhor estourar aqui do que sumir com a história.
  if (!input.purchaseOrderId && !input.inboundId) {
    throw new Error("Evento de compra precisa de um pedido ou de uma nota.");
  }

  await comTenant(
    input.tenantId,
    basePrisma.purchaseEvent.create({
      data: {
        tenantId: input.tenantId,
        purchaseOrderId: input.purchaseOrderId,
        inboundId: input.inboundId ?? null,
        tipo: input.tipo,
        descricao: input.descricao,
        meta: input.meta,
        createdBy: input.createdBy ?? null,
      },
      select: { id: true },
    }),
  );
}

export type EventoPedido = {
  id: string;
  tipo: PurchaseEventType;
  descricao: string;
  createdAt: Date;
  autor: string | null;
};

/** Timeline completa, do mais antigo ao mais recente (é como se lê história). */
export async function listarEventos(
  tenantId: string,
  purchaseOrderId: string,
): Promise<EventoPedido[]> {
  return listarEventosPor(tenantId, { purchaseOrderId });
}

/**
 * Timeline de uma nota. É a única leitura possível do recebimento sem pedido,
 * onde não existe `purchaseOrderId` para pendurar a história.
 */
export async function listarEventosDaNota(
  tenantId: string,
  inboundId: string,
): Promise<EventoPedido[]> {
  return listarEventosPor(tenantId, { inboundId });
}

async function listarEventosPor(
  tenantId: string,
  filtro: { purchaseOrderId: string } | { inboundId: string },
): Promise<EventoPedido[]> {
  const eventos = await comTenant(
    tenantId,
    basePrisma.purchaseEvent.findMany({
      where: { tenantId, ...filtro },
      select: { id: true, tipo: true, descricao: true, createdAt: true, createdBy: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  );

  const autores = [...new Set(eventos.map((e) => e.createdBy).filter((v): v is string => !!v))];
  const users = autores.length
    ? await basePrisma.user.findMany({
        where: { id: { in: autores } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nome = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));

  return eventos.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    descricao: e.descricao,
    createdAt: e.createdAt,
    autor: e.createdBy ? (nome.get(e.createdBy) ?? null) : null,
  }));
}
