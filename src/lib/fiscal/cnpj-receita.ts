import "server-only";

// ============================================================
// Dados cadastrais do CNPJ na Receita (BrasilAPI) para pré-preencher o
// emitente quando o operador só tem o certificado A1 em mãos.
//
// Best-effort: BrasilAPI tem rate limit e cai às vezes. Quem chama decide o
// que fazer com `null` — receber nota pela SEFAZ só precisa do CNPJ e da UF.
// ============================================================

export type CnpjReceita = {
  razaoSocial: string;
  nomeFantasia: string;
  telefone: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
};

type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  cep?: string | number | null;
  descricao_tipo_de_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  codigo_municipio_ibge?: string | number | null;
  uf?: string | null;
};

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function consultarCnpjReceita(cnpj: string): Promise<CnpjReceita | null> {
  const baseUrl = process.env.BRASILAPI_URL ?? "https://brasilapi.com.br/api";
  try {
    const res = await fetch(`${baseUrl}/cnpj/v1/${digitos(cnpj)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "NoHubMarket/1.0 (+https://nohub.market)",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const d = (await res.json()) as BrasilApiCnpj;

    const tipo = (d.descricao_tipo_de_logradouro ?? "").trim();
    const via = (d.logradouro ?? "").trim();
    const logradouro =
      via && tipo && !via.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${via}` : via;

    return {
      razaoSocial: (d.razao_social ?? "").trim(),
      nomeFantasia: (d.nome_fantasia ?? "").trim(),
      telefone: digitos(d.ddd_telefone_1 || d.ddd_telefone_2),
      cep: digitos(d.cep),
      logradouro,
      numero: (d.numero ?? "").trim(),
      complemento: (d.complemento ?? "").trim(),
      bairro: (d.bairro ?? "").trim(),
      municipio: (d.municipio ?? "").trim(),
      codigoMunicipio: digitos(d.codigo_municipio_ibge),
      uf: (d.uf ?? "").trim().toUpperCase(),
    };
  } catch {
    return null;
  }
}
