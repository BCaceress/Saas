import "server-only";
import { db } from "@/lib/prisma";
import type { AccountReceivableStatus } from "@/generated/prisma";

// ============================================================
// Contas a receber — a outra metade do caixa.
//
// Só existia o lado que sai. Sem esta metade, "dia 10 eu tenho dinheiro para o
// boleto?" não tinha resposta: o sistema sabia tudo o que a loja deve e nada do
// que a loja tem para receber.
//
// A origem prática hoje é o lançamento manual — venda a prazo para PJ, aluguel
// de espaço de geladeira, comodato faturado. O PDV ainda não tem fiado; quando
// tiver, a venda passa a gerar título por aqui pelo mesmo caminho que a NF-e
// gera conta a pagar. O enum `AccountReceivableOrigem` já prevê isso.
// ============================================================

export type ResumoRecebiveis = {
  vencido: { qtd: number; valor: number };
  hoje: { qtd: number; valor: number };
  semana: { qtd: number; valor: number };
  aberto: { qtd: number; valor: number };
};

const DIA = 86_400_000;

export async function criarTituloReceber(input: {
  tenantId: string;
  descricao: string;
  valor: number;
  vencimento: Date;
  customerId?: string | null;
  saleId?: string | null;
  origem?: "MANUAL" | "VENDA_PRAZO" | "COMODATO" | "OUTRO";
  numeroDocumento?: string | null;
  parcelas?: number;
  observacao?: string | null;
  userId?: string | null;
}): Promise<{ criados: number }> {
  if (input.valor <= 0) throw new Error("Informe o valor a receber.");
  const parcelas = Math.max(1, Math.min(36, input.parcelas ?? 1));

  // Parcelamento em partes iguais, com a sobra do arredondamento na última —
  // senão a soma das parcelas não bate com o total combinado.
  const base = Math.floor((input.valor / parcelas) * 100) / 100;
  const linhas = Array.from({ length: parcelas }, (_, i) => {
    const vencimento = new Date(input.vencimento);
    vencimento.setMonth(vencimento.getMonth() + i);
    return {
      tenantId: input.tenantId,
      customerId: input.customerId ?? null,
      saleId: input.saleId ?? null,
      origem: input.origem ?? "MANUAL",
      numeroDocumento: input.numeroDocumento ?? null,
      parcela: parcelas > 1 ? `${i + 1}/${parcelas}` : null,
      descricao: input.descricao,
      vencimento,
      valor:
        i === parcelas - 1
          ? Math.round((input.valor - base * (parcelas - 1)) * 100) / 100
          : base,
      observacao: input.observacao ?? null,
      createdBy: input.userId ?? null,
    };
  });

  await db.accountReceivable.createMany({ data: linhas });
  return { criados: linhas.length };
}

/** Baixa de um título a receber. Parcial mantém ABERTO com saldo menor. */
export async function receberTitulo(input: {
  tenantId: string;
  tituloId: string;
  valorRecebido?: number | null;
  recebidoEm?: Date | null;
  observacao?: string | null;
  userId?: string | null;
}): Promise<{ valor: number; quitado: boolean }> {
  const titulo = await db.accountReceivable.findFirst({
    where: { id: input.tituloId },
    select: { valor: true, valorRecebido: true, status: true },
  });
  if (!titulo) throw new Error("Título não encontrado.");
  if (titulo.status === "CANCELADO") throw new Error("Este título foi cancelado.");
  if (titulo.status === "RECEBIDO") throw new Error("Este título já foi recebido.");

  const devido = Number(titulo.valor) - Number(titulo.valorRecebido);
  if (devido <= 0.005) throw new Error("Este título não tem saldo a receber.");

  const valor = input.valorRecebido ?? devido;
  if (valor <= 0) throw new Error("Informe o valor recebido.");
  if (valor > devido + 0.005) {
    throw new Error(
      `O valor informado passa do saldo do título (${devido.toFixed(2)}).`,
    );
  }

  const recebidoEm = input.recebidoEm ?? new Date();
  const acumulado = Number(titulo.valorRecebido) + valor;
  const quitado = acumulado >= Number(titulo.valor) - 0.005;

  await db.accountReceivablePayment.create({
    data: {
      tenantId: input.tenantId,
      receivableId: input.tituloId,
      origem: "PAGAMENTO",
      valor,
      recebidoEm,
      observacao: input.observacao ?? null,
      createdBy: input.userId ?? null,
    },
  });

  await db.accountReceivable.update({
    where: { id: input.tituloId },
    data: {
      valorRecebido: acumulado,
      status: quitado ? "RECEBIDO" : "ABERTO",
      recebidoEm: quitado ? recebidoEm : null,
    },
  });

  return { valor, quitado };
}

export async function cancelarTituloReceber(input: {
  tituloId: string;
  motivo: string;
}): Promise<void> {
  const titulo = await db.accountReceivable.findFirst({
    where: { id: input.tituloId },
    select: { status: true, valorRecebido: true },
  });
  if (!titulo) throw new Error("Título não encontrado.");
  if (Number(titulo.valorRecebido) > 0) {
    throw new Error("Este título já teve recebimento. Registre um estorno, não um cancelamento.");
  }
  await db.accountReceivable.update({
    where: { id: input.tituloId },
    data: { status: "CANCELADO", observacao: input.motivo },
  });
}

export function whereRecebiveis(f: {
  status?: AccountReceivableStatus | "VENCIDO" | null;
  customerId?: string | null;
}) {
  const where: Record<string, unknown> = {};
  if (f.customerId) where.customerId = f.customerId;
  if (f.status === "VENCIDO") {
    where.status = "ABERTO";
    where.vencimento = { lt: new Date() };
  } else if (f.status) {
    where.status = f.status;
  }
  return where;
}

export async function resumoRecebiveis(): Promise<ResumoRecebiveis> {
  const abertos = await db.accountReceivable.findMany({
    where: { status: "ABERTO" },
    select: { vencimento: true, valor: true, valorRecebido: true },
  });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fimSemana = new Date(hoje.getTime() + 7 * DIA);

  const zero = () => ({ qtd: 0, valor: 0 });
  const r: ResumoRecebiveis = { vencido: zero(), hoje: zero(), semana: zero(), aberto: zero() };

  for (const t of abertos) {
    const saldo = Math.max(0, Number(t.valor) - Number(t.valorRecebido));
    const venc = new Date(t.vencimento);
    venc.setHours(0, 0, 0, 0);

    r.aberto.qtd += 1;
    r.aberto.valor += saldo;

    if (venc < hoje) {
      r.vencido.qtd += 1;
      r.vencido.valor += saldo;
    } else if (venc.getTime() === hoje.getTime()) {
      r.hoje.qtd += 1;
      r.hoje.valor += saldo;
    } else if (venc <= fimSemana) {
      r.semana.qtd += 1;
      r.semana.valor += saldo;
    }
  }

  return r;
}
