"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Send,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { fmtMoney } from "../_catalogo/ui";
import type { CotacaoAnterior, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import { editarCotacaoAction } from "../_compra-actions";
import { statusVisivel } from "../_status";
import { ItensDaCotacaoCard } from "./_itens";
import { FornecedoresDaCotacaoCard } from "./_convites";

// ── Revisão da cotação ──────────────────────────────────────
// Tela única de conferência, e o último passo antes de a pergunta sair.
//
// Antes eram três abas independentes: os dados de cabeçalho aqui, os itens
// numa, os fornecedores noutra — e conferir exigia ir e voltar guardando de
// cabeça o que tinha visto. Agora tudo está de uma vez, na ordem da pergunta
// que o operador faz a si mesmo: o QUE estou cotando (o card de cima), QUAIS
// itens (70% da largura), PARA QUEM (30%) e só então criar.
//
// Nada de preço aqui — preço é o que ainda não existe.

const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** `2026-08-22` a partir do ISO guardado — o input date só entende esse formato. */
function paraInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "";
}

type Campo = "titulo" | "dataCotacao" | "prazoResposta" | "itens" | "fornecedores";

/** Preferência de card recolhido — vale para todas as cotações do operador. */
const CHAVE_CONDICOES = "nohub:cotacao:condicoes-abertas";

/** `22/08` — data curta para o resumo do card recolhido. */
function dataCurta(valor: string): string {
  const [, mes, dia] = valor.split("-");
  return dia && mes ? `${dia}/${mes}` : valor;
}

export function RevisarCotacao({
  cotacao,
  fornecedores,
  sites,
  editavel,
  podeConvidar,
  podeRemover,
  itensEditaveis,
  itensTravados,
  usaMinimo,
  anterior,
  onEnviar,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  /** Lojas ativas: com uma só, o nome dela não informa nada e some da tela. */
  sites: { id: string; nome: string }[];
  editavel: boolean;
  /** Chamar mais um para a disputa. */
  podeConvidar: boolean;
  /** Tirar alguém da cotação — só antes de o convite existir lá fora. */
  podeRemover: boolean;
  /** A lista ainda aceita mudança (congela na primeira resposta). */
  itensEditaveis: boolean;
  /** Por que a lista congelou, quando quem olha teria permissão de mexer. */
  itensTravados: string | null;
  /** Mostra o mínimo na linha do item quando a estratégia do tenant usa piso. */
  usaMinimo: boolean;
  /** Cotação anterior oferecida como molde no estado vazio da lista. */
  anterior: CotacaoAnterior | null;
  /**
   * Pede à PÁGINA que abra a central de envio. O painel não pode morar aqui:
   * no primeiro envio confirmado a cotação vira ABERTA, esta tela desmonta e
   * levaria o painel junto, no meio da fila.
   */
  onEnviar: (alvos: CotacaoDetalhe["convites"]) => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  /** Campos reprovados na validação — some assim que o operador corrige. */
  const [invalidos, setInvalidos] = useState<Partial<Record<Campo, string>>>({});
  /** Instante da última gravação automática — vira o "Salvo" do cabeçalho. */
  const [salvoEm, setSalvoEm] = useState<number | null>(null);
  /**
   * Condições abertas ou recolhidas.
   *
   * Nome, datas e recado se preenchem uma vez e depois só atrapalham quem
   * ainda está montando a lista — recolhido, o card vira uma linha de resumo
   * e a lista de itens sobe para o alto da tela. A escolha acompanha o
   * operador entre cotações: é hábito de trabalho, não estado desta cotação.
   *
   * A preferência é lida por `useSyncExternalStore` porque o servidor não tem
   * `localStorage`: ele desenha aberto, e o cliente corrige na hidratação sem
   * o efeito em cascata que um `useEffect` faria.
   */
  const lembradoAberto = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(CHAVE_CONDICOES) !== "0";
      } catch {
        // Navegador sem storage (aba anônima, política restritiva): abre.
        return true;
      }
    },
    () => true,
  );
  /** Escolha desta sessão; `null` = o que estava lembrado. */
  const [condicoesAlternadas, setCondicoesAlternadas] = useState<boolean | null>(null);
  const condicoesAbertas = condicoesAlternadas ?? lembradoAberto;

  function alternarCondicoes(aberto = !condicoesAbertas) {
    setCondicoesAlternadas(aberto);
    try {
      localStorage.setItem(CHAVE_CONDICOES, aberto ? "1" : "0");
    } catch {
      // Não poder lembrar a preferência não impede de recolher agora.
    }
  }

  /**
   * Recolhe as condições porque o trabalho mudou de lugar — o cursor entrou na
   * busca de produtos, ou a folha de fornecedores vai abrir. O card fecha
   * animado, e a lista sobe para o alto da tela sem ninguém pedir.
   *
   * Não grava a preferência: isto é o sistema saindo da frente, não a escolha
   * do operador. Reaberto pelo cabeçalho, volta a ser escolha e aí sim fica
   * gravado.
   */
  function recolherCondicoes() {
    if (condicoesAbertas) setCondicoesAlternadas(false);
  }

  const tituloRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<HTMLInputElement>(null);
  const prazoRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    titulo: cotacao.titulo,
    siteId: cotacao.siteId,
    dataCotacao: paraInput(cotacao.dataCotacao),
    prazoResposta: paraInput(cotacao.prazoResposta),
    observacao: cotacao.observacao ?? "",
    pedeEscala: cotacao.pedeEscala,
  });

  function mudar<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
    // Corrigiu o campo, a mensagem sai: um erro que sobrevive à correção
    // ensina o operador a ignorar erros.
    setInvalidos((atual) => {
      if (!(campo in atual)) return atual;
      const resto = { ...atual };
      delete resto[campo as Campo];
      return resto;
    });
  }

  const sujoDe = (f: typeof form) =>
    f.titulo !== cotacao.titulo ||
    f.siteId !== cotacao.siteId ||
    f.dataCotacao !== paraInput(cotacao.dataCotacao) ||
    f.prazoResposta !== paraInput(cotacao.prazoResposta) ||
    f.observacao !== (cotacao.observacao ?? "") ||
    f.pedeEscala !== cotacao.pedeEscala;

  const sujo = sujoDe(form);

  const pendentes = cotacao.convites.filter((c) => c.status === "PENDENTE");
  const totalUnidades = cotacao.itens.reduce((soma, i) => soma + i.quantidade, 0);
  const rotulo = statusVisivel(
    cotacao.status,
    cotacao.convites.length,
    cotacao.convites.filter((c) => c.status === "RESPONDIDA").length,
    cotacao.convites.filter((c) => c.status === "RECUSADA").length,
  );

  /**
   * Previsão de gasto pelo custo que a operação já conhece — média das
   * entradas, ou o custo de cadastro. Não é preço de fornecedor (esse ainda
   * não existe), é a ordem de grandeza que decide se a lista está do tamanho
   * do caixa. Item sem custo não vira zero: fica de fora e a tela diz que a
   * conta está incompleta.
   */
  const previsto = cotacao.itens.reduce(
    (acc, i) =>
      i.custoUnitario === null
        ? { total: acc.total, semCusto: acc.semCusto + 1 }
        : {
            total: acc.total + i.quantidade * i.fatorEmbalagem * i.custoUnitario,
            semCusto: acc.semCusto,
          },
    { total: 0, semCusto: 0 },
  );

  async function salvarAjustes(f: typeof form = form) {
    await editarCotacaoAction({
      id: cotacao.id,
      titulo: f.titulo.trim(),
      siteId: f.siteId,
      dataCotacao: f.dataCotacao || null,
      prazoResposta: f.prazoResposta || null,
      observacao: f.observacao.trim() || null,
      pedeEscala: f.pedeEscala,
    });
  }

  /**
   * Grava ao sair do campo, sem botão.
   *
   * O "Salvar alterações" que existia aqui era um passo a mais para o
   * operador esquecer — e esquecer significava mandar ao fornecedor o prazo
   * velho. Sai do campo, está gravado.
   *
   * Não grava enquanto o nome estiver curto demais: a Server Action recusa (o
   * nome é a identificação da cotação), e um erro vermelho a cada tecla
   * apagada no meio de renomear não ajuda ninguém. O erro reaparece na hora
   * certa, no "Criar cotação".
   */
  function salvarSeMudou(f: typeof form = form) {
    if (!editavel || !sujoDe(f) || pendente) return;
    if (f.titulo.trim().length < 3) return;
    setErro(null);
    startTransition(async () => {
      try {
        await salvarAjustes(f);
        setSalvoEm(Date.now());
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  /** Campo sem blur confiável (select, switch): muda e grava no mesmo gesto. */
  function mudarEGravar<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    const proximo = { ...form, [campo]: valor };
    setForm(proximo);
    setInvalidos((atual) => {
      if (!(campo in atual)) return atual;
      const resto = { ...atual };
      delete resto[campo as Campo];
      return resto;
    });
    salvarSeMudou(proximo);
  }

  /**
   * A conferência inteira, campo a campo. Mensagem que diz O QUE falta e
   * onde — "erro ao salvar" manda o operador procurar sozinho.
   */
  function validar(): Partial<Record<Campo, string>> {
    const falhas: Partial<Record<Campo, string>> = {};
    const titulo = form.titulo.trim();
    if (!titulo) falhas.titulo = "Informe o nome da cotação.";
    else if (titulo.length < 3) falhas.titulo = "O nome precisa de ao menos 3 letras.";

    if (!form.dataCotacao) falhas.dataCotacao = "Informe a data da cotação.";

    if (form.prazoResposta && form.dataCotacao && form.prazoResposta < form.dataCotacao) {
      falhas.prazoResposta = "O prazo não pode ser anterior à data da cotação.";
    }

    if (cotacao.itens.length === 0) falhas.itens = "Adicione pelo menos um item.";
    if (cotacao.convites.length === 0) {
      falhas.fornecedores = "Selecione pelo menos um fornecedor.";
    }
    return falhas;
  }

  function criar() {
    setErro(null);
    const falhas = validar();
    setInvalidos(falhas);
    if (Object.keys(falhas).length > 0) {
      // Foco no primeiro campo reprovado: numa tela desta altura o erro pode
      // estar fora da janela quando o clique acontece no rodapé fixo.
      const alvo = falhas.titulo
        ? tituloRef
        : falhas.dataCotacao
          ? dataRef
          : falhas.prazoResposta
            ? prazoRef
            : null;
      // Faltou algo nas condições e elas estão recolhidas: abrir é parte de
      // apontar o erro — um campo escondido não é um campo apontado. O foco
      // espera o próximo quadro: campo em `display:none` não recebe foco.
      const apontar = () => {
        alvo?.current?.focus();
        alvo?.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      };
      if (alvo && !condicoesAbertas) {
        alternarCondicoes(true);
        requestAnimationFrame(apontar);
      } else {
        apontar();
      }
      return;
    }

    startTransition(async () => {
      try {
        // Grava antes de abrir a conferência: o prazo e o recado que o
        // fornecedor vê são os que estão na tela, não os que sobraram do
        // rascunho.
        if (sujo) await salvarAjustes();
        // Quem abre a folha é a PÁGINA, não esta tela: assim que o primeiro
        // envio é confirmado a cotação vira ABERTA e a revisão desmonta —
        // levando o painel junto se ele morasse aqui dentro.
        onEnviar(pendentes);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar a cotação.");
      }
    });
  }

  const campo =
    "rounded-[var(--radius)] border bg-surface px-3 py-2 text-sm text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60";
  const borda = (c: Campo) => (invalidos[c] ? "border-danger" : "border-line");

  return (
    <div className="flex flex-col gap-5">
      {/* O cabeçalho da página (número, "Revisão da cotação", ações) é o do
          `Cabecalho` acima — não há título próprio aqui, ou seriam dois. */}

      {/* ── Cotação de compra ────────────────────────────── */}
      <section
        aria-labelledby="cotacao-de-compra-titulo"
        // ⌘/Ctrl+Enter fecha a cotação de qualquer campo do card: quem preenche
        // formulário no teclado não deveria ter de buscar o CTA com o mouse.
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            criar();
          }
        }}
        className="rounded-[var(--radius-lg)] border border-line bg-surface"
      >
        {/* O título recolhe o card e o sinal de gravação fica de fora dele:
            quem clica no cabeçalho quer abrir ou fechar, não descobrir que
            apertou o "Salvo". Recolhido, a linha de apoio troca a instrução
            pelo resumo do que já está preenchido. */}
        <header
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3",
            condicoesAbertas && "border-b border-line",
          )}
        >
          <button
            type="button"
            onClick={() => alternarCondicoes()}
            aria-expanded={condicoesAbertas}
            aria-controls="cotacao-de-compra-campos"
            className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ChevronDown
              size={16}
              aria-hidden
              className={cn(
                "shrink-0 text-muted transition-transform group-hover:text-ink motion-reduce:transition-none",
                !condicoesAbertas && "-rotate-90",
              )}
            />
            <span className="min-w-0">
              <span
                id="cotacao-de-compra-titulo"
                className="block font-display text-[15px] font-semibold leading-tight text-ink"
              >
                Cotação de compra
              </span>
              <span className="block truncate text-[12px] text-muted">
                {condicoesAbertas ? (
                  "Defina as informações que serão utilizadas na solicitação aos fornecedores."
                ) : (
                  <>
                    {form.titulo.trim() || "Sem nome"}
                    {form.dataCotacao && ` · ${dataCurta(form.dataCotacao)}`}
                    {form.prazoResposta && ` → ${dataCurta(form.prazoResposta)}`}
                    {sites.length > 1 &&
                      ` · ${sites.find((s) => s.id === form.siteId)?.nome ?? ""}`}
                    {form.pedeEscala && " · preço por volume"}
                  </>
                )}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-3">
            {/* Sinal de gravação, não botão: diz que já está salvo em vez de
                pedir que alguém salve. */}
            {editavel && (pendente || sujo || salvoEm !== null) && (
              <span
                aria-live="polite"
                className={cn(
                  "flex items-center gap-1.5 text-[12px]",
                  sujo && !pendente ? "text-faint" : "text-muted",
                )}
              >
                {pendente ? (
                  "Salvando…"
                ) : sujo ? (
                  "Alterações não salvas"
                ) : (
                  <>
                    <Check size={13} className="text-ok" />
                    Salvo
                  </>
                )}
              </span>
            )}
            {/* O estado da cotação pertence ao card que a define, na altura do
                título dela — e não a uma sobrancelha solta no topo da página. */}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                rotulo.classe,
              )}
            >
              {rotulo.label}
            </span>
          </div>
        </header>

        {/* Fecha animado, não desmonta.
            A altura sai de `grid-template-rows: 1fr → 0fr`, que é a única
            forma de transicionar altura desconhecida sem medir nada em JS. Os
            campos continuam no DOM para o "Criar cotação" poder reabrir o card
            e levar o foco ao que faltou; `inert` os tira do Tab e do leitor de
            tela enquanto estão recolhidos, para ninguém tabular para dentro de
            um card fechado. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
            condicoesAbertas ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div
              id="cotacao-de-compra-campos"
              inert={!condicoesAbertas || undefined}
              className="flex flex-col gap-3 p-4"
            >
              {/* Uma linha só: o nome largo e as duas datas ao lado. As datas se
              leem uma contra a outra ("de hoje até quinta") — separadas em
              linhas viram duas perguntas, e o card cresce à toa. */}
              <div
                className={cn(
                  "grid gap-3 sm:grid-cols-2",
                  sites.length > 1
                    ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
                    : "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]",
                )}
              >
                <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
                  <span className="text-[12px] font-medium text-ink-2">
                    Nome da cotação
                  </span>
                  <input
                    ref={tituloRef}
                    value={form.titulo}
                    onChange={(e) => mudar("titulo", e.target.value)}
                    disabled={!editavel}
                    onBlur={() => salvarSeMudou()}
                    onKeyDown={(e) => {
                      // Enter num campo de texto solto não faz nada por padrão.
                      // Aqui ele anda: nome → data, que é a ordem de preenchimento.
                      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        salvarSeMudou();
                        dataRef.current?.focus();
                      }
                    }}
                    required
                    aria-invalid={!!invalidos.titulo}
                    aria-describedby={invalidos.titulo ? "erro-titulo" : undefined}
                    placeholder="Ex.: Cotação de bebidas — agosto"
                    className={cn(campo, borda("titulo"))}
                  />
                  {invalidos.titulo && (
                    <span
                      id="erro-titulo"
                      className="text-[12px] font-medium text-danger"
                    >
                      {invalidos.titulo}
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                    <CalendarDays size={12} className="text-faint" />
                    Data da cotação
                  </span>
                  <input
                    ref={dataRef}
                    type="date"
                    value={form.dataCotacao}
                    onChange={(e) => mudar("dataCotacao", e.target.value)}
                    disabled={!editavel}
                    onBlur={() => salvarSeMudou()}
                    required
                    aria-invalid={!!invalidos.dataCotacao}
                    aria-describedby={invalidos.dataCotacao ? "erro-data" : undefined}
                    className={cn(campo, borda("dataCotacao"))}
                  />
                  {invalidos.dataCotacao && (
                    <span id="erro-data" className="text-[12px] font-medium text-danger">
                      {invalidos.dataCotacao}
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                    <CalendarClock size={12} className="text-faint" />
                    Responder até
                  </span>
                  <input
                    ref={prazoRef}
                    type="date"
                    value={form.prazoResposta}
                    min={form.dataCotacao || undefined}
                    onChange={(e) => mudar("prazoResposta", e.target.value)}
                    disabled={!editavel}
                    onBlur={() => salvarSeMudou()}
                    aria-invalid={!!invalidos.prazoResposta}
                    aria-describedby={invalidos.prazoResposta ? "erro-prazo" : undefined}
                    className={cn(campo, borda("prazoResposta"))}
                  />
                  {invalidos.prazoResposta && (
                    <span id="erro-prazo" className="text-[12px] font-medium text-danger">
                      {invalidos.prazoResposta}
                    </span>
                  )}
                </label>

                <label
                  className={cn("flex flex-col gap-1", sites.length <= 1 && "hidden")}
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                    <Store size={12} className="text-faint" />
                    Entregar em
                  </span>
                  <select
                    value={form.siteId}
                    onChange={(e) => mudarEGravar("siteId", e.target.value)}
                    disabled={!editavel}
                    className={cn(campo, "border-line")}
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Segunda e última linha: o recado ocupa o espaço do nome, e a
              chave da escala ocupa o das datas. Empilhados eram duas linhas
              inteiras para um campo opcional e um botão de liga/desliga. */}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-ink-2">
                    Recado ao fornecedor <span className="text-faint">(opcional)</span>
                  </span>
                  <textarea
                    value={form.observacao}
                    onChange={(e) => mudar("observacao", e.target.value)}
                    disabled={!editavel}
                    onBlur={() => salvarSeMudou()}
                    rows={2}
                    placeholder="Ex.: favor informar disponibilidade, preço, condições de pagamento e prazo de entrega."
                    className={cn(campo, "min-h-[4.5rem] resize-y border-line")}
                  />
                </label>

                {/* A chave da escala vale para a cotação inteira e muda o que o
                FORNECEDOR vê: ligada, cada item ganha um campo opcional de "a
                partir de N, R$ X". Desligada — o padrão — a tela dele continua
                com um preço por item, que é o piso do que um vendedor responde
                no meio do dia.

                Rótulo fora da caixa e altura mínima igual à do textarea: os
                dois campos da linha começam e terminam juntos. */}
                <div className="flex flex-col gap-1">
                  <span
                    className="text-[12px] font-medium text-ink-2"
                    id="pede-escala-label"
                  >
                    Perguntar preço por volume
                  </span>
                  <div className="flex min-h-[4.5rem] flex-1 items-center justify-between gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5">
                    <p className="min-w-0 text-[11px] leading-snug text-muted">
                      O fornecedor informa preços diferentes conforme a quantidade
                      comprada.
                    </p>
                    <Switch
                      checked={form.pedeEscala}
                      onCheckedChange={(v) => mudarEGravar("pedeEscala", v)}
                      disabled={!editavel}
                      aria-labelledby="pede-escala-label"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Itens (70%) × fornecedores (30%) ─────────────── */}
      {/* No celular os fornecedores vêm PRIMEIRO: são três linhas, e deixá-los
          embaixo de uma lista de trinta itens escondia a metade da tela que
          decide para quem a cotação vai. No desktop as duas colunas convivem e
          a ordem natural volta — itens à esquerda. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
        <div className="order-2 lg:order-1 lg:col-span-7">
          <ItensDaCotacaoCard
            cotacao={cotacao}
            editavel={itensEditaveis}
            travado={itensTravados}
            usaMinimo={usaMinimo}
            anterior={anterior}
            alerta={invalidos.itens ?? null}
            onMontarLista={recolherCondicoes}
          />
        </div>
        <div className="order-1 lg:order-2 lg:col-span-3">
          <FornecedoresDaCotacaoCard
            cotacao={cotacao}
            fornecedores={fornecedores}
            podeConvidar={podeConvidar}
            podeRemover={podeRemover}
            alerta={invalidos.fornecedores ?? null}
            onEscolherFornecedor={recolherCondicoes}
          />
        </div>
      </div>

      {/* O aviso de "fornecedor sem contato" mora na LINHA do fornecedor, na
          coluna da direita, com o atalho para cadastrar o vendedor ali mesmo —
          um parágrafo aqui embaixo dizia que existe um problema sem dizer com
          quem. */}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {/* ── Rodapé: fora dos cards, colado no fim da tela ── */}
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-float)]">
        {/* Uma régua só, com divisores: número em cima, o que ele conta
            embaixo. Empilhado em duas frases corridas, o tamanho da cotação —
            a coisa que decide se ela está pronta para sair — se lia palavra
            por palavra. O `aria-live` é do bloco todo porque cada item
            adicionado mexe em mais de um número. */}
        <dl aria-live="polite" className="flex min-w-0 flex-wrap items-stretch">
          <DadoRodape
            valor={String(cotacao.itens.length)}
            rotulo={cotacao.itens.length === 1 ? "item" : "itens"}
          />
          <DadoRodape
            valor={String(cotacao.convites.length)}
            rotulo={cotacao.convites.length === 1 ? "fornecedor" : "fornecedores"}
          />
          {totalUnidades > 0 && (
            <DadoRodape
              valor={fmtQtd(totalUnidades)}
              rotulo="unidades"
              className="hidden sm:flex"
            />
          )}
          {/* O "≈" não é enfeite: é custo conhecido, não proposta. Quem lê
              precisa saber que o número vai mudar quando o preço chegar. */}
          {previsto.total > 0 && (
            <DadoRodape
              valor={`≈ ${fmtMoney(previsto.total)}`}
              rotulo={
                previsto.semCusto > 0
                  ? `pelo custo atual · ${previsto.semCusto} sem custo de fora`
                  : "pelo custo atual"
              }
            />
          )}
        </dl>
        {/* Só o CTA. Sair da tela já é a seta do cabeçalho — e ela grava o
            rascunho do mesmo jeito. Repetir a saída ao lado de "Criar cotação"
            punha um botão de desistir do tamanho do de concluir. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={criar}
            disabled={!editavel || pendente || pendentes.length === 0}
            title={
              pendentes.length === 0 && cotacao.convites.length > 0
                ? "Todos os fornecedores já receberam esta cotação."
                : undefined
            }
            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={15} />
            {pendente ? "Um instante…" : "Criar cotação"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Número do rodapé ────────────────────────────────────────
// Valor em cima, o que ele conta embaixo, divisor à esquerda de todos menos o
// primeiro: a régua se lê de uma vez, e cada número continua legível sozinho.

function DadoRodape({
  valor,
  rotulo,
  className,
}: {
  valor: string;
  rotulo: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse justify-center border-l border-line pl-3.5 ml-3.5",
        "first:ml-0 first:border-l-0 first:pl-0",
        className,
      )}
    >
      {/* `flex-col-reverse`: o rótulo vem antes no DOM (o `dt` de uma lista de
          definição precede o `dd`) e depois na tela, embaixo do número. */}
      <dt className="text-[11px] leading-tight text-muted">{rotulo}</dt>
      <dd className="font-mono text-[15px] font-semibold leading-tight tabular-nums text-ink">
        {valor}
      </dd>
    </div>
  );
}
