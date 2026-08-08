"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackageOpen, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { AcaoEstoqueSheet, type Acao } from "@/components/mobile/acao-estoque";
import {
  coberturaDias,
  mediaDiaria,
  nivelCobertura,
  fmtCobertura,
  NIVEL_COBERTURA_LABEL,
  type EstoquePolicy,
  type NivelCobertura,
} from "@/lib/estoque-estrategia";
import type { SaldoMobile } from "./_data";

type Site = { id: string; nome: string };

type Filtro = "tudo" | "sem" | "minimo" | "vencendo" | "sem-giro";

const FILTRO_LABEL: Record<Filtro, string> = {
  tudo: "Tudo",
  sem: "Sem estoque",
  minimo: "Abaixo do mínimo",
  vencendo: "Vencendo",
  "sem-giro": "Sem giro",
};

const NIVEL_COR: Record<NivelCobertura, string> = {
  "muito-baixo": "text-danger",
  atencao: "text-warn",
  ideal: "text-ok",
  "sem-giro": "text-muted",
};

/**
 * Lista de saldos com filtro por chip e ações rápidas.
 *
 * Cada item é um cartão, não linha de tabela: a tela de saldos do desktop já
 * faz essa troca em `md:hidden` (`estoque/saldos/_client.tsx`), aqui o cartão
 * é o único formato — não há tabela para esconder.
 */
export function EstoqueClient({
  saldos,
  sites,
  siteAtivo,
  policy,
  filtroInicial,
  totalVencendo,
  podeAjustar,
  podeTransferir,
}: {
  saldos: SaldoMobile[];
  sites: Site[];
  siteAtivo: string | null;
  policy: EstoquePolicy;
  filtroInicial: string | null;
  totalVencendo: number;
  podeAjustar: boolean;
  podeTransferir: boolean;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = React.useState<Filtro>(
    (["sem", "minimo", "vencendo", "sem-giro"] as const).includes(filtroInicial as never)
      ? (filtroInicial as Filtro)
      : "tudo",
  );
  const [busca, setBusca] = React.useState("");
  const [alvo, setAlvo] = React.useState<{ row: SaldoMobile; acao: Acao } | null>(null);

  const linhas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return saldos.filter((s) => {
      if (termo && !`${s.nome} ${s.sku} ${s.ean ?? ""}`.toLowerCase().includes(termo)) {
        return false;
      }
      switch (filtro) {
        case "sem":
          return s.estoqueFechado <= 0 && s.controlaEstoque;
        case "minimo":
          return s.abaixoMinimo;
        case "sem-giro":
          return s.consumo30 <= 0 && s.controlaEstoque;
        case "vencendo":
          // O saldo não carrega validade; o filtro é atalho para a tela que a
          // tem. Marcado como link no chip, não como filtro local.
          return true;
        default:
          return true;
      }
    });
  }, [saldos, filtro, busca]);

  const contagem = React.useMemo(
    () => ({
      sem: saldos.filter((s) => s.estoqueFechado <= 0 && s.controlaEstoque).length,
      minimo: saldos.filter((s) => s.abaixoMinimo).length,
      "sem-giro": saldos.filter((s) => s.consumo30 <= 0 && s.controlaEstoque).length,
    }),
    [saldos],
  );

  function concluir(mensagem: string) {
    setAlvo(null);
    toast.success(mensagem);
    // Recarrega os dados do servidor: o saldo mudou e a lista precisa refletir.
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, SKU ou código"
          aria-label="Buscar produto"
          className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip ativo={filtro === "tudo"} onClick={() => setFiltro("tudo")}>
          {FILTRO_LABEL.tudo} {saldos.length}
        </Chip>
        <Chip ativo={filtro === "sem"} onClick={() => setFiltro("sem")}>
          {FILTRO_LABEL.sem} {contagem.sem}
        </Chip>
        {policy.usaMinimo && (
          <Chip ativo={filtro === "minimo"} onClick={() => setFiltro("minimo")}>
            {FILTRO_LABEL.minimo} {contagem.minimo}
          </Chip>
        )}
        <Chip ativo={filtro === "sem-giro"} onClick={() => setFiltro("sem-giro")}>
          {FILTRO_LABEL["sem-giro"]} {contagem["sem-giro"]}
        </Chip>
        {/* Validade mora nos lotes, não no saldo: em vez de um filtro que
            mentiria, o chip leva para a tela que tem o dado. */}
        <ChipLink href="/estoque/validade">
          {FILTRO_LABEL.vencendo} {totalVencendo}
        </ChipLink>
      </div>

      {linhas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <PackageOpen className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">Nada por aqui</p>
          <p className="text-sm text-ink-2">
            {busca
              ? "Nenhum produto com esse termo."
              : "Nenhum item neste filtro — o que é uma boa notícia."}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {linhas.map((s) => (
            <LinhaProduto
              key={s.productId}
              row={s}
              policy={policy}
              podeAjustar={podeAjustar}
              podeTransferir={podeTransferir}
              onAcao={(acao) => setAlvo({ row: s, acao })}
            />
          ))}
        </ul>
      )}

      {alvo && (
        <AcaoEstoqueSheet
          alvo={alvo.row}
          acao={alvo.acao}
          sites={sites}
          siteAtivo={siteAtivo}
          onFechar={() => setAlvo(null)}
          onConcluir={concluir}
        />
      )}
    </div>
  );
}

function LinhaProduto({
  row,
  policy,
  podeAjustar,
  podeTransferir,
  onAcao,
}: {
  row: SaldoMobile;
  policy: EstoquePolicy;
  podeAjustar: boolean;
  podeTransferir: boolean;
  onAcao: (acao: Acao) => void;
}) {
  const media = mediaDiaria(row.consumoJanela, row.janelaDias);
  const dias = coberturaDias(row.estoqueFechado, media);
  const nivel = nivelCobertura(dias, policy.diasCobertura);

  return (
    <li>
      <Card className="overflow-hidden">
        <Link
          href={`/m/produto/${row.productId}`}
          className="flex items-center gap-3 p-3 hover:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{row.nome}</p>
            <p className="truncate font-mono text-[11px] text-muted">{row.sku}</p>
            {row.controlaEstoque && (
              <p className={cn("mt-0.5 text-xs font-medium", NIVEL_COR[nivel])}>
                {nivel === "sem-giro"
                  ? NIVEL_COBERTURA_LABEL["sem-giro"]
                  : `dura ${fmtCobertura(dias)}`}
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            <p
              className={cn(
                "font-display text-xl leading-none font-semibold tabular-nums",
                row.estoqueFechado <= 0 ? "text-danger" : "text-ink",
              )}
            >
              {row.estoqueFechado.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
            </p>
            {row.estoqueAberto > 0 && (
              <p className="text-xs text-accent tabular-nums">
                +{row.estoqueAberto.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} aberto
              </p>
            )}
          </div>
        </Link>

        {(podeAjustar || podeTransferir) && (
          <div className="flex divide-x divide-line border-t border-line">
            {podeAjustar && (
              <>
                <BotaoAcao onClick={() => onAcao("ajuste")}>Ajustar</BotaoAcao>
                <BotaoAcao onClick={() => onAcao("perda")}>Perda</BotaoAcao>
              </>
            )}
            {podeTransferir && (
              <BotaoAcao onClick={() => onAcao("transferencia")}>Transferir</BotaoAcao>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function BotaoAcao({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 flex-1 cursor-pointer text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-9 shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2",
      )}
    >
      {children}
    </button>
  );
}

function ChipLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-line-button bg-surface px-3 text-[13px] font-medium whitespace-nowrap text-ink-2"
    >
      <SlidersHorizontal className="h-3 w-3" aria-hidden />
      {children}
    </Link>
  );
}
