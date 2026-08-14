"use client";

import { useEffect, useState } from "react";

export const LISTA_PRODUTOS = "/produtos";

/**
 * Para onde o cadastro volta.
 *
 * A listagem carrega filtros, ordenação, colunas e página na própria URL. Ao
 * abrir um cadastro ela manda essa URL no parâmetro `voltar`; salvar ou
 * cancelar devolve o operador exatamente à prateleira que ele estava olhando,
 * não ao topo de /produtos sem filtro nenhum.
 *
 * Lido depois da montagem (não em render) porque a leitura vem de
 * `window.location` — no servidor não existe, e um `useSearchParams` aqui
 * obrigaria fronteira de Suspense em toda tela de cadastro.
 */
export function useVoltaProdutos(): string {
  const [url, setUrl] = useState(LISTA_PRODUTOS);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("voltar");
    if (v) setUrl(`${LISTA_PRODUTOS}?${v}`);
  }, []);
  return url;
}
