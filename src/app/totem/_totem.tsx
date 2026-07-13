"use client";

import { useMemo, useState, useTransition, useEffect, useRef, createElement } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Minus, Trash2, Loader2, ShoppingCart, QrCode, CheckCircle2,
  User, UserPlus, ArrowRight, ArrowLeft, Star, RotateCcw,
  Sparkles, Flame, Delete, X, Award, Wallet, Banknote, CreditCard,
  ShieldCheck, ImageIcon, Check, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { criarVendaTotemAction } from "@/app/(app)/vendas/actions";
import type { ProdutoVenda, ComponentGroupVenda } from "@/app/(app)/vendas/_data";
import type { PaymentMethod } from "@/generated/prisma";
import {
  identificarClienteAction, cadastroRapidoAction, cadastroDisponivelAction, finalizarTotemAction,
  type PerfilTotem, type ResultadoTotem,
} from "./actions";
import { iconeCategoria, termosSugeridos, fmtVolume, norm } from "./_catalog";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type CartItem = {
  key: string; productId: string; variantId: string | null;
  nome: string; variantNome: string | null; preco: number; quantidade: number;
  restricaoIdade: boolean; imagemUrl: string | null; volume: string; categoria: string | null;
  /** PERSONALIZADO: componentes escolhidos no modal de montagem. */
  selecoes: string[];
  detalhe: string | null; // rótulo das escolhas ("Vodka, Gelo, Limão")
};

type Etapa = "boas-vindas" | "cpf" | "cadastro" | "compra" | "revisao" | "idade" | "pagamento" | "confirmado" | "enviado";

const precoBase = (p: ProdutoVenda) => p.variants[0]?.preco ?? p.preco;
const volumeBase = (p: ProdutoVenda) => fmtVolume(p.variants[0]?.volumeMl);

/** Ícone Lucide da categoria — componente estável (evita criar no render). */
function CatIcon({ nome, size, className }: { nome: string | null | undefined; size?: number; className?: string }) {
  return createElement(iconeCategoria(nome), { size, className });
}

export function TotemVenda({
  siteId, produtos, metodosAtivos, tenantNome, tenantLogoUrl, controleIdade, maisVendidos,
  totemDeviceId, terminalNome, caixaAberto,
}: {
  siteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  tenantNome: string;
  tenantLogoUrl: string | null;
  controleIdade: boolean;
  maisVendidos: string[];
  totemDeviceId: string | null;
  terminalNome: string | null;
  caixaAberto: boolean;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>("boas-vindas");
  const [cliente, setCliente] = useState<PerfilTotem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [catAtiva, setCatAtiva] = useState<string | null>(null);
  const [maiorIdade, setMaiorIdade] = useState(false);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<PaymentMethod | null>(null);
  const [resultado, setResultado] = useState<ResultadoTotem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Só produtos com estoque (esgotado não aparece no totem).
  const disponiveis = useMemo(
    () => produtos.filter((p) => (p.estoqueFechado == null || p.estoqueFechado > 0) && p.disponivel),
    [produtos],
  );
  const byId = useMemo(() => new Map(disponiveis.map((p) => [p.id, p])), [disponiveis]);
  const total = cart.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const numItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const precisaIdade = controleIdade && cart.some((i) => i.restricaoIdade);

  // Venda sugestiva a partir do último item adicionado (só produtos de toque único).
  const ultimo = cart[cart.length - 1];
  const sugestoes = useMemo(() => {
    if (!ultimo) return [];
    const termos = termosSugeridos(ultimo.categoria);
    if (termos.length === 0) return [];
    const noCart = new Set(cart.map((i) => i.productId));
    return disponiveis
      .filter((p) => p.tipo !== "PERSONALIZADO" && !noCart.has(p.id) &&
        termos.some((t) => norm(p.categoria ?? "").includes(t)))
      .slice(0, 4);
  }, [ultimo, cart, disponiveis]);

  function add(p: ProdutoVenda, opts?: { selecoes?: string[]; precoExtra?: number; detalhe?: string }) {
    const variant = p.variants[0] ?? null;
    const selecoes = opts?.selecoes ?? [];
    const key = p.id + ":" + (variant?.id ?? "") + ":" + [...selecoes].sort().join("|");
    setCart((prev) => {
      const ex = prev.find((i) => i.key === key);
      if (ex) return prev.map((i) => (i.key === key ? { ...i, quantidade: i.quantidade + 1 } : i));
      return [...prev, {
        key, productId: p.id, variantId: variant?.id ?? null, nome: p.nome,
        variantNome: variant?.nome ?? null, preco: precoBase(p) + (opts?.precoExtra ?? 0), quantidade: 1,
        restricaoIdade: p.restricaoIdade, imagemUrl: p.imagemUrl, volume: volumeBase(p),
        categoria: p.categoria, selecoes, detalhe: opts?.detalhe ?? null,
      }];
    });
  }
  function setQtd(key: string, q: number) {
    if (q <= 0) return setCart((prev) => prev.filter((i) => i.key !== key));
    setCart((prev) => prev.map((i) => (i.key === key ? { ...i, quantidade: q } : i)));
  }

  // ── Identificação ──
  function identificar(cpf: string) {
    setError(null);
    startTransition(async () => {
      try {
        const perfil = await identificarClienteAction(cpf);
        if (!perfil) { setError("CPF não encontrado. Faça um cadastro rápido ou siga sem cadastro."); return; }
        // Sem tela intermediária: entra direto na loja já saudado no cabeçalho.
        setCliente(perfil); setEtapa("compra");
      } catch (e) { setError(e instanceof Error ? e.message : "Erro ao consultar CPF."); }
    });
  }
  function cadastrar(nome: string, cpf: string, telefone: string) {
    setError(null);
    startTransition(async () => {
      try {
        const perfil = await cadastroRapidoAction({ nome, cpf, telefone });
        setCliente(perfil); setEtapa("compra");
      } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível cadastrar."); }
    });
  }

  // ── Checkout ──
  function irPagar() {
    if (cart.length === 0) return;
    setError(null);
    if (precisaIdade && !maiorIdade) { setEtapa("idade"); return; }
    setMetodo(null); setSaleId(null); setEtapa("pagamento");
  }

  function iniciarPagamento(m: PaymentMethod) {
    if (!siteId) { setError("Site não configurado."); return; }
    setError(null); setMetodo(m);
    startTransition(async () => {
      try {
        const id = await criarVendaTotemAction({
          siteId, origem: "TOTEM", customerId: cliente?.id ?? null, totemDeviceId,
          items: cart.map((i) => ({ productId: i.productId, variantId: i.variantId, quantidade: i.quantidade, selecoes: i.selecoes })),
          maiorIdadeConfirmada: maiorIdade || !precisaIdade,
          metodo: m as "PIX" | "CARTAO_CREDITO" | "CARTAO_DEBITO" | "DINHEIRO",
        });
        setSaleId(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao iniciar pagamento.");
        setMetodo(null);
      }
    });
  }

  // Modo B: envia a venda para a fila do PDV e o cliente paga no caixa.
  function pagarNoCaixa() {
    if (!siteId) { setError("Site não configurado."); return; }
    setError(null);
    startTransition(async () => {
      try {
        const id = await criarVendaTotemAction({
          siteId, origem: "TOTEM", customerId: cliente?.id ?? null, totemDeviceId,
          items: cart.map((i) => ({ productId: i.productId, variantId: i.variantId, quantidade: i.quantidade, selecoes: i.selecoes })),
          maiorIdadeConfirmada: maiorIdade || !precisaIdade,
          pagarNoCaixa: true,
        });
        setSaleId(id);
        setEtapa("enviado");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao enviar para o caixa.");
      }
    });
  }

  function confirmarPagamento() {
    if (!saleId) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await finalizarTotemAction(saleId);
        setResultado(r); setEtapa("confirmado");
      } catch (e) { setError(e instanceof Error ? e.message : "Erro ao confirmar pagamento."); }
    });
  }

  function reiniciar() {
    setCart([]); setCliente(null); setSaleId(null); setMetodo(null); setResultado(null);
    setCatAtiva(null); setMaiorIdade(false); setError(null); setEtapa("boas-vindas");
    router.refresh();
  }

  // ─────────────────────── TELAS ───────────────────────
  // Sem caixa aberto na loja, o terminal não inicia novas vendas.
  if (etapa === "boas-vindas" && !caixaAberto)
    return <TerminalIndisponivel tenantNome={tenantNome} terminalNome={terminalNome} />;

  if (etapa === "boas-vindas")
    return <BoasVindas tenantNome={tenantNome} tenantLogoUrl={tenantLogoUrl}
      onCpf={() => { setError(null); setEtapa("cpf"); }}
      onCadastro={() => { setError(null); setEtapa("cadastro"); }}
      onSemCadastro={() => { setCliente(null); setEtapa("compra"); }} />;

  if (etapa === "cpf")
    return <CpfStep pending={pending} error={error}
      onVoltar={() => setEtapa("boas-vindas")} onConfirmar={identificar}
      onCadastrar={() => { setError(null); setEtapa("cadastro"); }} />;

  if (etapa === "cadastro")
    return <CadastroStep pending={pending} error={error}
      onVoltar={() => setEtapa("boas-vindas")} onConfirmar={cadastrar} onEntrar={identificar}
      onPular={() => { setError(null); setCliente(null); setEtapa("compra"); }} />;

  if (etapa === "idade")
    return (
      <Centro>
        <span className="grid h-20 w-20 place-items-center rounded-full bg-warn-soft text-warn"><ShieldCheck size={44} /></span>
        <h2 className="font-display text-3xl font-bold text-ink">Confirmação de idade</h2>
        <p className="max-w-md text-lg text-muted">Sua compra tem bebida alcoólica. A venda é proibida para menores de 18 anos.</p>
        {error && <Erro>{error}</Erro>}
        <div className="flex w-full max-w-md flex-col gap-3">
          <BotaoGrande onClick={() => { setMaiorIdade(true); setMetodo(null); setSaleId(null); setEtapa("pagamento"); }}>
            Sou maior de 18 anos
          </BotaoGrande>
          <BotaoSecundario onClick={() => setEtapa("compra")}>Voltar</BotaoSecundario>
        </div>
      </Centro>
    );

  if (etapa === "pagamento")
    return <Pagamento total={total} metodosAtivos={metodosAtivos} metodo={metodo} saleId={saleId}
      pending={pending} error={error}
      onEscolher={iniciarPagamento} onConfirmar={confirmarPagamento} onPagarNoCaixa={pagarNoCaixa}
      onVoltar={() => (saleId ? (setMetodo(null), setSaleId(null)) : setEtapa("compra"))} />;

  if (etapa === "confirmado")
    return <Confirmado tenantNome={tenantNome} total={total} resultado={resultado}
      cliente={cliente} onNova={reiniciar} />;

  if (etapa === "enviado")
    return <EnviadoAoCaixa numero={saleId ? "#" + saleId.slice(-4).toUpperCase() : null}
      total={total} numItens={numItens} onNova={reiniciar} />;

  if (etapa === "revisao" && cart.length > 0)
    return (
      <Revisao cliente={cliente} cart={cart} setQtd={setQtd} total={total} numItens={numItens}
        sugestoes={sugestoes} add={add} pending={pending} error={error}
        onVoltar={() => setEtapa("compra")} onPagar={irPagar} />
    );

  // ── LOJA ── (revisão com carrinho vazio cai aqui de volta)
  return (
    <Loja
      produtos={disponiveis} byId={byId} maisVendidos={maisVendidos} cliente={cliente}
      catAtiva={catAtiva} setCatAtiva={setCatAtiva}
      cart={cart} add={add} setQtd={setQtd} total={total} numItens={numItens} sugestoes={sugestoes}
      pending={pending} error={error} onConcluir={() => setEtapa("revisao")} onCancelar={reiniciar}
    />
  );
}

/* ═══════════════════ BOAS-VINDAS ═══════════════════ */
function BoasVindas({ tenantNome, tenantLogoUrl, onCpf, onCadastro, onSemCadastro }: {
  tenantNome: string; tenantLogoUrl: string | null;
  onCpf: () => void; onCadastro: () => void; onSemCadastro: () => void;
}) {
  const inicial = tenantNome.trim().charAt(0).toUpperCase() || "N";
  return (
    <div className="relative min-h-[calc(100dvh-2rem)] overflow-hidden">
      {/* Fundo decorativo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-brand-soft to-transparent" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col items-center justify-center gap-10 p-4 text-center">
        {/* Identidade da loja */}
        <div className="flex flex-col items-center gap-4">
          {tenantLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenantLogoUrl} alt={tenantNome}
              className="h-44 w-44 rounded-3xl border border-line bg-surface object-contain p-3 shadow-[var(--shadow-1)]" />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-brand font-display text-3xl font-bold text-on-brand shadow-[var(--shadow-1)]">
              {inicial}
            </span>
          )}
          <div>
            <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">Bem-vindo à {tenantNome}</h1>
            <p className="mt-3 text-xl text-muted">Toque em uma opção para começar</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-4">
          {/* Já sou cliente — destaque */}
          <button onClick={onCpf}
            className="group flex items-center gap-5 rounded-3xl bg-brand p-6 text-left text-on-brand shadow-[var(--shadow-2)] transition-transform motion-safe:hover:-translate-y-0.5 active:scale-[0.99]">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-on-brand/15"><User size={34} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-2xl font-bold">Já sou cliente</span>
              <span className="mt-1 block text-base opacity-90">Digite seu CPF e ganhe pontos, veja seus favoritos e ofertas.</span>
            </span>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-on-brand/15 transition-transform motion-safe:group-hover:translate-x-1">
              <ArrowRight size={26} />
            </span>
          </button>

          <div className="grid gap-4 sm:grid-cols-2">
            <button onClick={onCadastro}
              className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-5 text-left transition-all hover:border-brand hover:shadow-[var(--shadow-1)] active:scale-[0.99]">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><UserPlus size={28} /></span>
              <span>
                <span className="block font-display text-lg font-bold text-ink">Criar cadastro</span>
                <span className="mt-1 flex flex-col gap-0.5 text-sm text-muted">
                  <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-ok" /> Apenas nome</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-ok" /> CPF</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-ok" /> Telefone</span>
                </span>
              </span>
            </button>

            <button onClick={onSemCadastro}
              className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-5 text-left transition-all hover:border-brand hover:shadow-[var(--shadow-1)] active:scale-[0.99]">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><ShoppingCart size={28} /></span>
              <span>
                <span className="block font-display text-lg font-bold text-ink">Comprar sem cadastro</span>
                <span className="mt-0.5 block text-sm text-muted">Ir direto para os produtos</span>
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ═══════════════════ CPF ═══════════════════ */
function CpfStep({ pending, error, onVoltar, onConfirmar, onCadastrar }: {
  pending: boolean; error: string | null; onVoltar: () => void;
  onConfirmar: (cpf: string) => void; onCadastrar: () => void;
}) {
  const [cpf, setCpf] = useState("");
  const completo = cpf.length === 11;
  return (
    <Centro>
      <div>
        <h2 className="font-display text-3xl font-bold text-ink">Informe seu CPF</h2>
        <p className="mt-2 text-lg text-muted">
          Ou toque em <button onClick={onCadastrar} className="font-semibold text-brand underline underline-offset-4">Não tenho cadastro</button>
        </p>
      </div>
      {/* Display progressivo: dígitos preenchidos + • para os que faltam */}
      <div className={cn(
        "w-full max-w-md rounded-2xl border-2 bg-surface p-5 text-center font-mono text-3xl font-bold tabular-nums tracking-widest transition-colors",
        completo ? "border-ok text-ink" : "border-line",
      )} aria-label="CPF digitado" aria-live="polite">
        {displayCpf(cpf)}
      </div>
      {error && <Erro>{error}</Erro>}
      <Teclado onDigito={(d) => setCpf((p) => (p.length >= 11 ? p : p + d))}
        onApagar={() => setCpf((p) => p.slice(0, -1))}
        onLimpar={() => setCpf("")} />
      <div className="flex w-full max-w-md flex-col gap-3">
        <BotaoGrande disabled={!completo || pending} onClick={() => onConfirmar(cpf)}>
          {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continuar
        </BotaoGrande>
        <div className="flex gap-3">
          <BotaoSecundario onClick={onVoltar} className="flex-1"><ArrowLeft size={18} /> Voltar</BotaoSecundario>
          <BotaoSecundario onClick={onCadastrar} className="flex-1">Não tenho cadastro</BotaoSecundario>
        </div>
      </div>
    </Centro>
  );
}

/** "123 4•• ••• ••" — dígitos digitados + marcadores dos que faltam (3-3-3-2). */
function displayCpf(d: string): React.ReactNode {
  const grupos = [3, 3, 3, 2];
  const partes: React.ReactNode[] = [];
  let idx = 0;
  for (const [gi, g] of grupos.entries()) {
    let parte = "";
    for (let i = 0; i < g; i++) { parte += idx < d.length ? d[idx] : "•"; idx++; }
    partes.push(
      <span key={gi} className={cn(parte.includes("•") && !/\d/.test(parte) ? "text-faint" : "text-ink")}>
        {parte}
      </span>,
    );
  }
  return <span className="inline-flex gap-2.5">{partes}</span>;
}

/* ═══════════════════ CADASTRO (wizard: 1 campo por tela) ═══════════════════ */
function CadastroStep({ pending, error, onVoltar, onConfirmar, onEntrar, onPular }: {
  pending: boolean; error: string | null; onVoltar: () => void;
  onConfirmar: (nome: string, cpf: string, telefone: string) => void;
  onEntrar: (cpf: string) => void;
  onPular: () => void;
}) {
  const [passo, setPasso] = useState(0); // 0 nome · 1 cpf · 2 telefone
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [tel, setTel] = useState("");
  // Duplicidade (CPF/telefone já cadastrados) — checada no servidor ao avançar.
  const [dupe, setDupe] = useState<"cpf" | "tel" | null>(null);
  const [erroDupe, setErroDupe] = useState<string | null>(null);
  const [checando, startChecar] = useTransition();

  const nomeOk = nome.trim().length >= 2;
  const cpfCompleto = cpf.length === 11;
  const cpfValido = cpfCompleto && validaCpf(cpf);
  const telOk = tel.length >= 10;

  const podeAvancar = passo === 0 ? nomeOk : passo === 1 ? cpfValido : telOk;
  const ultimo = passo === 2;
  const ocupado = pending || checando;

  function limparDupe() { setDupe(null); setErroDupe(null); }

  function avancar() {
    if (!podeAvancar || ocupado) return;
    if (passo === 0) { setPasso(1); return; }
    // CPF e telefone: confere no servidor se já existem antes de seguir.
    startChecar(async () => {
      try {
        if (passo === 1) {
          const { cpfEmUso } = await cadastroDisponivelAction({ cpf });
          if (cpfEmUso) { setDupe("cpf"); setErroDupe("Este CPF já tem cadastro."); return; }
          setPasso(2);
        } else {
          const { telefoneEmUso } = await cadastroDisponivelAction({ telefone: tel });
          if (telefoneEmUso) { setDupe("tel"); setErroDupe("Este telefone já está em outra conta. Confira o número."); return; }
          onConfirmar(nome.trim(), cpf, tel);
        }
      } catch { setErroDupe("Não foi possível verificar. Tente novamente."); }
    });
  }
  function voltar() {
    limparDupe();
    if (passo === 0) onVoltar();
    else setPasso((p) => p - 1);
  }
  // Teclado ABC monta o nome em Title Case (primeira letra de cada palavra maiúscula).
  function letra(l: string) {
    setNome((p) => {
      const prox = p === "" || p.endsWith(" ") ? l.toUpperCase() : l.toLowerCase();
      return (p + prox).slice(0, 60);
    });
  }

  const titulos = [
    { titulo: "Qual é o seu nome?", hint: "Ex.: João da Silva" },
    { titulo: "Agora informe seu CPF", hint: "000.000.000-00" },
    { titulo: "Para terminar, seu telefone", hint: "(00) 00000-0000" },
  ][passo];

  return (
    <Centro className="max-w-3xl">
      {/* Progresso */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className={cn(
                "grid h-3 w-3 rounded-full transition-colors",
                i < passo ? "bg-ok" : i === passo ? "bg-brand" : "bg-surface-2 border border-line",
              )} />
              {i < 2 && <span className={cn("h-0.5 w-8 rounded-full", i < passo ? "bg-ok" : "bg-line")} />}
            </span>
          ))}
        </div>
        <p className="text-sm font-medium text-muted">Passo {passo + 1} de 3 · Cadastro rápido</p>
      </div>

      <h2 className="font-display text-3xl font-bold text-ink">{titulos.titulo}</h2>
      {(error || erroDupe) && <Erro>{error ?? erroDupe}</Erro>}
      {dupe === "cpf" && (
        <BotaoGrande disabled={ocupado} onClick={() => onEntrar(cpf)} className="max-w-md">
          {pending ? <Loader2 className="animate-spin" /> : <User />} Entrar com este CPF
        </BotaoGrande>
      )}

      {/* Campo ativo — único da tela */}
      {passo === 0 && (
        <div className={cn(
          "w-full max-w-md rounded-2xl border-2 bg-surface px-5 py-5 text-center font-display text-2xl font-bold transition-colors",
          nomeOk ? "border-ok text-ink" : "border-brand",
          nome ? "text-ink" : "text-faint",
        )} aria-live="polite">
          {nome || titulos.hint}
          <span className="ml-0.5 inline-block h-6 w-0.5 animate-pulse bg-brand align-middle" aria-hidden />
        </div>
      )}
      {passo === 1 && (
        <div className={cn(
          "w-full max-w-md rounded-2xl border-2 bg-surface p-5 text-center font-mono text-3xl font-bold tabular-nums tracking-widest transition-colors",
          cpfValido ? "border-ok" : "border-brand",
        )} aria-live="polite">
          {displayCpf(cpf)}
        </div>
      )}
      {passo === 2 && (
        <div className={cn(
          "w-full max-w-md rounded-2xl border-2 bg-surface p-5 text-center font-mono text-3xl font-bold tabular-nums tracking-wide transition-colors",
          telOk ? "border-ok text-ink" : "border-brand",
          tel ? "text-ink" : "text-faint",
        )} aria-live="polite">
          {fmtTel(tel) || titulos.hint}
        </div>
      )}

      {/* Validação imediata, sem popup */}
      {passo === 1 && cpfCompleto && (
        <p className={cn("flex items-center gap-1.5 text-base font-semibold", cpfValido ? "text-ok" : "text-danger")}>
          {cpfValido ? <><CheckCircle2 size={18} /> CPF válido</> : <><X size={18} /> CPF inválido — confira os números</>}
        </p>
      )}

      {/* Teclado contextual — mesma posição, muda conforme o campo */}
      {passo === 0 ? (
        <TecladoABC onLetra={letra}
          onEspaco={() => setNome((p) => (p && !p.endsWith(" ") ? p + " " : p))}
          onApagar={() => setNome((p) => p.slice(0, -1))}
          onLimpar={() => setNome("")} />
      ) : (
        <Teclado
          onDigito={(d) => {
            limparDupe();
            const set = passo === 1 ? setCpf : setTel;
            set((p) => (p.length >= 11 ? p : p + d));
          }}
          onApagar={() => { limparDupe(); (passo === 1 ? setCpf : setTel)((p) => p.slice(0, -1)); }}
          onLimpar={() => { limparDupe(); (passo === 1 ? setCpf : setTel)(""); }} />
      )}

      <div className="flex w-full max-w-md flex-col gap-3">
        <BotaoGrande disabled={!podeAvancar || ocupado} onClick={avancar}>
          {ocupado ? <Loader2 className="animate-spin" /> : ultimo ? <CheckCircle2 /> : <ArrowRight />}
          {ultimo ? "Criar cadastro" : "Continuar"}
        </BotaoGrande>
        <div className="flex gap-3">
          <BotaoSecundario onClick={voltar} className="flex-1"><ArrowLeft size={18} /> Voltar</BotaoSecundario>
          <BotaoSecundario onClick={onPular} className="flex-1">Pular cadastro</BotaoSecundario>
        </div>
      </div>
    </Centro>
  );
}

/* Teclado alfabético touch — teclas grandes, layout QWERTY, Title Case automático. */
function TecladoABC({ onLetra, onEspaco, onApagar, onLimpar }: {
  onLetra: (l: string) => void; onEspaco: () => void; onApagar: () => void; onLimpar: () => void;
}) {
  const linhas = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"],
  ];
  const tecla = "h-20 flex-1 rounded-2xl border border-line bg-surface font-display text-3xl font-bold text-ink transition-colors hover:bg-brand-soft active:scale-95 active:bg-brand-soft";
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2.5">
      {linhas.map((linha, i) => (
        <div key={i} className={cn("flex gap-2.5", i === 1 && "px-[5%]", i === 2 && "px-[10%]")}>
          {linha.map((l) => (
            <button key={l} onClick={() => onLetra(l)} className={tecla}>{l}</button>
          ))}
        </div>
      ))}
      <div className="flex gap-2.5">
        <button onClick={onLimpar}
          className="h-20 w-36 shrink-0 rounded-2xl border border-line bg-surface text-lg font-semibold text-muted transition-colors hover:bg-danger-soft hover:text-danger active:scale-95">
          Limpar
        </button>
        <button onClick={onEspaco} aria-label="Espaço"
          className="h-20 flex-1 rounded-2xl border border-line bg-surface text-lg font-semibold text-muted transition-colors hover:bg-brand-soft active:scale-[0.98]">
          Espaço
        </button>
        <button onClick={onApagar} aria-label="Apagar uma letra"
          className="grid h-20 w-36 shrink-0 place-items-center rounded-2xl border border-line bg-surface text-ink transition-colors hover:bg-surface-2 active:scale-95">
          <Delete size={30} />
        </button>
      </div>
    </div>
  );
}

/** Validação de CPF pelos dígitos verificadores. */
function validaCpf(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10] as const) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

/* ═══════════════════ LOJA ═══════════════════ */
type AddFn = (p: ProdutoVenda, opts?: { selecoes?: string[]; precoExtra?: number; detalhe?: string }) => void;

function Loja({
  produtos, byId, maisVendidos, cliente, catAtiva, setCatAtiva,
  cart, add, setQtd, total, numItens, sugestoes, pending, error, onConcluir, onCancelar,
}: {
  produtos: ProdutoVenda[]; byId: Map<string, ProdutoVenda>; maisVendidos: string[];
  cliente: PerfilTotem | null;
  catAtiva: string | null; setCatAtiva: (v: string | null) => void;
  cart: CartItem[]; add: AddFn; setQtd: (k: string, q: number) => void;
  total: number; numItens: number; sugestoes: ProdutoVenda[]; pending: boolean; error: string | null;
  onConcluir: () => void; onCancelar: () => void;
}) {
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [personalizando, setPersonalizando] = useState<ProdutoVenda | null>(null);
  const qtdNoCarrinho = (id: string) => cart.filter((i) => i.productId === id).reduce((s, i) => s + i.quantidade, 0);

  // Toque no card: personalizado abre o modal de montagem; o resto adiciona direto.
  function pick(p: ProdutoVenda) {
    if (p.tipo === "PERSONALIZADO" && p.groups?.length) { setPersonalizando(p); return; }
    add(p);
  }

  // Categorias com contagem.
  const categorias = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of produtos) { const c = p.categoria ?? "Outros"; m.set(c, (m.get(c) ?? 0) + 1); }
    return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n);
  }, [produtos]);

  const daCategoria = useMemo(
    () => (catAtiva ? produtos.filter((p) => (p.categoria ?? "Outros") === catAtiva) : []),
    [catAtiva, produtos],
  );

  // Destaques (primeiro item do menu lateral): favoritos/última compra/mais vendidos.
  const destaques = useMemo(() => {
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean) as ProdutoVenda[];
    if (cliente) {
      const favSet = new Set([...cliente.favoritos, ...cliente.comprarNovamente]);
      return [
        { titulo: "Seus favoritos", icone: <Star size={17} />, itens: pick(cliente.favoritos).slice(0, 10) },
        { titulo: "Comprar novamente", icone: <RotateCcw size={17} />, itens: pick(cliente.comprarNovamente).slice(0, 10) },
        { titulo: "Recomendados para você", icone: <Sparkles size={17} />, itens: pick(maisVendidos).filter((p) => !favSet.has(p.id)).slice(0, 10) },
      ].filter((s) => s.itens.length > 0);
    }
    const top = pick(maisVendidos).slice(0, 10);
    return top.length ? [{ titulo: "Mais vendidos", icone: <Flame size={17} />, itens: top }] : [];
  }, [cliente, maisVendidos, byId]);
  const temDestaques = destaques.length > 0;

  return (
    <div className="flex h-[calc(100dvh-2rem)] gap-3">
      {/* ── Menu lateral fixo de categorias ── */}
      <nav aria-label="Categorias"
        className="scrollbar-none flex w-24 shrink-0 flex-col gap-1 overflow-y-auto rounded-3xl border border-line bg-surface p-1.5 sm:w-28">
        <RailItem ativo={catAtiva == null} onClick={() => setCatAtiva(null)}
          icone={temDestaques ? <Star size={24} /> : <ShoppingCart size={24} />}
          label={temDestaques ? (cliente ? "Para você" : "Destaques") : "Todos"} />
        {categorias.map((c) => (
          <RailItem key={c.nome} ativo={catAtiva === c.nome}
            onClick={() => setCatAtiva(c.nome)}
            icone={<CatIcon nome={c.nome} size={24} />} label={c.nome} />
        ))}
      </nav>

      {/* ── Coluna principal ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Cabeçalho: saudação + pontos + cancelar */}
        <div className="flex items-center justify-between gap-3">
          <span className="truncate font-display text-lg font-bold text-ink">
            {cliente ? `Olá, ${cliente.primeiroNome} 👋` : "Escolha seus produtos"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {cliente && (
              <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-4 py-2 text-sm font-bold text-brand">
                <Award size={16} /> {cliente.pontos} pts
              </span>
            )}
            <button onClick={() => setCancelando(true)}
              className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-danger-soft hover:text-danger">
              <X size={16} /> Cancelar compra
            </button>
          </div>
        </div>

        {/* Conteúdo rolável — vertical apenas; horizontal é por fileira */}
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
          {catAtiva ? (
            <>
              <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-ink">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand"><CatIcon nome={catAtiva} size={18} /></span>
                {catAtiva}
              </h2>
              {daCategoria.length ? <Grade produtos={daCategoria} onPick={pick} qtd={qtdNoCarrinho} />
                : <Vazio texto="Sem produtos nesta categoria." />}
            </>
          ) : temDestaques ? (
            <div className="flex flex-col gap-6">
              {destaques.map((s) => (
                <section key={s.titulo}>
                  <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-ink">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">{s.icone}</span>
                    {s.titulo}
                  </h2>
                  <Fileira produtos={s.itens} onPick={pick} qtd={qtdNoCarrinho} />
                </section>
              ))}
            </div>
          ) : (
            <Grade produtos={produtos} onPick={pick} qtd={qtdNoCarrinho} />
          )}
        </div>

        {error && <Erro>{error}</Erro>}

        {/* ── Barra do pedido ── */}
        <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-3">
          <button onClick={() => numItens > 0 && setCarrinhoAberto(true)} disabled={numItens === 0}
            aria-label="Ver carrinho"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-surface-2 disabled:pointer-events-none">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 text-ink">
              <ShoppingCart size={24} />
              {numItens > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1 text-xs font-bold text-on-brand">{numItens}</span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-muted">
                {numItens === 0 ? "Toque nos produtos para adicionar" : `${numItens} ${numItens === 1 ? "item" : "itens"} · ver carrinho`}
              </span>
              <span className="block font-display text-2xl font-bold tabular-nums leading-tight text-ink">{brl(total)}</span>
            </span>
          </button>
          <BotaoGrande disabled={numItens === 0 || pending} onClick={onConcluir}
            className="w-auto shrink-0 px-8 py-4 text-lg">
            Concluir pedido <ArrowRight size={20} />
          </BotaoGrande>
        </div>
      </div>

      {/* ── Carrinho (drawer) ── */}
      {carrinhoAberto && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setCarrinhoAberto(false)}>
          <div className="mx-auto flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-bg p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-xl font-bold text-ink">Seu pedido</span>
              <button onClick={() => setCarrinhoAberto(false)} aria-label="Fechar"
                className="grid h-10 w-10 place-items-center rounded-full text-faint hover:bg-surface-2"><X size={22} /></button>
            </div>
            <CarrinhoPanel cliente={cliente} cart={cart} setQtd={setQtd} total={total} numItens={numItens}
              sugestoes={sugestoes} add={add} pending={pending} error={error}
              acaoLabel="Continuar" onAcao={() => { setCarrinhoAberto(false); onConcluir(); }} />
          </div>
        </div>
      )}

      {/* ── Modal: montar bebida personalizada ── */}
      {personalizando && (
        <PersonalizarModal
          p={personalizando}
          onFechar={() => setPersonalizando(null)}
          onConfirmar={(selecoes, precoExtra, detalhe) => {
            add(personalizando, { selecoes, precoExtra, detalhe });
            setPersonalizando(null);
          }}
        />
      )}

      {/* ── Confirmação de cancelamento ── */}
      {cancelando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-surface p-6 text-center shadow-[var(--shadow-2)]">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-danger-soft text-danger"><Trash2 size={30} /></span>
            <div>
              <h3 className="font-display text-xl font-bold text-ink">Cancelar a compra?</h3>
              <p className="mt-1 text-muted">Todos os itens do carrinho serão removidos.</p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <button onClick={onCancelar}
                className="w-full rounded-2xl bg-danger px-6 py-4 text-lg font-bold text-white transition-opacity hover:opacity-90">
                Sim, cancelar
              </button>
              <BotaoSecundario onClick={() => setCancelando(false)}>Continuar comprando</BotaoSecundario>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Fileira horizontal de cards — o scroll lateral é da fileira, sem barra visível. */
function Fileira({ produtos, onPick, qtd }: { produtos: ProdutoVenda[]; onPick: (p: ProdutoVenda) => void; qtd: (id: string) => number }) {
  return (
    <div className="scrollbar-none -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {produtos.map((p) => (
        <div key={p.id} className={cn("shrink-0", CARD_W)}>
          <Card p={p} onPick={onPick} noCarrinho={qtd(p.id)} />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ MONTAR BEBIDA (PERSONALIZADO) ═══════════════════
   Configurador em duas áreas: produto à esquerda (limpo, só identidade) e
   montagem passo a passo à direita, em acordeão — uma etapa aberta por vez.
   Concluiu a etapa → colapsa com check, abre a próxima sozinha. Ao terminar
   tudo, aparece o resumo final. Destaque só em laranja (brand); sem verde. */
function PersonalizarModal({ p, onFechar, onConfirmar }: {
  p: ProdutoVenda;
  onFechar: () => void;
  onConfirmar: (selecoes: string[], precoExtra: number, detalhe: string) => void;
}) {
  const groups = p.groups ?? [];
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [aberto, setAberto] = useState<string | null>(groups[0]?.id ?? null);
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map());
  const resumoRef = useRef<HTMLDivElement | null>(null);

  /** Abre uma etapa (ou o resumo, se null) e rola até ela. */
  function irPara(id: string | null) {
    setAberto(id);
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => {
      const alvo = id ? groupRefs.current.get(id) : resumoRef.current;
      alvo?.scrollIntoView({ behavior: reduz ? "auto" : "smooth", block: "start" });
    }, 220);
  }

  /** Próxima etapa vazia depois desta; senão, obrigatória pendente; senão, resumo. */
  function avancarDe(gId: string, s: Record<string, string[]>) {
    const idx = groups.findIndex((x) => x.id === gId);
    const depois = groups.slice(idx + 1).find((x) => (s[x.id] ?? []).length === 0);
    const pendente = groups.find((x) => x.obrigatoria && x.id !== gId && (s[x.id] ?? []).length === 0);
    irPara(depois?.id ?? pendente?.id ?? null);
  }

  function toggle(g: ComponentGroupVenda, id: string) {
    const cur = sel[g.id] ?? [];
    let novo: Record<string, string[]>;
    if (g.tipoSelecao === "UNICA") novo = { ...sel, [g.id]: cur[0] === id ? [] : [id] };
    else if (cur.includes(id)) novo = { ...sel, [g.id]: cur.filter((x) => x !== id) };
    else if (g.maxSelecoes != null && cur.length >= g.maxSelecoes) return; // limite atingido
    else novo = { ...sel, [g.id]: [...cur, id] };
    setSel(novo);

    // Escolha única feita ou limite alcançado → fecha e abre a próxima etapa.
    const feitos = novo[g.id]?.length ?? 0;
    const concluiu = g.tipoSelecao === "UNICA" ? feitos === 1
      : g.maxSelecoes != null && feitos >= g.maxSelecoes;
    if (concluiu) avancarDe(g.id, novo);
  }

  const escolhidosDe = (g: ComponentGroupVenda) =>
    (sel[g.id] ?? []).map((id) => g.items.find((i) => i.componentProductId === id)).filter(Boolean) as ComponentGroupVenda["items"];

  const escolhidos = groups.flatMap(escolhidosDe);
  const precoExtra = escolhidos.reduce((s, i) => s + (i.acrescimoPreco ?? 0), 0);
  const totalUnit = precoBase(p) + precoExtra;
  const detalhe = escolhidos.map((i) => i.nome).join(", ");

  const pendentes = groups.filter((g) => g.obrigatoria && (sel[g.id] ?? []).length === 0);
  const valido = pendentes.length === 0;

  // Imagem principal acompanha a montagem quando o produto não tem foto própria.
  const imgPrincipal = p.imagemUrl ?? [...escolhidos].reverse().find((i) => i.imagemUrl)?.imagemUrl ?? null;
  const vol = volumeBase(p);

  const subtitulo = (g: ComponentGroupVenda) =>
    g.tipoSelecao === "UNICA"
      ? (g.obrigatoria ? "Escolha 1 opção" : "Opcional — escolha 1 se quiser")
      : g.maxSelecoes != null
        ? `${g.obrigatoria ? "Escolha" : "Opcional — escolha"} até ${g.maxSelecoes} opções`
        : `${g.obrigatoria ? "Escolha" : "Opcional — escolha"} quantas quiser`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-4 lg:p-8"
      role="dialog" aria-modal="true" aria-label={`Montar ${p.nome}`} onClick={onFechar}>
      <div
        className="flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-bg shadow-[var(--shadow-2)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
        onClick={(e) => e.stopPropagation()}>

        {/* Cabeçalho compacto — só quando a coluna do produto não cabe */}
        <div className="flex items-center gap-3 border-b border-line p-3 lg:hidden">
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2">
            {imgPrincipal ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgPrincipal} alt="" className="h-full w-full object-contain p-1" />
            ) : <CatIcon nome={p.categoria} size={26} className="text-faint" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-xl font-bold text-ink">{p.nome}</h3>
            <p className="text-sm text-muted">{vol && `${vol} · `}A partir de {brl(precoBase(p))}</p>
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 active:scale-95">
            <X size={24} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── Produto: só identidade, sem resumo ── */}
          <aside className="hidden w-[35%] max-w-md shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface p-6 lg:flex">
            <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-surface-2">
              {imgPrincipal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={imgPrincipal} src={imgPrincipal} alt={p.nome}
                  className="absolute inset-0 h-full w-full object-contain p-5 motion-safe:animate-in motion-safe:fade-in" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-faint"><CatIcon nome={p.categoria} size={80} /></span>
              )}
              {p.restricaoIdade && (
                <span className="absolute left-3 top-3 rounded-lg bg-danger-soft px-2 py-1 text-xs font-bold text-danger">18+</span>
              )}
            </div>
            <div>
              {p.categoria && (
                <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">
                  <CatIcon nome={p.categoria} size={13} /> {p.categoria}
                </span>
              )}
              <h3 className="font-display text-3xl font-bold leading-tight text-ink">{p.nome}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted">
                Monte do seu jeito em {groups.length} {groups.length === 1 ? "passo" : "passos"}.
              </p>
              <div className="mt-4 flex items-baseline gap-2.5">
                <span className="font-display text-2xl font-bold tabular-nums text-ink">{brl(precoBase(p))}</span>
                {vol && <span className="font-mono text-sm text-muted">{vol}</span>}
              </div>
              <p className="mt-0.5 text-xs text-faint">Valor inicial — adicionais entram no total.</p>
            </div>
          </aside>

          {/* ── Montagem: acordeão de etapas ── */}
          <div className="scrollbar-none relative min-w-0 flex-1 overflow-y-auto">
            <button onClick={onFechar} aria-label="Fechar"
              className="absolute right-4 top-4 z-10 hidden h-12 w-12 shrink-0 place-items-center rounded-full border border-line bg-bg text-muted transition-colors hover:bg-surface-2 active:scale-95 lg:grid">
              <X size={24} />
            </button>

            <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4 pb-8 sm:p-6 lg:pr-20">
              {groups.map((g, gi) => {
                const atual = sel[g.id] ?? [];
                const feito = atual.length > 0;
                const aberta = aberto === g.id;
                const noLimite = g.tipoSelecao === "MULTIPLA" && g.maxSelecoes != null && atual.length >= g.maxSelecoes;
                const nomes = escolhidosDe(g).map((i) => i.nome).join(", ");

                // ── Etapa fechada: uma linha, tocável para abrir/alterar ──
                if (!aberta) {
                  return (
                    <button key={g.id} ref={(el) => { if (el) groupRefs.current.set(g.id, el); }}
                      onClick={() => irPara(g.id)}
                      className={cn(
                        "flex w-full scroll-mt-4 items-center gap-3.5 rounded-2xl border bg-surface p-4 text-left transition-all",
                        "hover:border-brand/50 hover:shadow-[var(--shadow-1)] active:scale-[0.99]",
                        feito ? "border-line" : "border-line opacity-70",
                      )}>
                      <span className={cn(
                        "grid h-11 w-11 shrink-0 place-items-center rounded-full font-display text-lg font-bold",
                        feito ? "bg-brand text-on-brand" : "border-2 border-line-strong bg-bg text-muted",
                      )}>
                        {feito ? <Check size={22} strokeWidth={3} className="motion-safe:animate-in motion-safe:zoom-in" /> : gi + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-muted">{g.nome}</span>
                        <span className={cn("block truncate font-semibold", feito ? "text-base text-ink" : "text-sm text-faint")}>
                          {feito ? nomes : subtitulo(g)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-bold text-brand">{feito ? "Alterar" : "Escolher"}</span>
                    </button>
                  );
                }

                // ── Etapa aberta: título + cards ──
                return (
                  <section key={g.id} ref={(el) => { if (el) groupRefs.current.set(g.id, el); }}
                    className="scroll-mt-4 rounded-3xl border-2 border-brand/30 bg-surface p-4 shadow-[var(--shadow-float)] sm:p-5 motion-safe:animate-in motion-safe:fade-in">
                    <div className="mb-4 flex items-center gap-3.5">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand font-display text-lg font-bold text-on-brand">
                        {gi + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-display text-xl font-bold text-ink sm:text-2xl">{g.nome}</h4>
                        <p className="text-sm font-medium text-muted">
                          {noLimite ? "Limite atingido — toque em uma opção marcada para trocar" : subtitulo(g)}
                        </p>
                      </div>
                      {g.tipoSelecao === "MULTIPLA" && g.maxSelecoes != null && (
                        <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 font-mono text-sm font-bold tabular-nums text-ink">
                          {atual.length}/{g.maxSelecoes}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
                      {g.items.map((item) => {
                        const marcado = atual.includes(item.componentProductId);
                        const bloqueado = !item.disponivel;
                        const extra = item.acrescimoPreco != null && item.acrescimoPreco > 0;
                        return (
                          <button key={item.componentProductId} disabled={bloqueado}
                            onClick={() => toggle(g, item.componentProductId)}
                            aria-pressed={marcado}
                            className={cn(
                              "group relative flex min-h-44 flex-col overflow-hidden rounded-2xl border-2 bg-bg text-left transition-all",
                              marcado
                                ? "border-brand bg-brand-soft/50 shadow-[var(--shadow-1)]"
                                : "border-line motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]",
                              "active:scale-[0.97] disabled:pointer-events-none",
                            )}>
                            {/* Foto grande */}
                            <span className="relative block h-28 w-full shrink-0 sm:h-32">
                              {item.imagemUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.imagemUrl} alt=""
                                  className={cn("absolute inset-0 h-full w-full object-contain p-2.5", bloqueado && "grayscale opacity-40")}
                                  loading="lazy" />
                              ) : (
                                <span className={cn("absolute inset-0 grid place-items-center text-faint", bloqueado && "opacity-40")}>
                                  <CatIcon nome={p.categoria} size={40} />
                                </span>
                              )}
                              {marcado && (
                                <span className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-brand text-on-brand motion-safe:animate-in motion-safe:zoom-in">
                                  <Check size={16} strokeWidth={3} />
                                </span>
                              )}
                              {bloqueado ? (
                                <span className="absolute left-2.5 top-2.5 rounded-md border border-line bg-bg/90 px-2 py-0.5 text-[11px] font-semibold text-muted">
                                  Indisponível
                                </span>
                              ) : item.isDefault && !marcado ? (
                                <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-md border border-line bg-bg/90 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                                  <Star size={11} className="fill-accent text-accent" /> Popular
                                </span>
                              ) : null}
                            </span>
                            {/* Nome + valor */}
                            <span className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 px-3.5 pb-3.5 pt-1">
                              <span className={cn("line-clamp-2 text-base font-semibold leading-snug", bloqueado ? "text-muted" : "text-ink")}>
                                {item.nome}
                              </span>
                              <span className={cn("font-mono text-sm", extra ? "font-bold text-accent" : "text-muted")}>
                                {extra ? `+${brl(item.acrescimoPreco!)}` : "Incluído"}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Etapas sem fechamento automático ganham saída explícita */}
                    {(g.tipoSelecao === "MULTIPLA" && !noLimite && atual.length > 0) || (!g.obrigatoria && atual.length === 0) ? (
                      <button onClick={() => avancarDe(g.id, sel)}
                        className="mt-4 flex h-12 items-center gap-2 rounded-full border border-line px-6 text-base font-semibold text-ink transition-colors hover:border-brand hover:text-brand active:scale-95">
                        {atual.length > 0 ? "Continuar" : "Pular esta etapa"} <ArrowRight size={18} />
                      </button>
                    ) : null}
                  </section>
                );
              })}

              {/* ── Resumo final: só quando tudo estiver escolhido ── */}
              {valido && aberto === null && (
                <div ref={resumoRef}
                  className="scroll-mt-4 rounded-3xl border-2 border-brand bg-brand-soft/50 p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3">
                  <p className="flex items-center gap-2 font-display text-xl font-bold text-ink">
                    <CheckCircle2 size={24} className="text-brand" /> Tudo pronto!
                  </p>
                  <p className="mt-0.5 text-sm text-muted">Confira sua montagem e adicione ao carrinho.</p>
                  <div className="mt-4 flex flex-col gap-2">
                    {groups.map((g) => {
                      const itens = escolhidosDe(g);
                      if (itens.length === 0) return null;
                      return (
                        <div key={g.id} className="flex items-baseline justify-between gap-3">
                          <span className="shrink-0 text-sm text-muted">{g.nome}</span>
                          <span className="min-w-0 truncate text-right text-base font-semibold text-ink">
                            {itens.map((i) => i.nome).join(", ")}
                          </span>
                        </div>
                      );
                    })}
                    <div className="mt-1 flex items-baseline justify-between border-t border-brand/20 pt-2.5">
                      <span className="font-semibold text-ink">Total</span>
                      <span className="font-display text-2xl font-bold tabular-nums text-accent">{brl(totalUnit)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Rodapé fixo: preço vivo + ação única ── */}
        <div className="flex items-center gap-4 border-t border-line bg-surface p-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm text-muted">Total do item</p>
            <p key={totalUnit}
              className="font-display text-2xl font-bold tabular-nums text-accent motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
              {brl(totalUnit)}
            </p>
          </div>
          <button disabled={!valido}
            onClick={() => onConfirmar(escolhidos.map((i) => i.componentProductId), precoExtra, detalhe)}
            className={cn(
              "ml-auto flex h-16 shrink-0 items-center justify-center gap-3 rounded-2xl px-6 font-display text-lg font-bold transition-all sm:px-10 sm:text-xl",
              valido
                ? "bg-brand text-on-brand shadow-[var(--shadow-2)] hover:bg-brand-strong active:scale-[0.98]"
                : "cursor-not-allowed bg-surface-2 text-muted",
            )}>
            {valido ? (
              <><Plus size={24} strokeWidth={2.5} /> Adicionar ao carrinho
                <span className="rounded-xl bg-on-brand/15 px-3 py-1 tabular-nums">{brl(totalUnit)}</span></>
            ) : (
              <>{pendentes.length === 1 ? `Escolha: ${pendentes[0].nome}` : `Faltam ${pendentes.length} escolhas`}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Item do menu lateral: ícone grande + rótulo curto, alvo de toque generoso. */
function RailItem({ ativo, onClick, icone, label }: {
  ativo: boolean; onClick: () => void; icone: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick} aria-current={ativo || undefined}
      className={cn(
        "flex w-full flex-col items-center gap-1.5 rounded-2xl px-1 py-3 transition-colors active:scale-95",
        ativo ? "bg-brand text-on-brand" : "text-ink-2 hover:bg-surface-2",
      )}>
      {icone}
      <span className="line-clamp-2 w-full text-center text-[11px] font-semibold leading-tight">{label}</span>
    </button>
  );
}

/* ═══════════════════ CARD / GRADE ═══════════════════ */
/** Largura única do card em TODAS as telas (grade e fileiras). */
const CARD_W = "w-40";

function Grade({ produtos, onPick, qtd }: { produtos: ProdutoVenda[]; onPick: (p: ProdutoVenda) => void; qtd: (id: string) => number }) {
  return (
    <div className="flex flex-wrap gap-3">
      {produtos.map((p) => (
        <div key={p.id} className={cn("shrink-0", CARD_W)}>
          <Card p={p} onPick={onPick} noCarrinho={qtd(p.id)} />
        </div>
      ))}
    </div>
  );
}

/* Card uniforme: quadro de imagem FIXO (a foto se adapta ao quadro, nunca o
   contrário) + nome (2 linhas fixas) + volume + preço + botão +. */
function Card({ p, onPick, noCarrinho }: { p: ProdutoVenda; onPick: (p: ProdutoVenda) => void; noCarrinho: number }) {
  const vol = volumeBase(p);
  const personalizavel = p.tipo === "PERSONALIZADO" && (p.groups?.length ?? 0) > 0;
  const [flash, setFlash] = useState(false);

  function toque() {
    onPick(p);
    if (!personalizavel) {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    }
  }

  return (
    <button onClick={toque}
      className={cn(
        "group relative flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left transition-all",
        "hover:border-brand hover:shadow-[var(--shadow-1)]",
        "active:scale-[0.97]",
      )}>
      {/* Quadro de imagem: aspecto fixo; a foto preenche por dentro (contain) */}
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-surface-2">
        {p.imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imagemUrl} alt={p.nome}
            className="absolute inset-0 h-full w-full object-contain p-3" loading="lazy" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-faint"><CatIcon nome={p.categoria} size={44} /></span>
        )}
        {p.restricaoIdade && (
          <span className="absolute left-2 top-2 rounded-md bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger">18+</span>
        )}
        {noCarrinho > 0 && (
          <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-brand px-1.5 text-sm font-bold text-on-brand">{noCarrinho}</span>
        )}
        {personalizavel && (
          <span className="absolute bottom-2 left-2 rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand">Monte a sua</span>
        )}
        {/* Feedback de adição: 800ms, sem popup */}
        {flash && (
          <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-surface/90 motion-safe:animate-in motion-safe:fade-in">
            <CheckCircle2 size={36} className="text-ok" />
            <span className="text-sm font-bold text-ok">Adicionado</span>
          </span>
        )}
      </div>
      {/* Info — alturas fixas para grade uniforme */}
      <div className="flex w-full flex-col gap-0.5 p-2.5">
        <span className="line-clamp-2 min-h-9 text-sm font-semibold leading-tight text-ink">{p.nome}</span>
        <span className="min-h-4 font-mono text-xs text-muted">{vol}</span>
        <div className="flex items-center justify-between pt-1">
          <span className="font-display text-lg font-bold tabular-nums text-ink">{brl(precoBase(p))}</span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-on-brand transition-transform motion-safe:group-hover:scale-110 group-active:scale-95">
            <Plus size={18} strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </button>
  );
}

/* ═══════════════════ CARRINHO ═══════════════════ */
function CarrinhoPanel({
  cliente, cart, setQtd, total, numItens, sugestoes, add, pending, error, acaoLabel, onAcao,
}: {
  cliente: PerfilTotem | null; cart: CartItem[]; setQtd: (k: string, q: number) => void;
  total: number; numItens: number; sugestoes: ProdutoVenda[]; add: AddFn;
  pending: boolean; error: string | null; acaoLabel: string; onAcao: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted">
            <ShoppingCart size={40} className="text-faint" />
            <p>Toque nos produtos para adicionar.</p>
          </div>
        ) : cart.map((i) => (
          <div key={i.key} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2">
            <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2">
              {i.imagemUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.imagemUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon size={20} className="text-faint" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{i.nome}{i.variantNome && ` · ${i.variantNome}`}</p>
              {i.detalhe && <p className="truncate text-xs text-muted">{i.detalhe}</p>}
              <p className="font-mono text-xs text-muted">{brl(i.preco)}{i.volume && ` · ${i.volume}`}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => setQtd(i.key, i.quantidade - 1)} aria-label="Diminuir"
                className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink active:scale-95">
                {i.quantidade === 1 ? <Trash2 size={16} className="text-danger" /> : <Minus size={16} />}
              </button>
              <span className="w-6 text-center font-mono text-base font-bold tabular-nums">{i.quantidade}</span>
              <button onClick={() => setQtd(i.key, i.quantidade + 1)} aria-label="Aumentar"
                className="grid h-9 w-9 place-items-center rounded-full bg-brand text-on-brand active:scale-95">
                <Plus size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Venda sugestiva */}
      {sugestoes.length > 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><Sparkles size={15} className="text-accent" /> Combina com</p>
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {sugestoes.map((p) => (
              <button key={p.id} onClick={() => add(p)}
                className="flex w-24 shrink-0 flex-col rounded-xl border border-line bg-surface p-2 text-left transition-transform active:scale-95">
                <span className="line-clamp-1 text-xs font-medium text-ink">{p.nome}</span>
                <span className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-accent">{brl(precoBase(p))}</span>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-on-brand"><Plus size={14} /></span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Totais + fidelidade */}
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
        <Linha label="Subtotal" valor={brl(total)} />
        {cliente && total > 0 && (
          <div className="flex items-center justify-between text-sm text-accent">
            <span className="flex items-center gap-1"><Award size={14} /> Você ganha</span>
            <span className="font-bold tabular-nums">+{Math.floor(total)} pts</span>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
          <span className="text-lg font-semibold text-ink">Total</span>
          <span className="font-display text-3xl font-bold tabular-nums text-accent">{brl(total)}</span>
        </div>
      </div>

      {error && <Erro>{error}</Erro>}
      <BotaoGrande disabled={numItens === 0 || pending} onClick={onAcao}>
        {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />} {acaoLabel}
      </BotaoGrande>
    </div>
  );
}

/* ═══════════════════ REVISÃO DO PEDIDO (tela cheia) ═══════════════════ */
function Revisao({
  cliente, cart, setQtd, total, numItens, sugestoes, add, pending, error, onVoltar, onPagar,
}: {
  cliente: PerfilTotem | null; cart: CartItem[]; setQtd: (k: string, q: number) => void;
  total: number; numItens: number; sugestoes: ProdutoVenda[]; add: AddFn;
  pending: boolean; error: string | null; onVoltar: () => void; onPagar: () => void;
}) {
  return (
    <div className="mx-auto flex h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3 pt-1">
        <button onClick={onVoltar} aria-label="Voltar aos produtos"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-surface-2 active:scale-95">
          <ArrowLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold text-ink">Seu pedido</h2>
          <p className="text-sm text-muted">{numItens} {numItens === 1 ? "item" : "itens"} — revise antes de pagar</p>
        </div>
      </div>
      <CarrinhoPanel cliente={cliente} cart={cart} setQtd={setQtd} total={total} numItens={numItens}
        sugestoes={sugestoes} add={add} pending={pending} error={error}
        acaoLabel="Ir para o pagamento" onAcao={onPagar} />
    </div>
  );
}

/* ═══════════════════ PAGAMENTO ═══════════════════ */
const METODO_INFO: Record<string, { label: string; icone: React.ReactNode }> = {
  PIX: { label: "Pix", icone: <QrCode size={28} /> },
  CARTAO_CREDITO: { label: "Cartão de crédito", icone: <CreditCard size={28} /> },
  CARTAO_DEBITO: { label: "Cartão de débito", icone: <CreditCard size={28} /> },
  DINHEIRO: { label: "Dinheiro", icone: <Banknote size={28} /> },
  OUTRO: { label: "Outro", icone: <Wallet size={28} /> },
};

function Pagamento({
  total, metodosAtivos, metodo, saleId, pending, error, onEscolher, onConfirmar, onPagarNoCaixa, onVoltar,
}: {
  total: number; metodosAtivos: PaymentMethod[]; metodo: PaymentMethod | null; saleId: string | null;
  pending: boolean; error: string | null;
  onEscolher: (m: PaymentMethod) => void; onConfirmar: () => void; onPagarNoCaixa: () => void; onVoltar: () => void;
}) {
  // Totem só processa PIX/cartão (dinheiro e OUTRO viram "pagar no caixa").
  const suportados = metodosAtivos.filter((m) => m !== "OUTRO" && m !== "DINHEIRO");
  const metodos = suportados.length ? suportados : (["PIX"] as PaymentMethod[]);

  // Escolha do método.
  if (!metodo || !saleId) {
    return (
      <Centro>
        <p className="font-display text-sm font-bold uppercase tracking-widest text-brand">Pagamento</p>
        <h2 className="font-display text-3xl font-bold text-ink">Como você quer pagar?</h2>
        <p className="font-display text-4xl font-bold tabular-nums text-accent">{brl(total)}</p>
        {error && <Erro>{error}</Erro>}
        <div className="grid w-full max-w-md gap-3 sm:grid-cols-2">
          {metodos.map((m) => (
            <button key={m} disabled={pending} onClick={() => onEscolher(m)}
              className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-left transition-all hover:border-brand hover:bg-brand-soft disabled:opacity-50 active:scale-[0.98]">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-surface-2 text-brand">{METODO_INFO[m]?.icone}</span>
              <span className="font-display text-lg font-bold text-ink">{METODO_INFO[m]?.label ?? m}</span>
            </button>
          ))}
        </div>
        {/* Modo B — o caixa recebe a venda na hora */}
        <button disabled={pending} onClick={onPagarNoCaixa}
          className="flex w-full max-w-md items-center gap-4 rounded-2xl border-2 border-accent/50 bg-accent-soft p-5 text-left transition-all hover:border-accent disabled:opacity-50 active:scale-[0.98]">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-surface text-accent">
            {pending ? <Loader2 size={28} className="animate-spin" /> : <Banknote size={28} />}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-lg font-bold text-ink">Pagar no caixa</span>
            <span className="block text-sm text-muted">Enviamos seu pedido — é só se dirigir ao caixa.</span>
          </span>
        </button>
        <BotaoSecundario onClick={onVoltar} className="max-w-md"><ArrowLeft size={18} /> Voltar ao carrinho</BotaoSecundario>
      </Centro>
    );
  }

  // Detalhe do pagamento escolhido.
  const isPix = metodo === "PIX";
  return (
    <Centro>
      <h2 className="font-display text-3xl font-bold text-ink">
        {isPix ? "Pague com Pix" : `Pague com ${METODO_INFO[metodo]?.label ?? metodo}`}
      </h2>
      {isPix ? (
        <>
          <div className="grid h-60 w-60 place-items-center rounded-3xl border-4 border-dashed border-line bg-surface-2 text-faint">
            <QrCode size={130} />
          </div>
          <PixTimer />
          <p className="max-w-sm text-lg text-muted">Aponte a câmera do celular para o QR Code e confirme o pagamento no app do banco.</p>
        </>
      ) : (
        <>
          <span className="grid h-24 w-24 place-items-center rounded-full bg-brand-soft text-brand">{METODO_INFO[metodo]?.icone}</span>
          <p className="max-w-sm text-lg text-muted">
            {metodo === "DINHEIRO" ? "Dirija-se ao atendente para pagar em dinheiro." : "Insira ou aproxime o cartão na maquininha."}
          </p>
        </>
      )}
      <p className="font-display text-4xl font-bold tabular-nums text-accent">{brl(total)}</p>
      {error && <Erro>{error}</Erro>}
      <div className="flex w-full max-w-md flex-col gap-3">
        <BotaoGrande disabled={pending} onClick={onConfirmar}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar pagamento
        </BotaoGrande>
        <BotaoSecundario onClick={onVoltar}><ArrowLeft size={18} /> Trocar forma de pagamento</BotaoSecundario>
      </div>
    </Centro>
  );
}

function PixTimer() {
  const [s, setS] = useState(300);
  useEffect(() => {
    const t = setInterval(() => setS((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <p className="flex items-center gap-2 text-muted">
      <span className="h-2 w-2 animate-pulse rounded-full bg-ok" /> Aguardando pagamento · expira em <span className="font-mono font-bold text-ink">{mm}:{ss}</span>
    </p>
  );
}

/* ═══════════════════ CONFIRMADO ═══════════════════ */
function Confirmado({ tenantNome, total, resultado, cliente, onNova }: {
  tenantNome: string; total: number; resultado: ResultadoTotem | null; cliente: PerfilTotem | null; onNova: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onNova, 15000);
    return () => clearTimeout(t);
  }, [onNova]);
  return (
    <Centro>
      <span className="grid h-24 w-24 place-items-center rounded-full bg-ok-soft text-ok motion-safe:animate-in motion-safe:zoom-in"><CheckCircle2 size={56} /></span>
      <h2 className="font-display text-4xl font-bold text-ink">Obrigado pela compra! 🎉</h2>
      <p className="text-lg text-muted">Já pode retirar seus itens.</p>

      <div className="grid w-full max-w-sm gap-2">
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-4">
          <span className="text-muted">Pedido</span>
          <span className="font-mono text-xl font-bold text-ink">#{resultado?.numero ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-4">
          <span className="text-muted">Total pago</span>
          <span className="font-display text-xl font-bold tabular-nums text-accent">{brl(total)}</span>
        </div>
        {cliente && resultado && resultado.pontosGanhos > 0 && (
          <div className="flex items-center justify-between rounded-2xl border border-brand bg-brand-soft px-5 py-4">
            <span className="flex items-center gap-2 font-medium text-ink"><Award size={18} className="text-brand" /> Você ganhou</span>
            <span className="font-display text-xl font-bold text-brand">+{resultado.pontosGanhos} pts</span>
          </div>
        )}
      </div>

      <p className="text-sm text-muted">Obrigado por comprar na {tenantNome}.</p>
      <BotaoGrande onClick={onNova} className="max-w-xs">Nova compra</BotaoGrande>
    </Centro>
  );
}

/* ═══════════════════ ENVIADO AO CAIXA (Modo B) ═══════════════════ */
function EnviadoAoCaixa({ numero, total, numItens, onNova }: {
  numero: string | null; total: number; numItens: number; onNova: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onNova, 12000);
    return () => clearTimeout(t);
  }, [onNova]);
  return (
    <Centro>
      <span className="grid h-24 w-24 place-items-center rounded-full bg-accent-soft text-accent motion-safe:animate-in motion-safe:zoom-in">
        <Wallet size={52} />
      </span>
      <h2 className="font-display text-4xl font-bold text-ink">Pedido enviado ao caixa</h2>
      <p className="max-w-md text-lg text-muted">Dirija-se ao caixa e informe o número do pedido para pagar.</p>

      <div className="grid w-full max-w-sm gap-2">
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-4">
          <span className="text-muted">Pedido</span>
          <span className="font-mono text-2xl font-bold text-ink">{numero ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-4">
          <span className="text-muted">{numItens} {numItens === 1 ? "item" : "itens"}</span>
          <span className="font-display text-xl font-bold tabular-nums text-accent">{brl(total)}</span>
        </div>
      </div>

      <BotaoGrande onClick={onNova} className="max-w-xs">Concluir</BotaoGrande>
    </Centro>
  );
}

/* ═══════════════════ TERMINAL INDISPONÍVEL ═══════════════════ */
function TerminalIndisponivel({ tenantNome, terminalNome }: {
  tenantNome: string; terminalNome: string | null;
}) {
  return (
    <Centro>
      <span className="grid h-24 w-24 place-items-center rounded-full bg-surface-2 text-faint"><Lock size={48} /></span>
      <h2 className="font-display text-3xl font-bold text-ink">Terminal indisponível</h2>
      <p className="max-w-md text-lg text-muted">
        O caixa da {tenantNome} está fechado no momento. Procure um atendente para ser atendido.
      </p>
      {terminalNome && (
        <p className="font-mono text-xs uppercase tracking-widest text-faint">{terminalNome}</p>
      )}
    </Centro>
  );
}

/* ═══════════════════ PRIMITIVOS ═══════════════════ */
function Centro({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col items-center justify-center gap-5 p-4 text-center", className)}>
      {children}
    </div>
  );
}

function BotaoGrande({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-6 py-5 font-display text-xl font-bold text-on-brand transition-colors",
        "hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.99]",
        className,
      )}>
      {children}
    </button>
  );
}
function BotaoSecundario({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-2xl border border-line px-6 py-4 text-lg font-medium text-ink transition-colors hover:bg-surface-2",
        className,
      )}>
      {children}
    </button>
  );
}
function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between text-muted">
      <span>{label}</span>
      <span className="tabular-nums text-ink">{valor}</span>
    </div>
  );
}
function Erro({ children }: { children: React.ReactNode }) {
  return <p className="w-full max-w-md rounded-2xl bg-danger-soft px-4 py-3 text-center text-danger">{children}</p>;
}
function Vazio({ texto }: { texto: string }) {
  return <p className="py-16 text-center text-muted">{texto}</p>;
}

/* Teclado numérico touch para CPF — teclas grandes, folgadas para o dedo. */
function Teclado({ onDigito, onApagar, onLimpar }: {
  onDigito: (d: string) => void; onApagar: () => void; onLimpar?: () => void;
}) {
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} onClick={() => onDigito(d)}
          className="rounded-2xl border border-line bg-surface py-7 font-display text-4xl font-bold text-ink transition-colors hover:bg-brand-soft active:scale-95 active:bg-brand-soft">
          {d}
        </button>
      ))}
      {onLimpar ? (
        <button onClick={onLimpar}
          className="rounded-2xl border border-line bg-surface py-7 text-lg font-semibold text-muted transition-colors hover:bg-danger-soft hover:text-danger active:scale-95">
          Limpar
        </button>
      ) : (
        <span />
      )}
      <button onClick={() => onDigito("0")}
        className="rounded-2xl border border-line bg-surface py-7 font-display text-4xl font-bold text-ink transition-colors hover:bg-brand-soft active:scale-95 active:bg-brand-soft">0</button>
      <button onClick={onApagar} aria-label="Apagar um dígito"
        className="grid place-items-center rounded-2xl border border-line bg-surface py-7 text-ink transition-colors hover:bg-surface-2 active:scale-95">
        <Delete size={32} />
      </button>
    </div>
  );
}

/* ═══════════════════ Formatação ═══════════════════ */
function fmtTel(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.length <= 10) return d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) =>
    (a ? "(" + a + ")" : "") + (b ? " " + b : "") + (c ? "-" + c : ""));
  return d.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
}
