import { onlyDigits } from "./normalize";

/**
 * Foto de produto por código de barras, na CDN pública da Cosmos Bluesoft.
 * Roda SÓ no servidor. Cache por EAN em memória (a base muda pouco).
 *
 * Só a foto. A API de dados da Cosmos (descrição, marca, NCM) saiu do sistema:
 * ela cobra franquia por consulta e o plano não se paga. A foto mora em um
 * endereço previsível por EAN, sem token e sem cota.
 *
 * Não é contrato: é a CDN do site deles. Se mudar o endereço ou passar a exigir
 * credencial, o sintoma é `RATE_LIMIT`/`UPSTREAM` aqui.
 */

export class CosmosError extends Error {
  constructor(
    message: string,
    readonly code: "RATE_LIMIT" | "UPSTREAM"
  ) {
    super(message);
  }
}

const CDN_IMAGEM = "https://cdn-cosmos.bluesoft.com.br/products";
const cache = new Map<string, string | null>();

/**
 * URL da foto do produto, ou `null` quando a base não tem foto para o código
 * (404). Bloqueio ou falha de rede viram `CosmosError`, para o chamador
 * distinguir "não existe" de "não deu".
 */
export async function getImagemCosmosPorEan(eanInput: string): Promise<string | null> {
  const ean = onlyDigits(eanInput);
  if (!ean) return null;

  const cached = cache.get(ean);
  if (cached !== undefined) return cached;

  const url = `${CDN_IMAGEM}/${ean}`;
  let res: Response;
  try {
    // HEAD: basta saber se existe — quem baixa a foto é o browser/otimizador.
    res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": process.env.COSMOS_USER_AGENT ?? "NoHubMarket/1.0" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    // Falha de rede/DNS/TLS/timeout — vira erro tratável em vez de estourar 500.
    throw new CosmosError("Não foi possível alcançar a base de imagens.", "UPSTREAM");
  }

  if (res.status === 404) {
    cache.set(ean, null);
    return null;
  }
  if (res.status === 403 || res.status === 429) {
    throw new CosmosError("A base de imagens recusou a consulta.", "RATE_LIMIT");
  }
  if (!res.ok) throw new CosmosError(`Base de imagens respondeu ${res.status}.`, "UPSTREAM");

  cache.set(ean, url);
  return url;
}
