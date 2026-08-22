import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadTitulos, resumoTitulos, loadFornecedoresComTitulo } from "./_data";
import { ContasAPagarView } from "./_client";
import type { AccountPayableStatus } from "@/generated/prisma";

// Contas a pagar. Nasce das duplicatas da NF-e no momento em que a mercadoria
// entra — não é digitação, é consequência.

type Params = Promise<{ status?: string; fornecedor?: string }>;

const STATUS_VALIDOS = new Set(["ABERTO", "PAGO", "CANCELADO", "VENCIDO"]);

export default async function ContasAPagarPage({ searchParams }: { searchParams: Params }) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;

  const status = sp.status && STATUS_VALIDOS.has(sp.status) ? sp.status : "ABERTO";
  const fornecedor = sp.fornecedor || null;
  const podePagar = podeEmAlguma(ctx.acessos, "financeiro.pagar");

  const { titulos, resumo, fornecedores } = await withTenant(ctx, async () => {
    const [titulos, resumo, fornecedores] = await Promise.all([
      loadTitulos({
        status: status as AccountPayableStatus | "VENCIDO",
        supplierId: fornecedor,
      }),
      resumoTitulos(),
      loadFornecedoresComTitulo(),
    ]);
    return { titulos, resumo, fornecedores };
  });

  return (
    <ContasAPagarView
      titulos={titulos}
      resumo={resumo}
      fornecedores={fornecedores}
      status={status}
      fornecedorId={fornecedor}
      podePagar={podePagar}
    />
  );
}
