import { NextResponse } from "next/server";
import { autorizarCron } from "@/lib/cron";
import { sincronizarCatalogosDevidos } from "@/lib/compras/sync";

/**
 * Job das tabelas de fornecedor por API. Puxa quem está com sincronização
 * vencida e reescreve o catálogo. Idempotente: reimportar a mesma tabela não
 * duplica item nem polui o histórico de preço.
 *
 * Agendamento: de hora em hora. A frequência real de cada fornecedor é a
 * configurada na integração — o job só olha quem já venceu.
 * Segurança: `Authorization: Bearer <CRON_SECRET>`.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function executar(req: Request) {
  const negado = autorizarCron(req);
  if (negado) return negado;

  const limite = Number(new URL(req.url).searchParams.get("limite") ?? 50);

  try {
    const r = await sincronizarCatalogosDevidos(Number.isFinite(limite) ? limite : 50);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao sincronizar catálogos.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = executar;
export const POST = executar;
