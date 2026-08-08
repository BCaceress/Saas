"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Cake,
  ChevronRight,
  Plus,
  Search,
  Send,
  Star,
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { onlyDigits } from "@/lib/normalize";
import { tierFromGasto, fmtDiasAtras } from "@/lib/customers";
import type { TierThresholds } from "@/lib/customers";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { MCard, Avatar } from "@/components/mobile/ui";
import { toast } from "@/components/ui/toast";
import { sendCoupon } from "@/app/(app)/clientes/actions";
import type { CustomerRow, CouponCandidate } from "@/app/(app)/clientes/_types";
import { DetalheCliente } from "./_detalhe";
import { FormCliente } from "./_form";

type Filtro = "todos" | "oportunidades" | "inativos";

/**
 * Lista de clientes no celular.
 *
 * Sem o menu de três pontos por linha do desktop: o cartão inteiro é um alvo só
 * e abre o painel, onde as ações moram com nome e área de toque de verdade. O
 * único atalho que fica na lista é o de cupom — e só dentro do filtro de
 * oportunidades, onde ele É o conteúdo da linha.
 */
export function ClientesMobileClient({
  rows,
  candidates,
  cupomDiasRisco,
  tierThresholds,
  podeEditar,
}: {
  rows: CustomerRow[];
  candidates: CouponCandidate[];
  cupomDiasRisco: number;
  tierThresholds: TierThresholds;
  podeEditar: boolean;
}) {
  const [filtro, setFiltro] = React.useState<Filtro>("todos");
  const [busca, setBusca] = React.useState("");
  const [aberto, setAberto] = React.useState<CustomerRow | null>(null);
  const [form, setForm] = React.useState<CustomerRow | "novo" | null>(null);

  const pendentes = React.useMemo(
    () => candidates.filter((c) => !c.jaEnviado),
    [candidates],
  );
  const inativos = React.useMemo(() => rows.filter((c) => !c.ativo), [rows]);

  const casa = React.useCallback(
    (nome: string, cpf: string | null, whatsapp: string | null) => {
      const termo = busca.trim().toLowerCase();
      if (!termo) return true;
      if (nome.toLowerCase().includes(termo)) return true;
      // Dígitos só valem a partir de 3: com um ou dois, CPF e telefone casam
      // com quase todo mundo e a busca por nome some no meio do resultado.
      const dig = onlyDigits(termo);
      return dig.length >= 3 && Boolean(cpf?.includes(dig) || whatsapp?.includes(dig));
    },
    [busca],
  );

  const lista = React.useMemo(
    () =>
      (filtro === "inativos" ? inativos : rows).filter((c) =>
        casa(c.nome, c.cpf, c.whatsapp),
      ),
    [rows, inativos, filtro, casa],
  );

  const listaOportunidades = React.useMemo(
    () => pendentes.filter((c) => casa(c.nome, null, c.whatsapp)),
    [pendentes, casa],
  );

  const porId = React.useMemo(() => new Map(rows.map((c) => [c.id, c])), [rows]);

  return (
    <div className="space-y-3">
      <MobilePageHeader
        titulo="Clientes"
        descricao={`${rows.length} ${rows.length === 1 ? "cadastrado" : "cadastrados"}`}
        acao={
          podeEditar && (
            <button
              type="button"
              onClick={() => setForm("novo")}
              aria-label="Adicionar cliente"
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-brand text-on-brand shadow-[var(--shadow-1)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Plus className="h-5 w-5" aria-hidden />
            </button>
          )
        }
      />

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF ou WhatsApp"
          aria-label="Buscar cliente"
          className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Todos {rows.length}
        </Chip>
        <Chip
          ativo={filtro === "oportunidades"}
          onClick={() => setFiltro("oportunidades")}
        >
          Oportunidades {pendentes.length}
        </Chip>
        <Chip ativo={filtro === "inativos"} onClick={() => setFiltro("inativos")}>
          Inativos {inativos.length}
        </Chip>
      </div>

      {/* Chip com número é fácil de não ver de relance. Quando há cupom
          esperando e a pessoa está em "Todos", a tira diz o que fazer. */}
      {filtro === "todos" && pendentes.length > 0 && (
        <button
          type="button"
          onClick={() => setFiltro("oportunidades")}
          className="tap flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-m)] bg-accent-soft px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <Send className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">
            {pendentes.length}{" "}
            {pendentes.length === 1
              ? "cliente esperando cupom"
              : "clientes esperando cupom"}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        </button>
      )}

      {filtro === "oportunidades" ? (
        listaOportunidades.length === 0 ? (
          <Vazio
            titulo="Nada a enviar agora"
            texto={
              busca
                ? "Nenhuma oportunidade com esse termo."
                : `Ninguém faz aniversário nem passou de ${cupomDiasRisco} dias sem comprar.`
            }
          />
        ) : (
          <ul className="space-y-2">
            {listaOportunidades.map((c) => (
              <LinhaOportunidade
                key={c.customerId + c.tipo}
                candidato={c}
                podeEnviar={podeEditar}
                onAbrir={() => {
                  const row = porId.get(c.customerId);
                  if (row) setAberto(row);
                }}
              />
            ))}
          </ul>
        )
      ) : lista.length === 0 ? (
        <Vazio
          titulo={rows.length === 0 ? "Nenhum cliente ainda" : "Nada por aqui"}
          texto={
            busca
              ? "Nenhum cliente com esse termo."
              : rows.length === 0
                ? "Cadastre quem compra sempre para acompanhar gasto e mandar cupom."
                : "Nenhum cliente neste filtro."
          }
        />
      ) : (
        <ul className="space-y-2">
          {lista.map((c) => (
            <LinhaCliente
              key={c.id}
              cliente={c}
              tierThresholds={tierThresholds}
              onAbrir={() => setAberto(c)}
            />
          ))}
        </ul>
      )}

      {aberto && (
        <DetalheCliente
          key={aberto.id}
          cliente={aberto}
          diasRisco={cupomDiasRisco}
          tierThresholds={tierThresholds}
          podeEditar={podeEditar}
          onFechar={() => setAberto(null)}
          onEditar={() => {
            setForm(aberto);
            setAberto(null);
          }}
        />
      )}

      {form && (
        <FormCliente
          base={form === "novo" ? null : form}
          onFechar={() => setForm(null)}
        />
      )}
    </div>
  );
}

function LinhaCliente({
  cliente,
  tierThresholds,
  onAbrir,
}: {
  cliente: CustomerRow;
  tierThresholds: TierThresholds;
  onAbrir: () => void;
}) {
  const tier = tierFromGasto(cliente.totalGasto, tierThresholds);

  return (
    <li>
      <MCard>
        <button
          type="button"
          onClick={onAbrir}
          className="tap flex w-full items-center gap-3 rounded-[var(--radius-m)] p-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <Avatar nome={cliente.nome} />

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm font-medium text-ink",
                !cliente.ativo && "text-faint line-through",
              )}
            >
              {cliente.nome}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs">
              <span className={cn("flex items-center gap-0.5", tier.text)} aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={9}
                    className={i < tier.estrelas ? "fill-current" : "opacity-25"}
                  />
                ))}
              </span>
              <span className={tier.text}>{tier.label.replace("Cliente ", "")}</span>
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-mono text-sm font-medium text-ink tnum">
              {brl(cliente.totalGasto)}
            </p>
            <p className="text-[11px] text-faint">
              {cliente.ultimaCompra
                ? `compra ${fmtDiasAtras(cliente.ultimaCompra)}`
                : "sem compras"}
            </p>
          </div>
        </button>
      </MCard>
    </li>
  );
}

/**
 * Linha de oportunidade: o motivo é a manchete, e o cupom sai daqui mesmo — é a
 * única tela em que o operador está fazendo exatamente isso, em série.
 */
function LinhaOportunidade({
  candidato,
  podeEnviar,
  onAbrir,
}: {
  candidato: CouponCandidate;
  /** Sem `cliente.editar` a linha continua informando — só não dispara nada. */
  podeEnviar: boolean;
  onAbrir: () => void;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  const [enviado, setEnviado] = React.useState(false);
  const aniv = candidato.tipo === "ANIVERSARIO";

  async function enviar() {
    setEnviando(true);
    try {
      const { waLink } = await sendCoupon(candidato.customerId, candidato.tipo);
      setEnviado(true);
      if (waLink) {
        window.open(waLink, "_blank", "noopener");
        toast.success("Cupom pronto", `WhatsApp aberto para ${candidato.nome.split(" ")[0]}.`);
      } else {
        toast.info("Cupom registrado", "Cadastre um WhatsApp para disparar a mensagem.");
      }
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível enviar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <li>
      <MCard className={cn("overflow-hidden", aniv ? "bg-accent-soft" : "bg-warn-soft")}>
        <button
          type="button"
          onClick={onAbrir}
          className="tap flex w-full items-center gap-3 p-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <span className={cn("shrink-0", aniv ? "text-accent" : "text-warn")} aria-hidden>
            {aniv ? <Cake className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{candidato.nome}</p>
            <p className="text-xs text-muted">
              {aniv
                ? `Aniversário em ${candidato.aniversario}`
                : `Sem comprar há ${candidato.dias} dias`}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>

        {podeEnviar && (
          <div className="border-t border-line/60">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || enviado}
              className="tap flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 text-[13px] font-semibold text-ink disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {enviado ? "Cupom enviado" : enviando ? "Enviando…" : "Enviar cupom"}
            </button>
          </div>
        )}
      </MCard>
    </li>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <MCard className="flex flex-col items-center gap-2 p-8 text-center">
      <Users className="h-8 w-8 text-muted" aria-hidden />
      <p className="font-display text-base font-semibold text-ink">{titulo}</p>
      <p className="text-sm text-ink-2">{texto}</p>
    </MCard>
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
