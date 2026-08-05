"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Download,
  GripVertical,
  LoaderCircle,
  Lock,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Table2,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { configPadrao, mesmaConfig, type ReportConfig } from "@/lib/relatorios/config";
import type { Exportacao } from "@/lib/relatorios/catalogo";
import type { ReportDefinitionCliente } from "@/lib/relatorios/definicao";
import {
  Aviso,
  MenuExportar,
  Visualizacao,
  hrefSaida,
  useLarguraTabela,
  type Previa,
  type Saida,
} from "./previa";
import {
  abrirRelatorioAction,
  excluirModeloAction,
  previaRelatorioAction,
  registrarSaidaAction,
  salvarModeloAction,
  salvarPadraoAction,
} from "./actions";

/**
 * "Personalizar relatório" — o caminho de quem precisa mexer.
 *
 * A porta normal é "Visualizar", que não pergunta nada. Esta tela existe para a
 * minoria que quer outra coisa: tirar uma coluna, mudar a ordem delas. Por isso
 * ela abre estreita e mostra UMA seção — colunas.
 *
 * A configuração só vira assunto depois que existe personalização: enquanto o
 * que está na tela for o padrão, não há barra, não há botão de salvar e não há
 * decisão a tomar. Personalizou, aparece a faixa com "salvar como padrão" (vira
 * o ponto de partida desta pessoa) ou "salvar modelo" (configuração batizada,
 * opcionalmente da equipe).
 *
 * O caminho é sempre o mesmo: **configurar → visualizar → baixar**. Ninguém
 * baixa arquivo às cegas: a prévia mostra os mesmos números que vão para o PDF,
 * porque os dois saem da mesma execução no servidor.
 */

type Abertura = Extract<Awaited<ReturnType<typeof abrirRelatorioAction>>, { ok: true }>["dados"];
type Modelo = Abertura["modelos"][number];

/** Largura de leitura da personalização. A prévia cresce a partir daqui. */
const LARGURA_BASE = "2xl" as const;

export function ConfiguradorRelatorio({
  relatorioId,
  nome,
  descricao,
  categoria,
  exportacoes,
  onClose,
}: {
  relatorioId: string;
  nome: string;
  descricao: string;
  /** Nome da categoria, já resolvido pela Central. */
  categoria: string;
  exportacoes: readonly Exportacao[];
  onClose: () => void;
}) {
  const [abertura, setAbertura] = React.useState<Abertura | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [config, setConfig] = React.useState<ReportConfig | null>(null);
  /** Configuração de referência: o que "não personalizado" significa hoje. */
  const [padrao, setPadrao] = React.useState<ReportConfig | null>(null);
  const [modelos, setModelos] = React.useState<Modelo[]>([]);
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [aba, setAba] = React.useState<"configurar" | "previa">("configurar");
  const [ocupado, setOcupado] = React.useState<null | "previa" | Saida>(null);
  const [salvando, setSalvando] = React.useState(false);
  const { largura, medirTabela, encolher } = useLarguraTabela(LARGURA_BASE);

  // A definição é carregada no clique, não na Central: mandar as definições dos
  // quarenta relatórios de uma vez seria pagar por trinta e nove não abertos.
  React.useEffect(() => {
    let vivo = true;
    abrirRelatorioAction(relatorioId).then((r) => {
      if (!vivo) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setAbertura(r.dados);
      setConfig(r.dados.config);
      setPadrao(r.dados.config);
      setModelos(r.dados.modelos);
    });
    return () => {
      vivo = false;
    };
  }, [relatorioId]);

  const def = abertura?.definicao ?? null;
  const personalizado = config !== null && padrao !== null && !mesmaConfig(config, padrao);

  /** A prévia envelhece a cada mexida na configuração — melhor sumir que mentir. */
  function mudar(fn: (c: ReportConfig) => ReportConfig) {
    setConfig((atual) => (atual ? fn(atual) : atual));
    setPrevia(null);
  }

  async function visualizar() {
    if (!config || !def) return;
    setOcupado("previa");
    const r = await previaRelatorioAction({ relatorioId, config });
    setOcupado(null);
    if (!r.ok) {
      toast.error("Não deu para gerar", r.erro);
      return;
    }
    setPrevia(r.dados);
    setAba("previa");
  }

  function ajustar() {
    setAba("configurar");
    encolher();
  }

  async function exportar(formato: Saida) {
    if (!config || !def) return;
    setOcupado(formato);
    // Abrir a janela ANTES do await: navegador só confia em `window.open` que
    // nasce do clique — depois de um `await` ele trata como popup e bloqueia.
    window.open(hrefSaida(relatorioId, formato, config), "_blank", "noopener");
    await registrarSaidaAction({ relatorioId, config, formato }).catch(() => {});
    setOcupado(null);
  }

  async function salvarComoPadrao() {
    if (!config) return;
    setSalvando(true);
    const r = await salvarPadraoAction({ relatorioId, config });
    setSalvando(false);
    if (!r.ok) {
      toast.error("Padrão não salvo", r.erro);
      return;
    }
    setPadrao(r.dados);
    setConfig(r.dados);
    toast.success("Padrão salvo", "Visualizar e exportar passam a sair assim.");
  }

  async function salvarComoModelo(nomeModelo: string, compartilhado: boolean) {
    if (!config) return;
    setSalvando(true);
    const r = await salvarModeloAction({ relatorioId, nome: nomeModelo, config, compartilhado });
    setSalvando(false);
    if (!r.ok) {
      toast.error("Modelo não salvo", r.erro);
      return;
    }
    setModelos(r.dados);
    toast.success("Modelo salvo", `“${nomeModelo}” está na lista.`);
  }

  async function excluirModelo(id: string) {
    const r = await excluirModeloAction({ relatorioId, id });
    if (!r.ok) {
      toast.error("Não deu para excluir", r.erro);
      return;
    }
    setModelos(r.dados);
  }

  const carregando = !abertura && !erro;

  return (
    <Sheet
      open
      onClose={onClose}
      width={largura}
      title="Personalizar relatório"
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium text-ink-2">{def?.nome ?? nome}</span>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <span>{categoria}</span>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <span className="text-muted">{def?.descricao || descricao}</span>
        </span>
      }
      footer={
        <Rodape
          aba={aba}
          pronto={def !== null && config !== null}
          exportacoes={exportacoes}
          ocupado={ocupado}
          podeExportar={abertura?.podeExportar ?? false}
          onAjustar={ajustar}
          onVisualizar={visualizar}
          onExportar={exportar}
          onFechar={onClose}
        />
      }
    >
      {erro && (
        <Aviso tom="erro" icone={Lock}>
          {erro}
        </Aviso>
      )}

      {carregando && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" aria-hidden />
          Carregando as colunas deste relatório…
        </div>
      )}

      {def && config && (
        <div className="space-y-6">
          <Abas aba={aba} temPrevia={previa !== null} onAba={(a) => (a === "configurar" ? ajustar() : setAba(a))} />

          {aba === "configurar" ? (
            <div className="space-y-6">
              {/* A faixa só existe depois que há o que salvar. Enquanto a tela
                  mostra o padrão, ela não pede decisão nenhuma. */}
              {personalizado && (
                <BarraPersonalizacao
                  salvando={salvando}
                  onPadrao={salvarComoPadrao}
                  onModelo={salvarComoModelo}
                  onDescartar={() => {
                    setConfig(padrao);
                    setPrevia(null);
                  }}
                />
              )}

              {modelos.length > 0 && (
                <Modelos
                  modelos={modelos}
                  onCarregar={(m) => {
                    setConfig(m.config);
                    setPrevia(null);
                    toast.info("Modelo carregado", m.nome);
                  }}
                  onExcluir={excluirModelo}
                />
              )}

              {/* Só relatório com recorte de tempo mostra período — inventário
                  é retrato de agora, e perguntar "de quando" seria mentira. */}
              {def.filtros.some((f) => f.tipo === "periodo") && (
                <Periodo config={config} onMudar={mudar} />
              )}

              <Colunas def={def} config={config} onMudar={mudar} />
            </div>
          ) : (
            <Visualizacao previa={previa} tabelaRef={medirTabela} />
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Abas                                                                */
/* ------------------------------------------------------------------ */

function Abas({
  aba,
  temPrevia,
  onAba,
}: {
  aba: "configurar" | "previa";
  temPrevia: boolean;
  onAba: (a: "configurar" | "previa") => void;
}) {
  const itens = [
    { id: "configurar" as const, label: "Colunas", ativa: true },
    { id: "previa" as const, label: "Visualizar", ativa: temPrevia },
  ];
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {itens.map((i) => (
        <button
          key={i.id}
          role="tab"
          type="button"
          aria-selected={aba === i.id}
          disabled={!i.ativa}
          onClick={() => onAba(i.id)}
          className={cn(
            "-mb-px cursor-pointer border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
            aba === i.id ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
            !i.ativa && "cursor-not-allowed opacity-40 hover:text-muted",
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Personalização — a faixa que só aparece quando existe               */
/* ------------------------------------------------------------------ */

function BarraPersonalizacao({
  salvando,
  onPadrao,
  onModelo,
  onDescartar,
}: {
  salvando: boolean;
  onPadrao: () => void;
  onModelo: (nome: string, compartilhado: boolean) => void;
  onDescartar: () => void;
}) {
  const [batizando, setBatizando] = React.useState(false);
  const [nome, setNome] = React.useState("");
  const [compartilhado, setCompartilhado] = React.useState(false);

  function confirmar() {
    const limpo = nome.trim();
    if (limpo.length < 2) return;
    onModelo(limpo, compartilhado);
    setNome("");
    setBatizando(false);
  }

  return (
    <section className="rounded-(--radius) border border-brand/30 bg-brand-soft/50 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-brand-strong">Configuração personalizada</p>
          <p className="text-[12px] text-muted">
            Vale só para esta sessão — a menos que você salve.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onDescartar}
            className="cursor-pointer rounded-full px-2.5 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={() => setBatizando((b) => !b)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
          >
            <Save size={13} aria-hidden />
            Salvar modelo
          </button>
          <Button size="sm" onClick={onPadrao} disabled={salvando}>
            {salvando ? (
              <LoaderCircle size={14} className="animate-spin" aria-hidden />
            ) : (
              <Pin size={14} aria-hidden />
            )}
            Salvar como padrão
          </Button>
        </div>
      </div>

      {batizando && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-brand/20 pt-3">
          <div className="min-w-52 flex-1">
            <label htmlFor="modelo-nome" className="mb-1 block text-[12px] font-medium text-muted">
              Nome do modelo
            </label>
            <Input
              id="modelo-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmar()}
              placeholder="Relatório do contador"
              className="h-10"
              autoFocus
            />
          </div>
          <label className="flex h-10 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <Switch checked={compartilhado} onCheckedChange={setCompartilhado} />
            Compartilhar com a equipe
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={confirmar}
            disabled={salvando || nome.trim().length < 2}
          >
            Salvar
          </Button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Modelos salvos                                                      */
/* ------------------------------------------------------------------ */

function Modelos({
  modelos,
  onCarregar,
  onExcluir,
}: {
  modelos: Modelo[];
  onCarregar: (m: Modelo) => void;
  onExcluir: (id: string) => void;
}) {
  return (
    <Secao titulo="Modelos">
      <div className="flex flex-wrap gap-2">
        {modelos.map((m) => (
          <span
            key={m.id}
            className="group flex items-center gap-1 rounded-full border border-line bg-surface py-1 pl-3.5 pr-1.5 text-[13px] transition-colors hover:border-brand/40"
          >
            <button
              type="button"
              onClick={() => onCarregar(m)}
              className="cursor-pointer font-medium text-ink-2 hover:text-brand"
            >
              {m.nome}
            </button>
            {m.compartilhado && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                equipe
              </span>
            )}
            {m.meu ? (
              <button
                type="button"
                onClick={() => onExcluir(m.id)}
                aria-label={`Excluir modelo ${m.nome}`}
                className="grid h-5 w-5 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <X size={12} aria-hidden />
              </button>
            ) : (
              <span className="w-1.5" />
            )}
          </span>
        ))}
      </div>
    </Secao>
  );
}

/* ------------------------------------------------------------------ */
/* Período                                                             */
/* ------------------------------------------------------------------ */

const PRESETS: { id: ReportConfig["periodo"]["preset"]; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "6m", label: "6 meses" },
  { id: "1a", label: "1 ano" },
];

/** `YYYY-MM-DD` de hoje — teto dos campos de data, em horário local. */
function hojeIso(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Recorte de tempo: os atalhos que resolvem 9 em 10 casos e, para o resto,
 * as duas datas.
 *
 * "Personalizado" não é um sétimo botão: escolher datas JÁ é personalizar, então
 * mexer em qualquer um dos campos muda o preset sozinho. Um botão a mais só
 * criaria um passo antes do passo.
 */
function Periodo({
  config,
  onMudar,
}: {
  config: ReportConfig;
  onMudar: (fn: (c: ReportConfig) => ReportConfig) => void;
}) {
  const p = config.periodo;
  const custom = p.preset === "custom";
  const hoje = hojeIso();

  function setPreset(preset: ReportConfig["periodo"]["preset"]) {
    onMudar((c) => ({ ...c, periodo: { preset } }));
  }

  function setData(campo: "de" | "ate", valor: string) {
    onMudar((c) => ({
      ...c,
      periodo: { ...c.periodo, preset: "custom", [campo]: valor || undefined },
    }));
  }

  return (
    <Secao
      titulo="Período"
      contagem={custom ? "datas escolhidas" : undefined}
      acao={
        custom ? (
          <button
            type="button"
            onClick={() => setPreset("30d")}
            className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink"
          >
            <RotateCcw size={13} aria-hidden />
            Voltar a 30 dias
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={p.preset === preset.id}
              onClick={() => setPreset(preset.id)}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                p.preset === preset.id
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-muted hover:border-brand/40 hover:text-ink",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="periodo-de" className="mb-1 block text-[12px] font-medium text-muted">
              De
            </label>
            <Input
              id="periodo-de"
              type="date"
              className="h-10"
              max={p.ate || hoje}
              value={custom ? (p.de ?? "") : ""}
              onChange={(e) => setData("de", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="periodo-ate" className="mb-1 block text-[12px] font-medium text-muted">
              Até
            </label>
            <Input
              id="periodo-ate"
              type="date"
              className="h-10"
              min={custom ? (p.de ?? undefined) : undefined}
              max={hoje}
              value={custom ? (p.ate ?? "") : ""}
              onChange={(e) => setData("ate", e.target.value)}
            />
          </div>
        </div>

        <p className="text-[12px] text-faint">
          {custom
            ? "Sem data final, o relatório vai até hoje."
            : "Preencha as datas para um recorte específico — o atalho acima é desmarcado."}
        </p>
      </div>
    </Secao>
  );
}

/* ------------------------------------------------------------------ */
/* Colunas                                                             */
/* ------------------------------------------------------------------ */

function Colunas({
  def,
  config,
  onMudar,
}: {
  def: ReportDefinitionCliente;
  config: ReportConfig;
  onMudar: (fn: (c: ReportConfig) => ReportConfig) => void;
}) {
  const arrastando = React.useRef<number | null>(null);
  const porId = React.useMemo(() => new Map(def.colunas.map((c) => [c.id, c])), [def.colunas]);

  const escolhidas = config.colunas.filter((id) => porId.has(id));
  const disponiveis = def.colunas.filter((c) => !escolhidas.includes(c.id));

  function setColunas(ids: string[]) {
    onMudar((c) => ({ ...c, colunas: ids }));
  }

  function mover(de: number, para: number) {
    if (para < 0 || para >= escolhidas.length || de === para) return;
    const nova = [...escolhidas];
    const [item] = nova.splice(de, 1);
    nova.splice(para, 0, item!);
    setColunas(nova);
  }

  return (
    <Secao
      titulo="Colunas"
      contagem={`${escolhidas.length} de ${def.colunas.length}`}
      acao={
        <button
          type="button"
          onClick={() => setColunas(configPadrao(def).colunas)}
          className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink"
        >
          <RotateCcw size={13} aria-hidden />
          Restaurar padrão
        </button>
      }
    >
      <div className="space-y-4">
        {/* Escolhidas — a ordem daqui é a ordem da tabela e do PDF */}
        <ul className="space-y-1.5">
          {escolhidas.map((id, i) => {
            const col = porId.get(id)!;
            return (
              <li
                key={id}
                draggable
                onDragStart={() => (arrastando.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (arrastando.current !== null) mover(arrastando.current, i);
                  arrastando.current = null;
                }}
                className="flex items-center gap-2 rounded-(--radius) border border-line bg-surface py-1.5 pl-2 pr-1.5"
              >
                <GripVertical size={14} className="shrink-0 cursor-grab text-faint" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{col.label}</span>
                {col.obrigatoria && (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                    fixa
                  </span>
                )}
                <div className="flex shrink-0 items-center">
                  <MiniBotao
                    label={`Subir ${col.label}`}
                    disabled={i === 0}
                    onClick={() => mover(i, i - 1)}
                    icon={ArrowUp}
                  />
                  <MiniBotao
                    label={`Descer ${col.label}`}
                    disabled={i === escolhidas.length - 1}
                    onClick={() => mover(i, i + 1)}
                    icon={ArrowDown}
                  />
                  <MiniBotao
                    label={`Remover ${col.label}`}
                    disabled={!!col.obrigatoria}
                    onClick={() => setColunas(escolhidas.filter((c) => c !== id))}
                    icon={X}
                    perigo
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {/* Disponíveis */}
        <div>
          {disponiveis.length === 0 ? (
            <p className="text-[13px] text-faint">Todas as colunas já estão na tabela.</p>
          ) : (
            <div className="flex flex-wrap content-start gap-1.5">
              {disponiveis.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColunas([...escolhidas, c.id])}
                  className="flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-[12.5px] text-muted transition-colors hover:border-brand/50 hover:bg-brand-soft hover:text-brand-strong"
                >
                  <Plus size={12} aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-[12px] text-faint">
            Arraste para reordenar (ou use as setas). A ordem daqui é a ordem do PDF — e é ela que
            decide se a folha sai em pé ou deitada.
          </p>
        </div>
      </div>
    </Secao>
  );
}

function MiniBotao({
  label,
  icon: Icon,
  disabled,
  perigo,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
  perigo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 cursor-pointer place-items-center rounded-full text-faint transition-colors",
        perigo ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-surface-2 hover:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint",
      )}
    >
      <Icon size={13} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Rodapé                                                              */
/* ------------------------------------------------------------------ */

function Rodape({
  aba,
  pronto,
  exportacoes,
  ocupado,
  podeExportar,
  onAjustar,
  onVisualizar,
  onExportar,
  onFechar,
}: {
  aba: "configurar" | "previa";
  pronto: boolean;
  exportacoes: readonly Exportacao[];
  ocupado: null | "previa" | Saida;
  podeExportar: boolean;
  onAjustar: () => void;
  onVisualizar: () => void;
  onExportar: (f: Saida) => void;
  onFechar: () => void;
}) {
  if (!pronto) {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    );
  }

  if (aba === "configurar") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onVisualizar} disabled={ocupado !== null}>
          {ocupado === "previa" ? (
            <LoaderCircle size={15} className="animate-spin" aria-hidden />
          ) : (
            <Table2 size={15} aria-hidden />
          )}
          Visualizar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={onAjustar}>
        <ChevronLeft size={15} aria-hidden />
        Ajustar colunas
      </Button>

      {podeExportar && exportacoes.length > 0 ? (
        <MenuExportar
          exportacoes={exportacoes}
          ocupado={ocupado === "previa" ? null : ocupado}
          onExportar={onExportar}
          trigger={<BotaoBaixar ocupado={ocupado !== null} />}
        />
      ) : (
        <p className="text-[12px] text-muted">
          Seu perfil não pode exportar. A prévia acima já traz os números.
        </p>
      )}
    </div>
  );
}

/** `onClick` chega por `cloneElement` do Menu; este botão só repassa. */
function BotaoBaixar({ ocupado, onClick }: { ocupado: boolean; onClick?: () => void }) {
  return (
    <Button size="sm" onClick={onClick} disabled={ocupado}>
      {ocupado ? (
        <LoaderCircle size={15} className="animate-spin" aria-hidden />
      ) : (
        <Download size={15} aria-hidden />
      )}
      Baixar
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

function Secao({
  titulo,
  contagem,
  acao,
  children,
}: {
  titulo: string;
  contagem?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
          {titulo}
          {contagem && <span className="font-normal normal-case text-faint">{contagem}</span>}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  );
}
