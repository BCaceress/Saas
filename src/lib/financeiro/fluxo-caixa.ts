import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// Fluxo de caixa projetado.
//
// A pergunta do dono não é "quanto eu devo" nem "quanto tenho a receber" —
// é "dia 10 eu tenho dinheiro para o boleto?". Isso só aparece quando as duas
// pontas são lidas na mesma linha do tempo, com saldo acumulado.
//
// É PROJEÇÃO, não extrato: parte de um saldo inicial informado e soma o que
// está previsto por vencimento. Título vencido e não pago entra no primeiro
// dia da janela — a dívida não some por estar atrasada, e empurrá-la para o
// passado esconderia o buraco que ela cria hoje.
// ============================================================

export type DiaFluxo = {
  /** "2026-08-25" */
  data: string;
  entradas: number;
  saidas: number;
  /** entradas − saídas do dia. */
  resultado: number;
  /** Saldo acumulado desde o saldo inicial. */
  saldo: number;
  /** Detalhe do dia, para o operador entender de onde vem o número. */
  itens: {
    tipo: "entrada" | "saida";
    descricao: string;
    valor: number;
    vencido: boolean;
  }[];
};

export type FluxoCaixa = {
  saldoInicial: number;
  dias: DiaFluxo[];
  totalEntradas: number;
  totalSaidas: number;
  saldoFinal: number;
  /** Primeiro dia em que o saldo fica negativo. É o alerta que importa. */
  primeiroDiaNegativo: string | null;
  /** Menor saldo da janela — quanto de folga (ou de buraco) existe no pior dia. */
  menorSaldo: number;
};

const chaveDia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function projetarFluxoCaixa(input: {
  dias?: number;
  saldoInicial?: number;
}): Promise<FluxoCaixa> {
  const janela = Math.max(7, Math.min(180, input.dias ?? 30));
  const saldoInicial = input.saldoInicial ?? 0;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fim = new Date(hoje.getTime() + janela * 86_400_000);

  const [aPagar, aReceber] = await Promise.all([
    db.accountPayable.findMany({
      where: { status: "ABERTO", vencimento: { lt: fim } },
      select: {
        vencimento: true,
        valor: true,
        valorPago: true,
        descricao: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    }),
    db.accountReceivable.findMany({
      where: { status: "ABERTO", vencimento: { lt: fim } },
      select: {
        vencimento: true,
        valor: true,
        valorRecebido: true,
        descricao: true,
        customer: { select: { nome: true } },
      },
    }),
  ]);

  // Um balde por dia da janela, inclusive os vazios: gráfico com furo mente
  // sobre o ritmo, e a tabela some com o dia em que nada acontece.
  const baldes = new Map<string, DiaFluxo>();
  for (let i = 0; i <= janela; i++) {
    const d = new Date(hoje.getTime() + i * 86_400_000);
    baldes.set(chaveDia(d), {
      data: chaveDia(d),
      entradas: 0,
      saidas: 0,
      resultado: 0,
      saldo: 0,
      itens: [],
    });
  }

  const primeiroDia = chaveDia(hoje);

  for (const t of aPagar) {
    const saldo = Math.max(0, Number(t.valor) - Number(t.valorPago));
    if (saldo <= 0) continue;
    const venc = new Date(t.vencimento);
    venc.setHours(0, 0, 0, 0);
    // Vencido entra hoje: já é dinheiro que deveria ter saído.
    const vencido = venc < hoje;
    const balde = baldes.get(vencido ? primeiroDia : chaveDia(venc));
    if (!balde) continue;
    balde.saidas += saldo;
    balde.itens.push({
      tipo: "saida",
      descricao: t.supplier?.nomeFantasia || t.supplier?.razaoSocial || t.descricao,
      valor: saldo,
      vencido,
    });
  }

  for (const t of aReceber) {
    const saldo = Math.max(0, Number(t.valor) - Number(t.valorRecebido));
    if (saldo <= 0) continue;
    const venc = new Date(t.vencimento);
    venc.setHours(0, 0, 0, 0);
    const vencido = venc < hoje;
    const balde = baldes.get(vencido ? primeiroDia : chaveDia(venc));
    if (!balde) continue;
    balde.entradas += saldo;
    balde.itens.push({
      tipo: "entrada",
      descricao: t.customer?.nome || t.descricao,
      valor: saldo,
      vencido,
    });
  }

  let saldo = saldoInicial;
  let menorSaldo = saldoInicial;
  let primeiroDiaNegativo: string | null = null;
  let totalEntradas = 0;
  let totalSaidas = 0;

  const dias = [...baldes.values()].sort((a, b) => a.data.localeCompare(b.data));
  for (const d of dias) {
    d.resultado = d.entradas - d.saidas;
    saldo += d.resultado;
    d.saldo = Math.round(saldo * 100) / 100;
    d.itens.sort((a, b) => b.valor - a.valor);

    totalEntradas += d.entradas;
    totalSaidas += d.saidas;
    if (d.saldo < menorSaldo) menorSaldo = d.saldo;
    if (d.saldo < 0 && !primeiroDiaNegativo) primeiroDiaNegativo = d.data;
  }

  return {
    saldoInicial,
    dias,
    totalEntradas: Math.round(totalEntradas * 100) / 100,
    totalSaidas: Math.round(totalSaidas * 100) / 100,
    saldoFinal: Math.round(saldo * 100) / 100,
    primeiroDiaNegativo,
    menorSaldo: Math.round(menorSaldo * 100) / 100,
  };
}
