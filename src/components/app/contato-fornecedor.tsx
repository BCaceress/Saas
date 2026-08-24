"use client";

import { useState, useTransition } from "react";
import { Mail, MessageCircle, Star, UserPlus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { Checkbox } from "@/components/ui/checkbox";
import { maskPhone } from "@/lib/masks";
import { cn } from "@/lib/utils";
import {
  salvarContatoAction,
  type ContatoSalvo,
} from "@/app/(app)/fornecedores/contatos-actions";

// ── Contato do fornecedor ───────────────────────────────────
// O mesmo formulário serve ao cadastro do fornecedor e ao envio da cotação:
// descobrir um vendedor novo no meio do envio é rotina, e mandar o operador
// "voltar no cadastro" é o tipo de desvio que faz o dado nunca ser gravado.

export type ContatoUI = {
  id: string;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

/** Como este contato dá para ser alcançado — decide o canal padrão do envio. */
export function meiosDoContato(c: { telefone: string | null; email: string | null }): {
  whatsapp: boolean;
  email: boolean;
} {
  return { whatsapp: Boolean(c.telefone?.trim()), email: Boolean(c.email?.trim()) };
}

/** Linha "João Silva · Vendedor" com os canais que ele atende. */
export function ContatoResumo({ contato, className }: { contato: ContatoUI; className?: string }) {
  const meios = meiosDoContato(contato);
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-medium text-ink">{contato.nome}</span>
        {contato.principal && (
          <Star
            size={12}
            className="shrink-0 fill-accent text-accent"
            aria-label="Principal para cotação"
          />
        )}
      </span>
      <span className="flex items-center gap-2 text-[11px] text-muted">
        {contato.cargo && <span className="truncate">{contato.cargo}</span>}
        {meios.whatsapp && (
          <span className="flex items-center gap-0.5">
            <MessageCircle size={11} />
            WhatsApp
          </span>
        )}
        {meios.email && (
          <span className="flex items-center gap-0.5">
            <Mail size={11} />
            E-mail
          </span>
        )}
      </span>
    </span>
  );
}

type FormContato = {
  nome: string;
  cargo: string;
  telefone: string;
  email: string;
  principal: boolean;
};

const VAZIO: FormContato = { nome: "", cargo: "", telefone: "", email: "", principal: false };

type PropsContato = {
  aberto: boolean;
  supplierId: string;
  contato?: ContatoUI | null;
  /** Primeiro contato do fornecedor: principal é imposto, não escolhido. */
  primeiro?: boolean;
  /**
   * Preenche um contato NOVO. Serve ao disparo avulso: o comprador mandou a
   * cotação para um número da agenda dele e agora salva a pessoa sem
   * redigitar o que acabou de usar.
   */
  inicial?: { nome?: string | null; telefone?: string | null; email?: string | null } | null;
  onFechar: () => void;
  onSalvo?: (c: ContatoSalvo) => void;
};

/**
 * Modal de cadastro/edição. `onSalvo` recebe o contato gravado — quem chamou
 * decide o que fazer com ele (selecionar no envio, recarregar a lista…).
 *
 * O formulário só existe enquanto o painel está aberto, e a `key` amarra o
 * estado ao contato editado: abrir de novo começa limpo, sem efeito de
 * sincronização (e sem o render em cascata que ele traria).
 */
export function ContatoSheet(props: PropsContato) {
  if (!props.aberto) return null;
  return <FormularioContato key={props.contato?.id ?? "novo"} {...props} />;
}

function FormularioContato({
  supplierId,
  contato,
  primeiro,
  inicial,
  onFechar,
  onSalvo,
}: PropsContato) {
  const [form, setForm] = useState<FormContato>(() =>
    contato
      ? {
          nome: contato.nome,
          cargo: contato.cargo ?? "",
          telefone: contato.telefone ? maskPhone(contato.telefone) : "",
          email: contato.email ?? "",
          principal: contato.principal,
        }
      : {
          ...VAZIO,
          nome: inicial?.nome ?? "",
          telefone: inicial?.telefone ? maskPhone(inicial.telefone) : "",
          email: inicial?.email ?? "",
          principal: Boolean(primeiro),
        },
  );
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  function upd<K extends keyof FormContato>(k: K, v: FormContato[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const semMeio = !form.telefone.trim() && !form.email.trim();
  const podeSalvar = form.nome.trim().length >= 2 && !semMeio;

  function salvar() {
    setErro(null);
    start(async () => {
      try {
        const salvo = await salvarContatoAction({
          id: contato?.id,
          supplierId,
          nome: form.nome,
          cargo: form.cargo,
          telefone: form.telefone,
          email: form.email,
          principal: form.principal,
        });
        onSalvo?.(salvo);
        onFechar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar o contato.");
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onFechar}
      title={contato ? "Editar contato" : "Adicionar contato"}
      description="Quem, dentro do fornecedor, recebe a cotação."
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={!podeSalvar || pendente}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pendente ? "Salvando…" : "Salvar contato"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nome" htmlFor="ct-nome">
          <Input
            id="ct-nome"
            autoFocus
            value={form.nome}
            onChange={(e) => upd("nome", e.target.value)}
            placeholder="João Silva"
          />
        </Field>

        <Field label="Cargo ou função" htmlFor="ct-cargo" hint="Opcional.">
          <Input
            id="ct-cargo"
            value={form.cargo}
            onChange={(e) => upd("cargo", e.target.value)}
            placeholder="Vendedor, representante, comercial…"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="WhatsApp" htmlFor="ct-tel">
            <Input
              id="ct-tel"
              value={form.telefone}
              onChange={(e) => upd("telefone", maskPhone(e.target.value))}
              inputMode="numeric"
              maxLength={15}
              placeholder="(11) 99999-9999"
            />
          </Field>
          <Field label="E-mail" htmlFor="ct-mail">
            <Input
              id="ct-mail"
              type="email"
              value={form.email}
              onChange={(e) => upd("email", e.target.value)}
              placeholder="joao@fornecedor.com.br"
            />
          </Field>
        </div>

        {semMeio && (
          <p className="text-[12px] text-muted">
            Preencha WhatsApp ou e-mail — é por onde a cotação sai.
          </p>
        )}

        <label
          className={cn(
            "flex items-start gap-2.5 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5",
            primeiro && "opacity-70",
          )}
        >
          <Checkbox
            checked={form.principal}
            disabled={primeiro}
            onChange={(e) => upd("principal", e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[13px] text-ink">
            Definir como contato principal para cotação
            <span className="block text-[11px] text-muted">
              {primeiro
                ? "É o primeiro contato deste fornecedor — ele já entra como principal."
                : "É quem vem escolhido no envio. Só um por fornecedor: o anterior perde a marca."}
            </span>
          </span>
        </label>

        {erro && <p className="text-[13px] text-danger">{erro}</p>}
      </div>
    </Sheet>
  );
}

/** Botão "+ Adicionar contato" — mesmo gesto nas duas telas. */
export function BotaoAdicionarContato({
  onClick,
  className,
  rotulo = "Adicionar contato",
}: {
  onClick: () => void;
  className?: string;
  rotulo?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-dashed border-line px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand hover:text-brand",
        className,
      )}
    >
      <UserPlus size={14} />
      {rotulo}
    </button>
  );
}
