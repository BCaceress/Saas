import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { db } from "@/lib/prisma";
import { whereRecebiveis, resumoRecebiveis } from "@/lib/financeiro/contas-receber";
import { ContasAReceberView, type RecebivelRow } from "./_client";
import type { AccountReceivableStatus } from "@/generated/prisma";

// Contas a receber. A metade que faltava para o caixa fazer sentido.

type Params = Promise<{ status?: string }>;

const STATUS_VALIDOS = new Set(["ABERTO", "RECEBIDO", "CANCELADO", "VENCIDO"]);
const DIA = 86_400_000;

export default async function ContasAReceberPage({ searchParams }: { searchParams: Params }) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const status = sp.status && STATUS_VALIDOS.has(sp.status) ? sp.status : "ABERTO";
  const podeBaixar = podeEmAlguma(ctx.acessos, "financeiro.pagar");

  const { titulos, resumo } = await withTenant(ctx, async () => {
    const [rows, resumo] = await Promise.all([
      db.accountReceivable.findMany({
        where: whereRecebiveis({ status: status as AccountReceivableStatus | "VENCIDO" }),
        select: {
          id: true,
          descricao: true,
          parcela: true,
          numeroDocumento: true,
          vencimento: true,
          valor: true,
          valorRecebido: true,
          status: true,
          origem: true,
          customer: { select: { id: true, nome: true } },
        },
        orderBy: [{ status: "asc" }, { vencimento: "asc" }],
        take: 300,
      }),
      resumoRecebiveis(),
    ]);

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const titulos: RecebivelRow[] = rows.map((t) => {
      const valor = Number(t.valor);
      const recebido = Number(t.valorRecebido);
      const venc = new Date(t.vencimento);
      venc.setHours(0, 0, 0, 0);
      return {
        id: t.id,
        descricao: t.descricao,
        clienteNome: t.customer?.nome ?? null,
        parcela: t.parcela,
        numeroDocumento: t.numeroDocumento,
        vencimento: t.vencimento,
        valor,
        valorRecebido: recebido,
        saldo: Math.max(0, valor - recebido),
        status: t.status,
        origem: t.origem,
        diasParaVencer: Math.round((venc.getTime() - hoje.getTime()) / DIA),
      };
    });

    return { titulos, resumo };
  });

  return (
    <ContasAReceberView
      titulos={titulos}
      resumo={resumo}
      status={status}
      podeBaixar={podeBaixar}
    />
  );
}
