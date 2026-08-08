"use client";

import * as React from "react";
import {
  contextoAcoesAction,
  type ContextoAcoes,
} from "@/app/(mobile)/m/acoes/actions";

/**
 * Lojas e permissões da pessoa — buscadas UMA VEZ por sessão de aba.
 *
 * A resposta não depende do produto: é a lista de lojas e o que este usuário
 * pode fazer. Sem memória, a barra de ações pagava uma ida ao servidor a cada
 * ficha aberta — e numa volta de gôndola são dezenas de fichas, cada uma com
 * uma consulta de lojas idêntica à anterior.
 *
 * A memória é a PROMESSA, não o valor: dois componentes montando ao mesmo tempo
 * (a ficha e a folha de operações) compartilham a mesma requisição em voo em
 * vez de disparar duas.
 *
 * Vive só na memória da aba. Recarregar a página busca de novo — que é o
 * comportamento certo: mudança de perfil ou de loja chega junto com o reload.
 */

let emCache: Promise<ContextoAcoes> | null = null;

export function contextoAcoes(): Promise<ContextoAcoes> {
  if (!emCache) {
    emCache = contextoAcoesAction().catch((e) => {
      // Falha não fica grudada: a próxima ficha tenta de novo em vez de herdar
      // um erro de rede momentâneo pelo resto da sessão.
      emCache = null;
      throw e;
    });
  }
  return emCache;
}

/** Descarta a memória — use depois de trocar de loja. */
export function esquecerContextoAcoes(): void {
  emCache = null;
}

/** `null` enquanto carrega. Não suspende: a barra aparece quando souber o que mostrar. */
export function useContextoAcoes(): ContextoAcoes | null {
  const [ctx, setCtx] = React.useState<ContextoAcoes | null>(null);

  React.useEffect(() => {
    let vivo = true;
    contextoAcoes()
      .then((c) => {
        if (vivo) setCtx(c);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  return ctx;
}
