import { ConectorError, type ConectorFornecedor, type Fonte } from "../types";
import { lerJsonNormalizado } from "./json";

// ============================================================
// API do fornecedor. Hoje nenhum grande distribuidor publica um contrato
// comum, então o conector é deliberadamente burro: faz GET autenticado, espera
// JSON e joga no mesmo normalizador do arquivo JSON. Quando um fornecedor
// publicar contrato próprio, ele ganha um conector dedicado ao lado deste —
// sem mexer no ingest nem nas telas.
// ============================================================

const TIMEOUT_MS = 30_000;

export const apiConnector: ConectorFornecedor = {
  kind: "API",
  rotulo: "API",
  extensoes: [],

  async ler(fonte: Fonte, ctx) {
    if (fonte.tipo !== "api") throw new ConectorError("O conector de API espera uma integração configurada.");
    if (!fonte.endpoint) throw new ConectorError("Integração sem endpoint configurado.");

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(fonte.headers ?? {}),
    };
    if (fonte.credencial) {
      if (fonte.authTipo === "basic") headers.Authorization = `Basic ${fonte.credencial}`;
      else if (fonte.authTipo === "apikey") headers["X-API-Key"] = fonte.credencial;
      else headers.Authorization = `Bearer ${fonte.credencial}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let resposta: Response;
    try {
      resposta = await fetch(fonte.endpoint, { headers, signal: controller.signal, cache: "no-store" });
    } catch (e) {
      const motivo = e instanceof Error && e.name === "AbortError" ? "tempo esgotado" : "falha de conexão";
      throw new ConectorError(`Não consegui falar com a API do fornecedor (${motivo}).`);
    } finally {
      clearTimeout(timer);
    }

    if (!resposta.ok) {
      throw new ConectorError(`A API do fornecedor respondeu ${resposta.status}.`);
    }

    let dados: unknown;
    try {
      dados = await resposta.json();
    } catch {
      throw new ConectorError("A API do fornecedor não devolveu JSON.");
    }

    return lerJsonNormalizado(dados, ctx.mapeamento);
  },
};
