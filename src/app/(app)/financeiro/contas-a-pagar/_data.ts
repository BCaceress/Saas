import "server-only";
import { db } from "@/lib/prisma";
import { whereTitulos, type FiltroTitulos } from "@/lib/financeiro/contas-pagar";

// Leitura de Contas a pagar. O recorte é por VENCIMENTO, não por data de
// emissão: quem abre esta tela quer saber o que vence, não o que chegou.

export type TituloRow = {
  id: string;
  descricao: string;
  supplierId: string | null;
  supplierNome: string;
  numeroDocumento: string | null;
  parcela: string | null;
  vencimento: Date;
  valor: number;
  valorPago: number;
  saldo: number;
  status: "ABERTO" | "PAGO" | "CANCELADO";
  vencido: boolean;
  diasParaVencer: number;
  estimado: boolean;
  pedidoId: string | null;
  pedidoNumero: string | null;
  inboundId: string | null;
};

export type ResumoTitulos = {
  vencido: { qtd: number; valor: number };
  hoje: { qtd: number; valor: number };
  semana: { qtd: number; valor: number };
  aberto: { qtd: number; valor: number };
};

const DIA = 86_400_000;

export async function loadTitulos(filtro: FiltroTitulos): Promise<TituloRow[]> {
  const rows = await db.accountPayable.findMany({
    where: whereTitulos(filtro),
    select: {
      id: true,
      descricao: true,
      supplierId: true,
      numeroDocumento: true,
      parcela: true,
      vencimento: true,
      valor: true,
      valorPago: true,
      status: true,
      observacao: true,
      inboundId: true,
      purchaseOrderId: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      purchaseOrder: { select: { numero: true } },
    },
    orderBy: [{ status: "asc" }, { vencimento: "asc" }],
    take: 300,
  });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  return rows.map((t) => {
    const valor = Number(t.valor);
    const pago = Number(t.valorPago);
    const venc = new Date(t.vencimento);
    venc.setHours(0, 0, 0, 0);
    return {
      id: t.id,
      descricao: t.descricao,
      supplierId: t.supplierId,
      supplierNome: t.supplier?.nomeFantasia || t.supplier?.razaoSocial || "Sem fornecedor",
      numeroDocumento: t.numeroDocumento,
      parcela: t.parcela,
      vencimento: t.vencimento,
      valor,
      valorPago: pago,
      saldo: Math.max(0, valor - pago),
      status: t.status,
      vencido: t.status === "ABERTO" && venc < hoje,
      diasParaVencer: Math.round((venc.getTime() - hoje.getTime()) / DIA),
      // O vencimento veio do prazo do fornecedor, não de um boleto. A tela
      // marca isso — pagar na data errada custa juro ou relacionamento.
      estimado: Boolean(t.observacao?.includes("Vencimento estimado")),
      pedidoId: t.purchaseOrderId,
      pedidoNumero: t.purchaseOrder?.numero ?? null,
      inboundId: t.inboundId,
    };
  });
}

export async function resumoTitulos(): Promise<ResumoTitulos> {
  const abertos = await db.accountPayable.findMany({
    where: { status: "ABERTO" },
    select: { vencimento: true, valor: true, valorPago: true },
  });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fimSemana = new Date(hoje.getTime() + 7 * DIA);

  const zero = () => ({ qtd: 0, valor: 0 });
  const r: ResumoTitulos = {
    vencido: zero(),
    hoje: zero(),
    semana: zero(),
    aberto: zero(),
  };

  for (const t of abertos) {
    const saldo = Math.max(0, Number(t.valor) - Number(t.valorPago));
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

export async function loadFornecedoresComTitulo() {
  const ids = await db.accountPayable.findMany({
    where: { status: "ABERTO" },
    select: { supplierId: true },
    distinct: ["supplierId"],
  });
  const validos = ids.map((i) => i.supplierId).filter((i): i is string => Boolean(i));
  if (validos.length === 0) return [];

  const fornecedores = await db.supplier.findMany({
    where: { id: { in: validos } },
    select: { id: true, razaoSocial: true, nomeFantasia: true },
    orderBy: { razaoSocial: "asc" },
  });
  return fornecedores.map((f) => ({ id: f.id, nome: f.nomeFantasia || f.razaoSocial }));
}
