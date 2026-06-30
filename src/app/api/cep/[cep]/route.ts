import { NextResponse } from "next/server";
import { onlyDigits } from "@/lib/normalize";

/**
 * Proxy BrasilAPI — CEP v2 (https://brasilapi.com.br/docs#tag/CEP-V2):
 * GET /cep/v2/{cep} devolve o endereço. Preenche rua, bairro, cidade e UF.
 * Sem auth — roda no servidor. Cloudflare na frente tem rate limit; mandamos
 * User-Agent/Accept e tratamos cada status separadamente.
 */
type BrasilApiCep = {
  cep?: string;
  state?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  street?: string | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cep: string }> }
) {
  const { cep: raw } = await params;
  const cep = onlyDigits(raw);
  if (cep.length !== 8) {
    return NextResponse.json({ error: "CEP inválido." }, { status: 400 });
  }

  const baseUrl = process.env.BRASILAPI_URL ?? "https://brasilapi.com.br/api";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/cep/v2/${cep}`, {
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
      { error: timeout ? "A consulta demorou demais. Tente de novo." : "Falha ao consultar o CEP." },
      { status: 504 }
    );
  }

  if (res.status === 404) {
    return NextResponse.json({ error: "CEP não encontrado." }, { status: 404 });
  }
  if (res.status === 429) {
    return NextResponse.json(
      { error: "Muitas consultas em sequência. Aguarde um instante e tente de novo." },
      { status: 429 }
    );
  }
  if (!res.ok) {
    console.error(`[cep] BrasilAPI respondeu ${res.status} para ${cep}`);
    return NextResponse.json({ error: "Consulta indisponível no momento." }, { status: 502 });
  }

  const d = (await res.json()) as BrasilApiCep;
  return NextResponse.json({
    cep,
    rua: d.street ?? "",
    bairro: d.neighborhood ?? "",
    cidade: d.city ?? "",
    estado: d.state ?? "",
  });
}
