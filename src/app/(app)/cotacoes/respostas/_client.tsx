"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  FileUp,
  Inbox,
  Link as LinkIcon,
  MessageSquare,
  PencilLine,
  Plug,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EstadoVazio,
  Metrica,
  MetricaGrid,
  SupplierAvatar,
  fmtMoney,
  fmtQuando,
} from "../_catalogo/ui";
import type { CanalResposta, EstadoResposta, RespostaRow, ResumoRespostas } from "./_types";

// ── Central de Respostas ────────────────────────────────────
// Uma caixa de entrada, não duas telas. O fornecedor responde do jeito dele —
// link, arquivo, API ou recado transcrito — e tudo cai na mesma lista, na
// ordem em que chegou. O que pede gente sobe: REVISAR e ERRO antes do resto.

const CANAL: Record<CanalResposta, { label: string; icone: typeof LinkIcon }> = {
  LINK: { label: "Link", icone: LinkIcon },
  OPERADOR: { label: "Registrado na loja", icone: PencilLine },
  ARQUIVO: { label: "Arquivo", icone: FileUp },
  API: { label: "Integração", icone: Plug },
};

const ESTADO: Record<EstadoResposta, { label: string; classe: string }> = {
  AGUARDANDO: { label: "Aguardando", classe: "bg-surface-2 text-muted" },
  LIDO: { label: "Abriu o link", classe: "bg-brand-soft text-brand" },
  PROCESSANDO: { label: "Processando", classe: "bg-brand-soft text-brand" },
  CHEGOU: { label: "Respondeu", classe: "bg-ok-soft text-ok" },
  REVISAR: { label: "Revisar", classe: "bg-warn-soft text-warn" },
  RECUSADO: { label: "Não vai cotar", classe: "bg-surface-2 text-faint" },
  ERRO: { label: "Falhou", classe: "bg-danger-soft text-danger" },
};

type Aba = "tudo" | "pendente" | "revisar" | "aguardando";

const ABAS: { id: Aba; label: string }[] = [
  { id: "tudo", label: "Tudo" },
  { id: "pendente", label: "Chegou" },
  { id: "revisar", label: "Precisa de você" },
  { id: "aguardando", label: "Aguardando" },
];

export function CentralRespostas({
  linhas,
  resumo,
}: {
  linhas: RespostaRow[];
  resumo: ResumoRespostas;
}) {
  const [aba, setAba] = useState<Aba>("tudo");
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (aba === "pendente" && l.estado !== "CHEGOU" && l.estado !== "REVISAR") return false;
      if (aba === "revisar" && l.estado !== "REVISAR" && l.estado !== "ERRO") return false;
      if (aba === "aguardando" && l.estado !== "AGUARDANDO" && l.estado !== "LIDO") return false;
      if (!termo) return true;
      return (
        l.supplierNome.toLowerCase().includes(termo) || l.titulo.toLowerCase().includes(termo)
      );
    });
  }, [linhas, aba, busca]);

  return (
    <div className="flex flex-col gap-5">
      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Aguardando"
          valor={String(resumo.aguardando)}
          sub="perguntas sem resposta"
          icon={<Clock size={12} />}
        />
        <Metrica
          label="Chegaram hoje"
          valor={String(resumo.chegaramHoje)}
          tom="ok"
          icon={<Inbox size={12} />}
        />
        <Metrica
          label="Precisam de você"
          valor={String(resumo.precisamRevisao)}
          sub="item sem vínculo ou leitura falhada"
          tom={resumo.precisamRevisao > 0 ? "accent" : "ink"}
          icon={<AlertTriangle size={12} />}
        />
        <Metrica
          label="Última resposta"
          valor={resumo.ultimaEm ? fmtQuando(resumo.ultimaEm) : "—"}
          icon={<MessageSquare size={12} />}
        />
      </MetricaGrid>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              aria-pressed={aba === a.id}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                aba === a.id
                  ? "bg-brand text-on-brand"
                  : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        <label className="relative flex min-w-56 flex-1 items-center sm:max-w-72">
          <Search size={15} className="pointer-events-none absolute left-3 text-faint" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar fornecedor ou assunto"
            className="h-9 w-full rounded-full border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
          />
        </label>
      </div>

      {visiveis.length === 0 ? (
        <EstadoVazio
          icon={<Inbox size={20} />}
          titulo="Nada por aqui ainda"
          descricao="Assim que um fornecedor responder uma cotação ou uma tabela de preço for importada, a resposta aparece nesta lista — não importa por qual canal ela chegou."
          acao={
            <Link
              href="/cotacoes"
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              Pedir uma cotação
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {visiveis.map((l) => {
            const canal = CANAL[l.canal];
            const IconeCanal = canal.icone;
            const estado = ESTADO[l.estado];
            return (
              <li key={l.id}>
                <Link
                  href={l.href}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <SupplierAvatar nome={l.supplierNome} size={36} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {l.supplierNome}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          estado.classe,
                        )}
                      >
                        {estado.label}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-faint">
                        <IconeCanal size={11} />
                        {canal.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-ink-2">{l.titulo}</p>
                    <p className="truncate text-[12px] text-muted">{l.detalhe}</p>
                  </div>

                  <div className="shrink-0 text-right">
                    {l.valor !== null && (
                      <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                        {fmtMoney(l.valor)}
                      </p>
                    )}
                    <p className="text-[11px] text-faint">{fmtQuando(l.quando)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
