import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// Vasilhame com a DISTRIBUIDORA.
//
// Cerveja retornável e barril chegam cheios e o caminhão leva os vazios de
// volta. A diferença entre o que entrou cheio e o que voltou vazio é casco que
// a loja deve ao fornecedor — e que vira cobrança (ou desconto no boleto)
// quando some na conta de alguém. Era controle de caderno.
//
// O tipo de casco é o MESMO do comodato com o cliente (`ContainerType`); o
// razão é outro (`SupplierContainerMovement`), assinado: + cheio que chegou,
// − vazio que voltou. Saldo com o fornecedor = Σ quantidade.
//
// Todas as funções assumem contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

export type VasilhameDoTipo = {
  containerTypeId: string;
  nome: string;
  /** Cheios que chegaram neste recebimento. */
  recebidos: number;
  /** Vazios que voltaram neste recebimento. */
  devolvidos: number;
  /** Quanto a loja deve deste casco ao fornecedor, somando tudo. */
  saldo: number;
};

/**
 * Os tipos de casco ativos, com o que este recebimento trouxe e levou e o
 * saldo com o fornecedor. Lista vazia = a loja não controla vasilhame.
 */
export async function vasilhameDoRecebimento(
  receiptId: string,
  supplierId: string,
): Promise<VasilhameDoTipo[]> {
  const [tipos, doRecebimento, saldos] = await Promise.all([
    db.containerType.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    db.supplierContainerMovement.groupBy({
      by: ["containerTypeId", "tipo"],
      where: { receiptId },
      _sum: { quantidade: true },
    }),
    db.supplierContainerMovement.groupBy({
      by: ["containerTypeId"],
      where: { supplierId },
      _sum: { quantidade: true },
    }),
  ]);

  const doTipo = (id: string, tipo: "RECEBIDO" | "DEVOLVIDO") =>
    Math.abs(
      doRecebimento.find((m) => m.containerTypeId === id && m.tipo === tipo)?._sum.quantidade ?? 0,
    );
  const saldoDe = new Map(saldos.map((s) => [s.containerTypeId, s._sum.quantidade ?? 0]));

  return tipos.map((t) => ({
    containerTypeId: t.id,
    nome: t.nome,
    recebidos: doTipo(t.id, "RECEBIDO"),
    devolvidos: doTipo(t.id, "DEVOLVIDO"),
    saldo: saldoDe.get(t.id) ?? 0,
  }));
}

/**
 * Grava o que o caminhão trouxe e levou de UM tipo de casco neste
 * recebimento. Substitui o que estava gravado para ele — é a contagem da doca
 * sendo corrigida, não um lançamento novo a cada digitação.
 */
export async function registrarVasilhameDoRecebimento(input: {
  tenantId: string;
  receiptId: string;
  supplierId: string;
  containerTypeId: string;
  recebidos: number;
  devolvidos: number;
  userId?: string | null;
}): Promise<void> {
  for (const [nome, n] of [
    ["cheios recebidos", input.recebidos],
    ["vazios devolvidos", input.devolvidos],
  ] as const) {
    if (!Number.isInteger(n) || n < 0 || n > 100_000) {
      throw new Error(`Informe os ${nome} em número inteiro, de 0 para cima.`);
    }
  }

  const tipo = await db.containerType.findFirst({
    where: { id: input.containerTypeId, ativo: true },
    select: { id: true },
  });
  if (!tipo) throw new Error("Tipo de vasilhame não encontrado (ou desativado).");

  await db.supplierContainerMovement.deleteMany({
    where: {
      receiptId: input.receiptId,
      containerTypeId: input.containerTypeId,
      tipo: { in: ["RECEBIDO", "DEVOLVIDO"] },
    },
  });

  const base = {
    tenantId: input.tenantId,
    supplierId: input.supplierId,
    containerTypeId: input.containerTypeId,
    receiptId: input.receiptId,
    createdBy: input.userId ?? null,
  };
  const movimentos = [
    ...(input.recebidos > 0
      ? [{ ...base, tipo: "RECEBIDO" as const, quantidade: input.recebidos }]
      : []),
    ...(input.devolvidos > 0
      ? [{ ...base, tipo: "DEVOLVIDO" as const, quantidade: -input.devolvidos }]
      : []),
  ];
  if (movimentos.length > 0) {
    await db.supplierContainerMovement.createMany({ data: movimentos });
  }
}
