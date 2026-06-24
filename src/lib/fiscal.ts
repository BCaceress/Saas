import "server-only";
import { basePrisma } from "./prisma";

/**
 * Hook fiscal pós-pagamento (PRD Fase 4 §11). Esta fase NÃO emite NFC-e/SAT —
 * só expõe o ponto de extensão e garante que o dado existe. A Fase 5 pluga a
 * emissão aqui. Por ora, registra a intenção em log (no-op seguro).
 */
export async function emitirHookFiscal(
  tenantId: string,
  saleId: string
): Promise<void> {
  const tenant = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { moduloFiscal: true },
  });
  if (!tenant?.moduloFiscal) return; // sem módulo fiscal, nada a fazer

  // Ponto de extensão da Fase 5: emitir NFC-e/SAT a partir da venda PAGA.
  // (itens, perfis fiscais no produto e pagamentos já estão persistidos)
  if (process.env.NODE_ENV === "development") {
    console.info(`[fiscal] venda ${saleId} pronta para emissão (Fase 5).`);
  }
}
