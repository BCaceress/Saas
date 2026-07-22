import { NextResponse } from "next/server";

/**
 * Proxy BrasilAPI — IBGE municípios (https://brasilapi.com.br/docs#tag/IBGE):
 * GET /ibge/municipios/v1/{uf} devolve a lista da UF com o código IBGE.
 *
 * Serve ao cadastro fiscal: a NF-e exige o código de 7 dígitos do município,
 * não o nome. Ninguém decora isso — a tela busca a partir de cidade + UF.
 * Lista por UF é estável; cache de 30 dias.
 */
type Municipio = { nome?: string; codigo_ibge?: string };

/** "São José do Rio Prêto" → "SAO JOSE DO RIO PRETO" (acento/caixa não podem derrubar a busca). */
function chave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uf = (searchParams.get("uf") ?? "").trim().toUpperCase();
  const municipio = (searchParams.get("municipio") ?? "").trim();

  if (uf.length !== 2) {
    return NextResponse.json({ error: "Informe a UF com 2 letras." }, { status: 400 });
  }
  if (!municipio) {
    return NextResponse.json({ error: "Informe o município." }, { status: 400 });
  }

  const baseUrl = process.env.BRASILAPI_URL ?? "https://brasilapi.com.br/api";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/ibge/municipios/v1/${uf}?providers=dados-abertos-br,gov,wikipedia`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "NoHubMarket/1.0 (+https://nohub.market)",
      },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timeout
          ? "A consulta demorou demais. Tente de novo."
          : "Falha ao consultar a lista de municípios.",
      },
      { status: 504 },
    );
  }

  if (res.status === 404) {
    return NextResponse.json({ error: `UF ${uf} não encontrada.` }, { status: 404 });
  }
  if (!res.ok) {
    console.error(`[ibge] BrasilAPI respondeu ${res.status} para ${uf}`);
    return NextResponse.json({ error: "Consulta indisponível no momento." }, { status: 502 });
  }

  const lista = (await res.json()) as Municipio[];
  const alvo = chave(municipio);
  const achado = lista.find((m) => chave(m.nome ?? "") === alvo);

  if (!achado?.codigo_ibge) {
    return NextResponse.json(
      { error: `Município "${municipio}" não encontrado em ${uf}. Confira o nome.` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    municipio: achado.nome,
    uf,
    // A BrasilAPI devolve o código com 7 dígitos; alguns provedores mandam com
    // dígito extra — cortamos para o formato que a SEFAZ espera.
    codigoMunicipio: String(achado.codigo_ibge).slice(0, 7),
  });
}
