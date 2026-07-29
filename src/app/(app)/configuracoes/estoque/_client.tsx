"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  BarChart3,
  Check,
  CheckCircle2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  COBERTURAS,
  PERIODOS_MEDIA,
  TIPOS_CONTROLE,
  type TipoControleEstoque,
} from "@/lib/estoque-estrategia";
import { Switch } from "../_ui";
import { updateEstoqueConfig } from "../actions";

/**
 * Configurações → Estoque e alertas.
 *
 * A tela é uma decisão seguida de seus ajustes: o operador escolhe a estratégia
 * de controle e só então aparece o que aquela estratégia usa. Por isso o card do
 * topo é um bloco de configuração inteiro (escolha + dependências expandindo
 * abaixo dela), e não um card por campo — campo solto sugere que a configuração
 * vale sempre, e metade dela não vale.
 *
 * Rótulos aqui são curtos de propósito: quem lê é quem opera, e a explicação
 * longa da estratégia mora no lib (CONTROLE_LABELS), não na tela de ajuste.
 */

type EstoqueConfig = {
  tipoControleEstoque: TipoControleEstoque;
  periodoMediaDias: number;
  diasCobertura: number;
  estoqueMinimoPadrao: number;
  produtoParadoDias: number;
  validadeAlertaDias: number;
  recebimentoExigeContagem: boolean;
};

/** Rótulo curto de cada estratégia — versão de escolha, não de documentação. */
const OPCOES: Record<
  TipoControleEstoque,
  { nome: string; desc: string; icon: LucideIcon }
> = {
  MINIMO: {
    nome: "Estoque mínimo",
    desc: "Você define um piso por produto. Ao chegar no piso, o produto entra na lista de reposição e é gerado alertas.",
    icon: ArrowDownToLine,
  },
  MINIMO_IDEAL: {
    nome: "Mínimo + ideal",
    desc: "Além do piso, você define um nível ideal. A sugestão de compra repõe até o ideal.",
    icon: BarChart3,
  },
  ROTATIVIDADE: {
    nome: "Rotatividade",
    desc: "Sem metas fixas: o sistema analisa o giro de vendas e calcula quanto comprar para cobrir os próximos dias.",
    icon: RefreshCw,
  },
};

export function EstoqueConfigClient({
  initial,
  multiPonto,
}: {
  initial: EstoqueConfig;
  multiPonto: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Baseline local: depois de salvar, o "sujo" precisa zerar na hora — esperar o
  // refresh do servidor deixaria a barra de ação pendurada na tela.
  const [base, setBase] = useState(initial);
  const [tipo, setTipo] = useState<TipoControleEstoque>(
    initial.tipoControleEstoque,
  );
  const [periodo, setPeriodo] = useState(initial.periodoMediaDias);
  const [cobertura, setCobertura] = useState(initial.diasCobertura);
  const [minimo, setMinimo] = useState(String(initial.estoqueMinimoPadrao));
  const [parado, setParado] = useState(String(initial.produtoParadoDias));
  const [validade, setValidade] = useState(String(initial.validadeAlertaDias));
  const [contagem, setContagem] = useState(initial.recebimentoExigeContagem);
  const [salvoAgora, setSalvoAgora] = useState(false);
  // Padronizar é a pergunta; a quantidade é só a resposta de quem disse sim.
  // Guardado à parte do número porque "0" e "ainda não digitei" não são a mesma
  // coisa para quem está preenchendo.
  const [padronizar, setPadronizar] = useState(initial.estoqueMinimoPadrao > 0);

  const usaGiro = tipo === "ROTATIVIDADE";
  const minInvalido = !usaGiro && padronizar && !(Number(minimo) >= 1);

  function escolherPadronizacao(valor: boolean) {
    setPadronizar(valor);
    if (!valor) setMinimo("0");
    else if (Number(minimo) < 1) setMinimo("");
  }

  const dirty =
    tipo !== base.tipoControleEstoque ||
    periodo !== base.periodoMediaDias ||
    cobertura !== base.diasCobertura ||
    Number(minimo) !== base.estoqueMinimoPadrao ||
    Number(parado) !== base.produtoParadoDias ||
    Number(validade) !== base.validadeAlertaDias ||
    contagem !== base.recebimentoExigeContagem;

  // O selo "salvo" é confirmação, não estado — some sozinho.
  useEffect(() => {
    if (!salvoAgora) return;
    const t = setTimeout(() => setSalvoAgora(false), 4000);
    return () => clearTimeout(t);
  }, [salvoAgora]);

  function salvar() {
    if (minInvalido) return;
    // Sem padronização o mínimo padrão é 0. Com ela, vale o que está no campo —
    // e se o campo ficou vazio (só possível na rotatividade, onde ele nem
    // aparece), mantém o que já estava gravado em vez de inventar um número.
    const min = padronizar
      ? Number(minimo) >= 1
        ? Math.min(9999, Math.round(Number(minimo)))
        : base.estoqueMinimoPadrao
      : 0;
    const dias = Math.max(
      7,
      Math.min(365, Number(parado) || base.produtoParadoDias),
    );
    const vDias = Math.max(
      1,
      Math.min(365, Number(validade) || base.validadeAlertaDias),
    );
    const payload = {
      tipoControleEstoque: tipo,
      periodoMediaDias: periodo,
      diasCobertura: cobertura,
      estoqueMinimoPadrao: min,
      produtoParadoDias: dias,
      validadeAlertaDias: vDias,
      recebimentoExigeContagem: contagem,
    };
    start(async () => {
      try {
        await updateEstoqueConfig(payload);
        setMinimo(String(min));
        setPadronizar(min > 0);
        setParado(String(dias));
        setValidade(String(vDias));
        setBase(payload);
        setSalvoAgora(true);
        toast.success("Configurações salvas.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* ── Bloco principal: a escolha e tudo que depende dela ───────── */}
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="font-semibold text-ink">
              Como você controla seu estoque
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Escolha como o sistema calcula alertas e reposições.
            </p>
          </div>
          <SeloEstado dirty={dirty} salvo={salvoAgora} />
        </header>

        <div className="px-5 pb-5">
          <div
            role="radiogroup"
            aria-label="Tipo de controle de estoque"
            className="mt-4 grid gap-3 sm:grid-cols-3"
          >
            {TIPOS_CONTROLE.map((t) => (
              <OpcaoControle
                key={t}
                {...OPCOES[t]}
                selected={tipo === t}
                onSelect={() => setTipo(t)}
              />
            ))}
          </div>

          {/* Dependências da opção escolhida — sempre coladas nela. */}
          <Expandivel chave={usaGiro ? "giro" : "fixo"}>
            <div
              key={usaGiro ? "giro" : "fixo"}
              className="mt-5 border-t border-line pt-5 motion-safe:animate-[fade-up_0.22s_cubic-bezier(0.16,1,0.3,1)_both]"
            >
              <p className="text-[11px] font-medium tracking-widest text-faint uppercase">
                {usaGiro
                  ? "Configurações da rotatividade"
                  : "Configurações do estoque mínimo"}
              </p>

              {usaGiro ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <SubCard
                    titulo="Período para calcular a média"
                    descricao="Define o período de histórico de vendas usado para calcular a média diária."
                  >
                    <Segmented
                      name="Período da média"
                      value={periodo}
                      options={PERIODOS_MEDIA.map((d) => ({
                        value: d,
                        label: `${d} dias`,
                      }))}
                      onChange={setPeriodo}
                    />
                  </SubCard>
                  <SubCard
                    titulo="Cobertura do estoque"
                    descricao="Determina por quantos dias de venda o estoque deve cobrir."
                  >
                    <Segmented
                      name="Cobertura do estoque"
                      value={cobertura}
                      options={COBERTURAS.map((d) => ({
                        value: d,
                        label: String(d),
                      }))}
                      sufixo="dias"
                      onChange={setCobertura}
                    />
                  </SubCard>
                </div>
              ) : (
                <div className="mt-3">
                  <SubCard
                    titulo="Estoque mínimo dos produtos"
                    descricao="Vale para produtos novos. Os que você já cadastrou continuam com o mínimo que têm hoje."
                  >
                    <div
                      role="radiogroup"
                      aria-label="Estoque mínimo dos produtos"
                      className="flex flex-col gap-2"
                    >
                      <OpcaoLinha
                        titulo="Definir por produto"
                        descricao="Cada produto recebe seu próprio mínimo no cadastro. Indicado para catálogos variados."
                        badge="Padrão"
                        selected={!padronizar}
                        onSelect={() => escolherPadronizacao(false)}
                      />
                      <OpcaoLinha
                        titulo="Padronizar para todos"
                        descricao="Todo produto novo já nasce com a mesma quantidade mínima. Você ainda pode ajustar caso a caso."
                        selected={padronizar}
                        onSelect={() => escolherPadronizacao(true)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <CampoDias
                            id="minimo"
                            value={minimo}
                            onChange={setMinimo}
                            min={1}
                            max={9999}
                            sufixo="unidades de mínimo"
                            placeholder="0"
                          />
                        </div>
                        {minInvalido && (
                          <p className="mt-2 text-[13px] text-danger">
                            Informe quantas unidades cada produto novo deve ter
                            de mínimo.
                          </p>
                        )}
                      </OpcaoLinha>
                    </div>
                  </SubCard>
                </div>
              )}
            </div>
          </Expandivel>
        </div>
      </section>

      {/* ── Alertas: dois números, lado a lado ───────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <CardNumero
          titulo="Produto parado"
          descricao='Depois de quantos dias sem movimentações um produto vira alerta de "estoque parado".'
          rodape="Vira alerta no sino para produtos que ainda têm saldo."
        >
          <CampoDias
            id="parado"
            value={parado}
            onChange={setParado}
            min={7}
            max={365}
            sufixo="dias"
          />
        </CardNumero>

        <CardNumero
          titulo="Alerta de validade"
          descricao="Com quantos dias de antecedência um lote perto de vencer vira alerta."
          rodape="Lotes já vencidos alertam sempre, sem depender deste prazo."
        >
          <CampoDias
            id="validade"
            value={validade}
            onChange={setValidade}
            min={1}
            max={365}
            sufixo="dias antes"
          />
        </CardNumero>
      </div>

      {/* ── Recebimento: só existe com mais de um ponto. Com um estoque só
          não há transferência entre lojas, então a chave não decide nada e
          vira ruído na tela. ────────────────────────────────────────── */}
      {multiPonto && (
        <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-ink">
                Recebimento com contagem
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                Exige contagem no destino antes de a transferência entrar no
                estoque.
              </p>
            </div>
            <Switch
              checked={contagem}
              onChange={setContagem}
              label="Recebimento com contagem"
            />
          </div>
          <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[13px] text-muted">
            {contagem ? (
              <>
                <CheckCircle2
                  size={14}
                  className="shrink-0 text-ok"
                  aria-hidden
                />
                Recomendado para operações com centro de distribuição.
              </>
            ) : (
              "Sem contagem, a expedição confirma a entrega sozinha."
            )}
          </p>
        </section>
      )}

      {/* ── Barra de ação: fica sempre à vista, e só liga quando há o que
          salvar — botão que some tira do operador a referência de onde
          confirmar. ─────────────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line-strong bg-surface/95 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur">
        <p className={cn("text-sm", minInvalido ? "text-danger" : "text-muted")}>
          {minInvalido
            ? "Informe a quantidade do estoque mínimo padrão."
            : dirty
              ? "Alterações não salvas."
              : "Tudo salvo."}
        </p>
        <Button
          size="sm"
          onClick={salvar}
          disabled={!dirty || pending || minInvalido}
        >
          {pending ? "Salvando…" : "Salvar configurações"}
        </Button>
      </div>
    </div>
  );
}

/* ── Peças ──────────────────────────────────────────────────────── */

/** Cartão de escolha da estratégia. Radio de verdade: um só vence o grupo. */
function OpcaoControle({
  nome,
  desc,
  icon: Icon,
  selected,
  onSelect,
}: {
  nome: string;
  desc: string;
  icon: LucideIcon;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex h-full items-start gap-3 rounded-[var(--radius)] border p-4 text-left transition-all duration-200",
        selected
          ? "border-brand bg-brand-soft shadow-[var(--shadow-1)]"
          : "border-line-strong bg-surface hover:border-brand/40 hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors duration-200",
          selected
            ? "bg-brand text-on-brand"
            : "bg-surface-2 text-muted group-hover:text-brand",
        )}
      >
        <Icon size={17} />
      </span>
      {/* pr-6 reserva a coluna do check — sem ela o título encosta nele. */}
      <span className="flex min-w-0 flex-col pr-6">
        <span className="text-sm font-semibold text-ink">{nome}</span>
        <span className="mt-0.5 text-[13px] leading-snug text-muted">
          {desc}
        </span>
      </span>

      <span
        aria-hidden
        className={cn(
          "absolute top-3 right-3 grid h-5 w-5 place-items-center rounded-full border transition-all duration-200",
          selected
            ? "scale-100 border-brand bg-brand text-on-brand opacity-100"
            : "scale-90 border-line-strong bg-surface text-transparent opacity-70",
        )}
      >
        <Check size={12} strokeWidth={3} />
      </span>
    </button>
  );
}

/**
 * Bloco de dependências: recolhe e reabre a cada troca de estratégia, para o
 * conteúdo novo entrar descendo em vez de trocar num piscar. Altura anima com
 * `grid-rows` (0fr → 1fr), único jeito de animar altura automática sem medir o
 * conteúdo no JS.
 *
 * O `chave !== ultimaChave` fecha durante o render — ajustar estado no render é
 * o padrão do React para reagir a mudança de prop sem deixar o frame aberto
 * aparecer na tela.
 */
function Expandivel({
  chave,
  children,
}: {
  chave: string;
  children: React.ReactNode;
}) {
  const [ultimaChave, setUltimaChave] = useState(chave);
  const [aberto, setAberto] = useState(true);

  if (chave !== ultimaChave) {
    setUltimaChave(chave);
    setAberto(false);
  }

  useEffect(() => {
    if (aberto) return;
    const id = requestAnimationFrame(() => setAberto(true));
    return () => cancelAnimationFrame(id);
  }, [aberto]);

  return (
    <div
      className={cn(
        "grid transition-all duration-[240ms] ease-out motion-reduce:transition-none",
        aberto ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/** Caixa interna do bloco de dependências — mais discreta que um card. */
function SubCard({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-surface-2/60 p-4">
      <p className="text-sm font-medium text-ink">{titulo}</p>
      <p className="mt-0.5 text-[13px] text-muted">{descricao}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Botões segmentados em cápsula. Um grupo, uma escolha, sem menu suspenso. */
function Segmented({
  name,
  value,
  options,
  sufixo,
  onChange,
}: {
  name: string;
  value: number;
  options: { value: number; label: string }[];
  sufixo?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={name}
        className="inline-flex flex-wrap gap-1 rounded-[var(--radius-pill)] border border-line-strong bg-surface p-1"
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={cn(
                "h-8 cursor-pointer rounded-[var(--radius-pill)] px-3.5 text-[13px] font-medium transition-all duration-200",
                selected
                  ? "bg-brand text-on-brand shadow-[var(--shadow-1)]"
                  : "text-ink-2 hover:bg-surface-2",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {sufixo && <span className="text-[13px] text-muted">{sufixo}</span>}
    </div>
  );
}

/**
 * Escolha em linha: um radio, um título, uma explicação e — quando a opção
 * abre configuração — o campo dela embutido. O campo mora DENTRO da opção
 * porque é ela que o justifica; solto ao lado, pareceria valer para as duas.
 */
function OpcaoLinha({
  titulo,
  descricao,
  badge,
  selected,
  onSelect,
  children,
}: {
  titulo: string;
  descricao: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border transition-all duration-200",
        selected
          ? "border-brand bg-surface shadow-[var(--shadow-1)]"
          : "border-line-strong bg-surface/60 hover:border-brand/40",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full items-start gap-3 p-3.5 text-left"
      >
        <span
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 transition-colors duration-200",
            selected ? "border-brand" : "border-line-strong",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-brand transition-transform duration-200",
              selected ? "scale-100" : "scale-0",
            )}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{titulo}</span>
            {badge && (
              <span className="rounded-[var(--radius-pill)] bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 text-[13px] leading-snug text-muted">
            {descricao}
          </span>
        </span>
      </button>

      {children && (
        <div
          className={cn(
            "grid transition-all duration-[220ms] ease-out motion-reduce:transition-none",
            selected ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="px-3.5 pt-1 pb-3.5 pl-10">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Campo numérico curto com unidade ao lado — número é dado, então vai em mono. */
function CampoDias({
  id,
  value,
  onChange,
  min,
  max,
  sufixo,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  sufixo: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="h-10 w-24 px-3 text-center font-mono text-sm"
      />
      <span className="text-sm text-muted">{sufixo}</span>
    </div>
  );
}

/** Card compacto de um único número. Altura baixa, largura aproveitada. */
function CardNumero({
  titulo,
  descricao,
  rodape,
  children,
}: {
  titulo: string;
  descricao: string;
  rodape: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-ink">{titulo}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{descricao}</p>
        </div>
        {children}
      </div>
      <p className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
        {rodape}
      </p>
    </section>
  );
}

/** Estado do formulário no canto do card: pendente (âmbar) ou salvo (verde). */
function SeloEstado({ dirty, salvo }: { dirty: boolean; salvo: boolean }) {
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-warn-soft px-2.5 py-1 text-[12px] font-medium text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
        Alterações não salvas
      </span>
    );
  }
  if (salvo) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-ok-soft px-2.5 py-1 text-[12px] font-medium text-ok motion-safe:animate-[fade-up_0.22s_cubic-bezier(0.16,1,0.3,1)_both]">
        <CheckCircle2 size={13} aria-hidden />
        Configurações salvas
      </span>
    );
  }
  return null;
}
