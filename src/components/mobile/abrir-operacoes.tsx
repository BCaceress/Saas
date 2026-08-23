"use client";

import * as React from "react";
import { ChevronRight, Plus } from "lucide-react";
import { NovaOperacaoSheet } from "@/components/mobile/nova-operacao";
import type { NavToggles } from "@/components/app/nav-config";
import type { Acesso } from "@/lib/permissoes";

/**
 * Ponte entre o "Mais" e a folha do botão do meio.
 *
 * O "Mais" só lista LUGARES; os verbos (contar, etiquetar, receber, pedir)
 * moram na folha "Nova operação". Sem esta linha, quem procurasse "Etiquetas"
 * no menu não acharia nada e concluiria que a tela sumiu — com ela, aprende em
 * um toque onde as operações passaram a morar.
 *
 * Monta uma instância PRÓPRIA da folha em vez de acionar a da barra: o estado
 * daquela vive dentro do `MobileTabBar`, e levantá-lo até um contexto só para
 * esta linha custaria mais do que uma segunda montagem — a folha só existe no
 * DOM depois do toque.
 *
 * Quem decide se a linha existe é a página, com `temOperacoes` — o portão fica
 * no servidor para a seção inteira não nascer vazia.
 */
export function AbrirOperacoes({
  acessos,
  toggles,
  multiSite,
}: {
  acessos: Acesso[];
  toggles: NavToggles;
  /** A empresa tem mais de um local ativo (esconde transferência na folha). */
  multiSite: boolean;
}) {
  const [aberta, setAberta] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-haspopup="dialog"
        aria-expanded={aberta}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <Plus className="h-5 w-5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">Nova operação</span>
          <span className="block text-xs text-muted">
            Contar, receber, etiquetar, mudar preço, pedir
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </button>

      <NovaOperacaoSheet
        open={aberta}
        onClose={() => setAberta(false)}
        acessos={acessos}
        toggles={toggles}
        multiSite={multiSite}
      />
    </>
  );
}
