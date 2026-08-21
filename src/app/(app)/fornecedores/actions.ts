"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";

// ============================================================
// Escrita do Centro de Gestão do Fornecedor.
//
// Tudo que pertence a UM fornecedor — cadastro, condições comerciais,
// anotações — passa por aqui. Compras não configura fornecedor: lá só se
// decide o que comprar.
//
// Permissão: ver = `fornecedor.ver` (guard do layout); qualquer escrita =
// `fornecedor.editar`.
// ============================================================

async function tx<T>(
  permissao: Permissao,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

/** A ficha do fornecedor alimenta comparador, carrinho e sugestão de compra. */
function ok(supplierId?: string) {
  revalidatePath("/fornecedores", "layout");
  if (supplierId) revalidatePath(`/fornecedores/${supplierId}`, "layout");
  revalidatePath("/cotacoes", "layout");
  revalidatePath("/pedidos", "layout");
}

// ── Condições comerciais e anotações ────────────────────────

const observacoesSchema = z.object({
  supplierId: z.string().min(1),
  observacoes: z.string().trim().max(4000).nullable().optional(),
  prazoPagamentoDias: z.number().int().min(0).max(365).nullable().optional(),
});

export async function salvarObservacoesAction(input: z.input<typeof observacoesSchema>) {
  const d = observacoesSchema.parse(input);

  // `await` obrigatório: PrismaPromise é lazy e rodaria fora do runWithTenant.
  await tx("fornecedor.editar", async () => {
    await db.supplier.update({
      where: { id: d.supplierId },
      data: {
        observacoes: d.observacoes || null,
        prazoPagamentoDias: d.prazoPagamentoDias ?? null,
      },
    });
  });

  ok(d.supplierId);
  return { ok: true as const };
}
