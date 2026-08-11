"use client";

import * as React from "react";
import { CalendarRange, Loader2, Trash2 } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { TecladoNumerico, paraNumero } from "@/components/mobile/teclado-numerico";
import { Chip } from "@/components/mobile/acao-estoque";
import {
  agendarPromocaoAction,
  cancelarPromocaoAction,
  promocoesDoProdutoAction,
} from "@/app/(mobile)/m/acoes/actions";
import type { PromocaoRow } from "@/lib/promocoes";
import type { FichaProduto } from "@/app/(mobile)/m/_produto-data";

/**
 * Agenda de promoção do produto.
 *
 * Promoção aqui é DATA, não interruptor: preço, começo e fim. O preço do
 * cadastro fica intocado e volta sozinho quando a janela fecha — quem baixa o
 * preço no sábado não precisa lembrar de subir na segunda, que é como preço de
 * encarte vira preço definitivo por engano.
 *
 * A agenda existente aparece na mesma tela porque a pergunta que traz a pessoa
 * aqui costuma ser "esse produto já está em promoção?", e não "quero criar
 * mais uma".
 *
 * Módulo próprio com export default para entrar por `dynamic()` — ver
 * `acoes-produto.tsx`.
 */
export default function PromocaoSheet({
  ficha,
  sites,
  siteAtivo,
  onFechar,
  onConcluir,
}: {
  ficha: FichaProduto;
  sites: Array<{ id: string; nome: string }>;
  siteAtivo: string | null;
  onFechar: () => void;
  onConcluir: (mensagem: string) => void;
}) {
  const [valor, setValor] = React.useState("");
  const [inicio, setInicio] = React.useState(hoje);
  const [fim, setFim] = React.useState(hoje);
  // Uma loja só: não há escolha a fazer, a promoção é dela.
  const [loja, setLoja] = React.useState<string | null>(sites.length > 1 ? siteAtivo : null);
  const [salvando, setSalvando] = React.useState(false);
  const [agenda, setAgenda] = React.useState<PromocaoRow[] | null>(null);

  React.useEffect(() => {
    let vivo = true;
    promocoesDoProdutoAction(ficha.id)
      .then((r) => vivo && setAgenda(r))
      .catch(() => vivo && setAgenda([]));
    return () => {
      vivo = false;
    };
  }, [ficha.id]);

  const preco = paraNumero(valor);
  const base = ficha.precoVenda;
  const desconto = base && preco > 0 && preco < base ? ((base - preco) / base) * 100 : null;
  const acimaDoPreco = base != null && preco > base;
  const podeSalvar = preco > 0 && fim >= inicio && !salvando;

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      await agendarPromocaoAction({
        productId: ficha.id,
        siteId: loja,
        preco,
        inicio,
        fim,
        nome: null,
      });
      onConcluir(
        `${ficha.nome} a ${brl(preco)} de ${fmtDia(inicio)} a ${fmtDia(fim)}${
          loja ? ` em ${sites.find((s) => s.id === loja)?.nome ?? "uma loja"}` : ""
        }.`,
      );
    } catch (e) {
      toast.error(
        "Não foi possível agendar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar(id: string) {
    try {
      await cancelarPromocaoAction(id);
      setAgenda((a) => (a ?? []).filter((p) => p.id !== id));
      toast.success("Promoção encerrada", "O preço volta ao do cadastro.");
    } catch (e) {
      toast.error(
        "Não foi possível encerrar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    }
  }

  const emCartaz = (agenda ?? []).filter((p) => p.ativo && new Date(p.fim) >= new Date());

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo="Agendar promoção"
      descricao={
        <span className="line-clamp-1">
          {ficha.nome} · <span className="font-mono text-xs">{ficha.sku}</span>
        </span>
      }
      rodape={
        <Button onClick={salvar} disabled={!podeSalvar} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Agendar promoção
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            <span className="mr-1 text-base font-normal text-muted">R$</span>
            {valor === "" ? "0,00" : valor}
          </p>
          <p className="mt-1 text-xs text-muted">
            preço normal: {base == null ? "sem preço" : brl(base)}
          </p>
        </div>

        {desconto != null && (
          <p className="rounded-lg bg-ok-soft px-3 py-2 text-center text-[13px] font-medium text-ok">
            {desconto.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% de desconto ·{" "}
            {brl((base ?? 0) - preco)} a menos por unidade.
          </p>
        )}
        {acimaDoPreco && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-center text-[13px] font-medium text-warn">
            Esse valor é maior que o preço normal — confira antes de agendar.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <CampoData rotulo="Começa" valor={inicio} onChange={setInicio} />
          <CampoData rotulo="Termina" valor={fim} min={inicio} onChange={setFim} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ATALHOS.map((a) => (
            <Chip
              key={a.label}
              ativo={inicio === hoje() && fim === a.fim()}
              onClick={() => {
                setInicio(hoje());
                setFim(a.fim());
              }}
            >
              {a.label}
            </Chip>
          ))}
        </div>

        {sites.length > 1 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Onde vale</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip ativo={loja === null} onClick={() => setLoja(null)}>
                Todas as lojas
              </Chip>
              {sites.map((s) => (
                <Chip key={s.id} ativo={loja === s.id} onClick={() => setLoja(s.id)}>
                  {s.nome}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <TecladoNumerico valor={valor} onChange={setValor} decimais={2} />

        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            Promoções deste produto
          </h3>
          {agenda === null ? (
            <div className="h-10 animate-pulse rounded-lg bg-surface-2" aria-hidden />
          ) : emCartaz.length === 0 ? (
            <p className="text-[13px] text-muted">
              Nenhuma promoção agendada. Fora das datas, vale o preço do cadastro.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {emCartaz.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {brl(p.preco)}
                      {p.vigente && (
                        <span className="ml-1.5 rounded-full bg-ok-soft px-1.5 py-0.5 text-[11px] font-semibold text-ok">
                          no ar
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {fmtDia(p.inicio)} – {fmtDia(p.fim)} ·{" "}
                      {p.siteNome ?? "todas as lojas"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancelar(p.id)}
                    aria-label="Encerrar promoção"
                    className={cn(
                      "grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full",
                      "text-muted hover:bg-danger-soft hover:text-danger",
                      "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                    )}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

function CampoData({
  rotulo,
  valor,
  min,
  onChange,
}: {
  rotulo: string;
  valor: string;
  min?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-2">{rotulo}</span>
      {/* `input[type=date]` de propósito: o seletor nativo do aparelho é maior e
          mais rápido que qualquer calendário desenhado por nós. */}
      <input
        type="date"
        value={valor}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      />
    </label>
  );
}

/** `YYYY-MM-DD` de hoje no fuso do aparelho — formato que o input espera. */
function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Janelas que o operador realmente usa: o dia, o fim de semana, a semana. */
const ATALHOS = [
  { label: "Só hoje", fim: () => hoje() },
  { label: "3 dias", fim: () => emDias(2) },
  { label: "7 dias", fim: () => emDias(6) },
  { label: "15 dias", fim: () => emDias(14) },
];

function fmtDia(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
