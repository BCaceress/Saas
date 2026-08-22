"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  BellOff,
  ClipboardList,
  Coins,
  PackagePlus,
  Sparkles,
  Wine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  CATEGORY_LABEL,
  PRIORITY_STYLE,
  type AlertCategory,
  type AlertPriority,
} from "@/lib/alerts-types";
import {
  CONFIG_LABEL,
  CONFIG_ONDE,
  LIMIARES,
  alertasDaCategoria,
  categoriasComAlertas,
  type AlertKind,
  type ChaveLimiar,
  type DefAlerta,
  type ResolucaoAlerta,
} from "@/lib/alertas/catalogo";
import { CONTROLE_LABELS, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { BarraAcoes, CampoDias, SeloEstado, Switch } from "../_ui";
import { updateNotificacoes } from "../actions";

/**
 * Configurações → Notificações.
 *
 * A tela é a lista do que o sino sabe dizer, na estratégia que a empresa
 * escolhe — não um texto fixo sobre seis grupos. Cada aviso é uma linha com o
 * ponto de gravidade que ele terá no sino, e os limiares que pertencem ao
 * próprio aviso são editados ali, junto dele. Limiar de outro dono (mínimo do
 * produto, dias de cobertura) aparece como rastro com link: um campo, um dono.
 */

const VISUAL: Record<
  AlertCategory,
  { icon: React.ReactNode; tone: "danger" | "brand" | "accent" | "warn" | "ok" }
> = {
  criticos: { icon: <AlertTriangle size={18} />, tone: "danger" },
  operacao: { icon: <PackagePlus size={18} />, tone: "brand" },
  consumo: { icon: <Wine size={18} />, tone: "accent" },
  financeiro: { icon: <Coins size={18} />, tone: "warn" },
  inventario: { icon: <ClipboardList size={18} />, tone: "brand" },
  inteligencia: { icon: <Sparkles size={18} />, tone: "accent" },
};

const TOM_ICONE = {
  brand: "bg-brand-soft text-brand",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
  danger: "bg-danger-soft text-danger",
};

const PRIORITY_LABEL: Record<AlertPriority, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
  info: "Informativo",
};

type Limiares = Record<ChaveLimiar, number>;

export function NotificacoesClient({
  policy,
  resolucao,
  limiares,
  pushHoraInicio,
  pushHoraFim,
}: {
  policy: EstoquePolicy;
  resolucao: Record<AlertKind, ResolucaoAlerta>;
  limiares: Limiares;
  pushHoraInicio: number;
  pushHoraFim: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const inicial = {
    ligados: Object.fromEntries(
      Object.entries(resolucao).map(([k, v]) => [k, v.ligado]),
    ) as Record<AlertKind, boolean>,
    limiares,
    inicio: pushHoraInicio,
    fim: pushHoraFim,
  };

  // Baseline local: depois de salvar, o "sujo" precisa zerar na hora — esperar
  // o refresh do servidor deixaria a barra de ação pendurada na tela.
  const [base, setBase] = useState(inicial);
  const [ligados, setLigados] = useState(inicial.ligados);
  // Indexado pela chave em vez de um useState por limiar: cada limiar novo no
  // catálogo custava mais um estado, mais um ramo de `dirty` e mais um if em
  // `valorLimiar` — três lugares para esquecer de mexer.
  const [textoLimiar, setTextoLimiar] = useState<Record<ChaveLimiar, string>>(
    () =>
      Object.fromEntries(
        (Object.keys(LIMIARES) as ChaveLimiar[]).map((k) => [k, String(limiares[k])]),
      ) as Record<ChaveLimiar, string>,
  );
  const [inicio, setInicio] = useState(pushHoraInicio);
  const [fim, setFim] = useState(pushHoraFim);
  const [salvoAgora, setSalvoAgora] = useState(false);

  const categorias = categoriasComAlertas(policy);
  const janelaInvalida = fim <= inicio;

  const dirty =
    inicio !== base.inicio ||
    fim !== base.fim ||
    (Object.keys(LIMIARES) as ChaveLimiar[]).some(
      (k) => Number(textoLimiar[k]) !== base.limiares[k],
    ) ||
    Object.keys(ligados).some((k) => ligados[k as AlertKind] !== base.ligados[k as AlertKind]);

  // O selo "salvo" é confirmação, não estado — some sozinho.
  useEffect(() => {
    if (!salvoAgora) return;
    const t = setTimeout(() => setSalvoAgora(false), 4000);
    return () => clearTimeout(t);
  }, [salvoAgora]);

  function alternar(kind: AlertKind, valor: boolean) {
    setLigados((prev) => ({ ...prev, [kind]: valor }));
  }

  function alternarGrupo(defs: DefAlerta[], valor: boolean) {
    setLigados((prev) => {
      const next = { ...prev };
      for (const d of defs) next[d.kind] = valor;
      return next;
    });
  }

  function salvar() {
    if (janelaInvalida) return;
    const limiaresSalvos = Object.fromEntries(
      (Object.keys(LIMIARES) as ChaveLimiar[]).map((k) => [
        k,
        dentro(textoLimiar[k], LIMIARES[k], base.limiares[k]),
      ]),
    ) as Limiares;
    // Manda a preferência de TODOS os tipos, inclusive os que a estratégia
    // atual esconde: quem troca de estratégia e volta encontra as escolhas de
    // antes, não os padrões de fábrica.
    const alertas = Object.fromEntries(
      Object.entries(ligados).map(([kind, ligado]) => [
        kind,
        { ligado, prioridade: resolucao[kind as AlertKind]?.prioridade },
      ]),
    );
    start(async () => {
      try {
        await updateNotificacoes({
          alertas,
          ...limiaresSalvos,
          pushHoraInicio: inicio,
          pushHoraFim: fim,
        });
        setTextoLimiar(
          Object.fromEntries(
            (Object.keys(LIMIARES) as ChaveLimiar[]).map((k) => [k, String(limiaresSalvos[k])]),
          ) as Record<ChaveLimiar, string>,
        );
        setBase({ ligados, limiares: limiaresSalvos, inicio, fim });
        setSalvoAgora(true);
        toast.success("Preferências de alerta salvas.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  const valorLimiar = (chave: ChaveLimiar) => textoLimiar[chave];
  const setLimiar = (chave: ChaveLimiar) => (v: string) =>
    setTextoLimiar((prev) => ({ ...prev, [chave]: v }));

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Controle de estoque:{" "}
          <strong className="font-medium text-ink">
            {CONTROLE_LABELS[policy.tipo].nome.toLowerCase()}
          </strong>{" "}
          ·{" "}
          <Link
            href="/configuracoes/estoque"
            className="text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            Mudar
          </Link>
        </p>
        <SeloEstado dirty={dirty} salvo={salvoAgora} />
      </div>

      {categorias.map((cat) => {
        const defs = alertasDaCategoria(cat, policy);
        const ativos = defs.filter((d) => ligados[d.kind]).length;
        return (
          <section
            key={cat}
            className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface"
          >
            <header className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                    TOM_ICONE[VISUAL[cat].tone],
                  )}
                >
                  {VISUAL[cat].icon}
                </span>
                <div>
                  <h2 className="font-semibold text-ink">{CATEGORY_LABEL[cat]}</h2>
                  <p className="mt-0.5 text-[13px] text-muted tabular-nums">
                    {ativos} de {defs.length}{" "}
                    {defs.length === 1 ? "aviso ligado" : "avisos ligados"}
                  </p>
                </div>
              </div>
              {/* Ação nomeada, não um terceiro interruptor: um switch aqui
                  ficaria desligado assim que UM aviso abaixo fosse desligado,
                  dando a entender que o grupo inteiro estava fora do ar. */}
              {defs.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => alternarGrupo(defs, ativos === 0)}
                >
                  {ativos === 0 ? "Ligar todos" : "Desligar todos"}
                </Button>
              )}
            </header>

            <ul className="border-t border-line">
              {defs.map((def) => {
                const ligado = ligados[def.kind];
                const prioridade = resolucao[def.kind].prioridade;
                const rastros = (def.config ?? []).filter((c) => CONFIG_ONDE[c]);
                return (
                  <li
                    key={def.kind}
                    className="flex items-start gap-3 border-b border-line px-5 py-3.5 last:border-b-0"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        PRIORITY_STYLE[prioridade].dot,
                        !ligado && "opacity-30",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          ligado ? "text-ink" : "text-muted",
                        )}
                      >
                        {def.rotulo}
                        <span className="sr-only">
                          {" "}
                          — prioridade {PRIORITY_LABEL[prioridade].toLowerCase()}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted">{def.ajuda}</p>

                      {def.limiar && ligado && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <label
                            htmlFor={`limiar-${def.kind}`}
                            className="text-[13px] text-muted"
                          >
                            {LIMIARES[def.limiar].label}
                          </label>
                          <CampoDias
                            id={`limiar-${def.kind}`}
                            value={valorLimiar(def.limiar)}
                            onChange={setLimiar(def.limiar)}
                            min={LIMIARES[def.limiar].min}
                            max={LIMIARES[def.limiar].max}
                            sufixo={LIMIARES[def.limiar].sufixo}
                          />
                        </div>
                      )}

                      {rastros.length > 0 && (
                        <p className="mt-1.5 text-[12px] text-faint">
                          Usa{" "}
                          {rastros.map((c, i) => (
                            <span key={c}>
                              {i > 0 && ", "}
                              {CONFIG_LABEL[c]} (
                              <Link
                                href={CONFIG_ONDE[c]!.href}
                                className="text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                              >
                                {CONFIG_ONDE[c]!.tela}
                              </Link>
                              )
                            </span>
                          ))}
                          .
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={ligado}
                      onChange={(v) => alternar(def.kind, v)}
                      label={def.rotulo}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* ── Janela de silêncio: vale só para o push, não para o sino ──── */}
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
            <BellOff size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-ink">Horário das notificações</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Fora dessa faixa o celular não toca. Os avisos continuam no sino,
              esperando você.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SelectHora
                id="push-inicio"
                label="Começa às"
                value={inicio}
                onChange={setInicio}
                de={0}
                ate={23}
              />
              <SelectHora
                id="push-fim"
                label="Para às"
                value={fim}
                onChange={setFim}
                de={1}
                ate={24}
              />
            </div>
            {janelaInvalida && (
              <p className="mt-2 text-[13px] text-danger">
                O horário final precisa ser depois do inicial.
              </p>
            )}
          </div>
        </div>
      </section>

      <p className="text-xs text-muted">
        Desligar um aviso só o tira do sino e das notificações — os dados
        continuam nos relatórios e nas telas de cada módulo.
      </p>

      <BarraAcoes
        tomAlerta={janelaInvalida}
        estado={
          janelaInvalida
            ? "Ajuste o horário das notificações."
            : dirty
              ? "Alterações não salvas."
              : "Tudo salvo."
        }
      >
        <Button
          size="sm"
          onClick={salvar}
          disabled={!dirty || pending || janelaInvalida}
        >
          {pending ? "Salvando…" : "Salvar preferências"}
        </Button>
      </BarraAcoes>
    </div>
  );
}

/** Número digitado → dentro da faixa aceita; vazio mantém o que já valia. */
function dentro(
  valor: string,
  faixa: { min: number; max: number },
  atual: number,
): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return atual;
  return Math.max(faixa.min, Math.min(faixa.max, Math.round(n)));
}

function SelectHora({
  id,
  label,
  value,
  onChange,
  de,
  ate,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  de: number;
  ate: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[13px] text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 rounded-[var(--radius)] border border-line bg-surface px-3 font-mono text-sm text-ink focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        {Array.from({ length: ate - de + 1 }, (_, i) => de + i).map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, "0")}:00
          </option>
        ))}
      </select>
    </div>
  );
}
