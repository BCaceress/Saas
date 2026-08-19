import { NextResponse } from "next/server";
import { autorizarCron } from "@/lib/cron";
import { sincronizarDistribuicaoTodos } from "@/lib/fiscal/distribuicao";

/**
 * Pergunta à SEFAZ, de tempos em tempos, o que os fornecedores emitiram contra
 * o CNPJ de cada loja. Com `manifestacaoAutomatica` ligada, dá ciência sozinho
 * nas notas de fornecedor conhecido e a nota chega completa — sem clique.
 *
 * Agendamento: 2×/dia basta (a SEFAZ não entrega em tempo real e o serviço tem
 * limite de consultas por CNPJ). No plano Hobby roda dentro de `/api/jobs/diario`.
 * Idempotente: a chave da NF-e é única por tenant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function executar(req: Request) {
  const negado = autorizarCron(req);
  if (negado) return negado;

  try {
    const r = await sincronizarDistribuicaoTodos();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao consultar a distribuição da SEFAZ.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return executar(req);
}

export async function POST(req: Request) {
  return executar(req);
}
