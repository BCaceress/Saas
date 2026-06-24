import { NextResponse } from "next/server";
import { onlyDigits } from "@/lib/normalize";

/**
 * Proxy BrasilAPI — CNPJ v1 (https://brasilapi.com.br/docs#tag/CNPJ):
 * GET /cnpj/v1/{cnpj} devolve dados da Receita. Preenche razão social, nome
 * fantasia, telefone e e-mail. Sem auth — roda no servidor.
 *
 * A API é servida por Cloudflare e tem rate limit; sem User-Agent/Accept a
 * requisição pode ser bloqueada (403) ou estrangulada (429). Por isso mandamos
 * cabeçalhos explícitos e tratamos cada status separadamente.
 */
type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string | null;
  descricao_situacao_cadastral?: string;
  cep?: string | number | null;
  descricao_tipo_de_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
};

/** Junta "AVENIDA" + "PAULISTA" sem duplicar espaços nem repetir o tipo. */
function montarLogradouro(d: BrasilApiCnpj): string {
  const tipo = (d.descricao_tipo_de_logradouro ?? "").trim();
  const via = (d.logradouro ?? "").trim();
  if (!via) return "";
  if (tipo && !via.toUpperCase().startsWith(tipo.toUpperCase())) return `${tipo} ${via}`;
  return via;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cnpj: string }> }
) {
  const { cnpj: raw } = await params;
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido." }, { status: 400 });
  }

  const baseUrl = process.env.BRASILAPI_URL ?? "https://brasilapi.com.br/api";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/cnpj/v1/${cnpj}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "NoHubMarket/1.0 (+https://nohub.market)",
      },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 60 * 60 * 24 },
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return NextResponse.json(
      { error: timeout ? "A consulta demorou demais. Tente de novo." : "Falha ao consultar o CNPJ." },
      { status: 504 }
    );
  }

  if (res.status === 404) {
    return NextResponse.json({ error: "CNPJ não encontrado na Receita." }, { status: 404 });
  }
  if (res.status === 429) {
    return NextResponse.json(
      { error: "Muitas consultas em sequência. Aguarde um instante e tente de novo." },
      { status: 429 }
    );
  }
  if (!res.ok) {
    console.error(`[cnpj] BrasilAPI respondeu ${res.status} para ${cnpj}`);
    return NextResponse.json({ error: "Consulta indisponível no momento." }, { status: 502 });
  }

  const d = (await res.json()) as BrasilApiCnpj;
  return NextResponse.json({
    cnpj,
    razaoSocial: d.razao_social ?? "",
    nomeFantasia: d.nome_fantasia ?? "",
    telefone: d.ddd_telefone_1 || d.ddd_telefone_2 || "",
    email: d.email ?? "",
    situacao: d.descricao_situacao_cadastral ?? "",
    cep: d.cep != null ? onlyDigits(String(d.cep)) : "",
    logradouro: montarLogradouro(d),
    numero: d.numero ?? "",
    complemento: d.complemento ?? "",
    bairro: d.bairro ?? "",
    municipio: d.municipio ?? "",
    uf: d.uf ?? "",
  });
}
