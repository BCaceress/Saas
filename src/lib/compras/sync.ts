import "server-only";
import { basePrisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { decifrar } from "@/lib/crypto";
import { logAviso } from "@/lib/log";
import { ingerir } from "./ingest";

// ============================================================
// Sincronização automática das tabelas por API. Roda como job (cron), então
// varre TODOS os tenants — por isso usa `basePrisma` de propósito, e cada
// ingestão entra em `runWithTenant` com o tenant dono da integração.
// ============================================================

export type ResultadoSync = {
  processadas: number;
  comErro: number;
  itensNovos: number;
  itensAtualizados: number;
};

/** Integrações com sincronização vencida. `limite` evita job infinito. */
export async function sincronizarCatalogosDevidos(limite = 50): Promise<ResultadoSync> {
  const agora = new Date();

  const devidas = await basePrisma.supplierIntegration.findMany({
    where: {
      ativo: true,
      kind: "API",
      endpoint: { not: null },
      proximaSync: { lte: agora },
      supplier: { ativo: true, aceitaImportacaoAutomatica: true },
    },
    orderBy: { proximaSync: "asc" },
    take: limite,
    select: {
      id: true,
      tenantId: true,
      supplierId: true,
      endpoint: true,
      authTipo: true,
      credencial: true,
      headers: true,
      frequenciaHoras: true,
    },
  });

  let processadas = 0;
  let comErro = 0;
  let itensNovos = 0;
  let itensAtualizados = 0;

  for (const integracao of devidas) {
    // Reagenda ANTES de tentar: falha de API não pode deixar a integração
    // presa no passado disparando a cada rodada do cron.
    const proxima = new Date(agora.getTime() + (integracao.frequenciaHoras ?? 24) * 3_600_000);
    await basePrisma.supplierIntegration.update({
      where: { id: integracao.id },
      data: { proximaSync: proxima, ultimaSync: agora },
    });

    try {
      const r = await runWithTenant(integracao.tenantId, () =>
        ingerir({
          supplierId: integracao.supplierId,
          kind: "API",
          origem: "agendado",
          fonte: {
            tipo: "api",
            endpoint: integracao.endpoint as string,
            authTipo: integracao.authTipo,
            credencial: decifrar(integracao.credencial),
            headers: (integracao.headers as Record<string, string> | null) ?? null,
          },
        }),
      );
      processadas++;
      itensNovos += r.itensNovos;
      itensAtualizados += r.itensAtualizados;
    } catch (e) {
      comErro++;
      logAviso(
        "compras.sync",
        `Falha ao sincronizar fornecedor ${integracao.supplierId}: ${
          e instanceof Error ? e.message : "erro desconhecido"
        }`,
      );
    }
  }

  return { processadas, comErro, itensNovos, itensAtualizados };
}
