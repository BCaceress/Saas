import { onlyDigits } from "./normalize";

/**
 * Cliente Cosmos Bluesoft (PRD §8.6). Roda SÓ no servidor — o token nunca vai
 * ao browser. Cache por EAN em memória (a base muda pouco) p/ economizar cota.
 */

export type CosmosResult = {
  ean: string;
  descricao: string | null;
  marca: string | null;
  ncm: string | null;
  cest: string | null;
  gpc: string | null;
  pesoLiquidoG: number | null;
  pesoBrutoG: number | null;
  larguraCm: number | null;
  alturaCm: number | null;
  comprimentoCm: number | null;
  thumbnail: string | null;
  raw: unknown; // JSON cru — repassado ao LLM
};

export class CosmosError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "RATE_LIMIT" | "NO_TOKEN" | "UPSTREAM"
  ) {
    super(message);
  }
}

const cache = new Map<string, CosmosResult>();

function toCm(mm: unknown): number | null {
  const n = typeof mm === "number" ? mm : Number(mm);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Cosmos retorna dimensões em mm; convertemos p/ cm.
  return Math.round((n / 10) * 100) / 100;
}

function toGrams(kg: unknown): number | null {
  const n = typeof kg === "number" ? kg : Number(kg);
  if (!Number.isFinite(n) || n <= 0) return null;
  // net_weight/gross_weight vêm em kg.
  return Math.round(n * 1000);
}

export async function getCosmosByEan(eanInput: string): Promise<CosmosResult> {
  const ean = onlyDigits(eanInput);
  if (!ean) throw new CosmosError("EAN vazio.", "NOT_FOUND");

  const cached = cache.get(ean);
  if (cached) return cached;

  const token = process.env.COSMOS_API_TOKEN;
  if (!token) throw new CosmosError("COSMOS_API_TOKEN não configurado.", "NO_TOKEN");

  // Base da API Cosmos. O domínio .io foi descontinuado (passou a apontar p/
  // página de terceiros); a API ativa fica em .com.br. Configurável via env.
  const baseUrl = process.env.COSMOS_API_URL ?? "https://api.cosmos.bluesoft.com.br";
  const res = await fetch(`${baseUrl}/gtins/${ean}.json`, {
    headers: {
      "X-Cosmos-Token": token,
      "User-Agent": process.env.COSMOS_USER_AGENT ?? "NoHubMarket/1.0",
      "Content-Type": "application/json",
    },
    // a base é estável; deixa o Next cachear a resposta upstream
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (res.status === 404) throw new CosmosError("EAN não encontrado na Cosmos.", "NOT_FOUND");
  if (res.status === 429) throw new CosmosError("Limite de cota da Cosmos atingido.", "RATE_LIMIT");
  if (!res.ok) throw new CosmosError(`Cosmos respondeu ${res.status}.`, "UPSTREAM");

  // Defesa: se o domínio devolver HTML (DNS sequestrado/parking), não é JSON —
  // trata como upstream em vez de estourar erro cru de parse.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new CosmosError("Resposta inesperada da Cosmos (não-JSON).", "UPSTREAM");
  }

  let data: Record<string, any>;
  try {
    data = (await res.json()) as Record<string, any>;
  } catch {
    throw new CosmosError("Não foi possível ler a resposta da Cosmos.", "UPSTREAM");
  }

  const result: CosmosResult = {
    ean,
    descricao: data.description ?? null,
    marca: data.brand?.name ?? null,
    ncm: data.ncm?.code ?? null,
    cest: data.cest?.code ?? null,
    gpc: data.gpc?.code ?? data.gpc ?? null,
    pesoLiquidoG: toGrams(data.net_weight),
    pesoBrutoG: toGrams(data.gross_weight),
    larguraCm: toCm(data.width),
    alturaCm: toCm(data.height),
    comprimentoCm: toCm(data.length),
    thumbnail: data.thumbnail ?? null,
    raw: data,
  };

  cache.set(ean, result);
  return result;
}
