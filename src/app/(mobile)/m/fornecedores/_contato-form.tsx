"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { maskPhone } from "@/lib/masks";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { salvarContatoAction } from "@/app/(app)/fornecedores/contatos-actions";
import type { ContatoMobile } from "./_data";

/**
 * Cadastro de CONTATO no celular — o campo que a agenda não tinha.
 *
 * Quem descobre o vendedor novo descobre de pé, na entrega: ele deixa o
 * WhatsApp e o operador anotava no papel porque a única tela de contatos era a
 * de mesa. São quatro campos, e nenhum deles precisa do centro de gestão.
 *
 * A action é a MESMA do desktop (`salvarContatoAction`): a regra do principal
 * único e a exigência de ter WhatsApp ou e-mail moram lá, não aqui.
 */
export function FormContato({
  supplierId,
  fornecedorNome,
  base,
  onFechar,
}: {
  supplierId: string;
  fornecedorNome: string;
  /** Contato existente (edição) ou null (cadastro). */
  base: ContatoMobile | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = React.useState(base?.nome ?? "");
  const [cargo, setCargo] = React.useState(base?.cargo ?? "");
  const [telefone, setTelefone] = React.useState(
    base?.telefone ? maskPhone(base.telefone) : "",
  );
  const [email, setEmail] = React.useState(base?.email ?? "");
  const [principal, setPrincipal] = React.useState(base?.principal ?? false);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  // O mesmo mínimo da action: nome e um canal. Barrar aqui evita a ida ao
  // servidor só para voltar com erro.
  const temCanal = telefone.replace(/\D/g, "").length >= 10 || email.trim().includes("@");
  const podeSalvar = nome.trim().length >= 2 && temCanal && !salvando;

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarContatoAction({
        id: base?.id,
        supplierId,
        nome,
        cargo: cargo || null,
        // Só dígito: é o formato que `wa.me` e o envio da cotação esperam.
        telefone: telefone.replace(/\D/g, "") || null,
        email: email || null,
        principal,
      });
      toast.success(base ? "Contato atualizado." : "Contato cadastrado.");
      router.refresh();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o contato.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={base ? "Editar contato" : "Novo contato"}
      descricao={fornecedorNome}
      rodape={
        <Button onClick={salvar} disabled={!podeSalvar} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {base ? "Salvar alterações" : "Salvar contato"}
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <Campo label="Nome" htmlFor="mfc-nome" obrigatorio>
          <input
            id="mfc-nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="João Silva"
            autoFocus
            autoComplete="name"
            className={ENTRADA}
          />
        </Campo>

        <Campo label="Função" htmlFor="mfc-cargo">
          <input
            id="mfc-cargo"
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
            placeholder="Vendedor, representante…"
            className={ENTRADA}
          />
        </Campo>

        <Campo label="WhatsApp" htmlFor="mfc-tel">
          <input
            id="mfc-tel"
            value={telefone}
            onChange={(e) => setTelefone(maskPhone(e.target.value))}
            inputMode="numeric"
            maxLength={15}
            placeholder="(11) 99999-9999"
            className={ENTRADA}
          />
        </Campo>

        <Campo label="E-mail" htmlFor="mfc-email">
          <input
            id="mfc-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vendedor@fornecedor.com.br"
            autoComplete="email"
            inputMode="email"
            className={ENTRADA}
          />
        </Campo>

        {/* Canal é obrigatório, não conselho: contato sem WhatsApp nem e-mail
            não recebe cotação, e o cadastro morre no banco sem servir a nada.
            O aviso fica vermelho enquanto falta — o botão já está travado. */}
        <p className={cn("px-1 text-xs", temCanal ? "text-muted" : "text-danger")}>
          Informe o WhatsApp ou o e-mail — é por onde a cotação sai.
        </p>

        {/* Só no cadastro. Na edição o botão virava um rótulo de estado
            ("Recebe as cotações deste fornecedor") que ninguém lia como
            interruptor — trocar o principal é decisão de mesa, e a tela de
            fornecedores no desktop continua fazendo isso. */}
        {!base && (
          <button
            type="button"
            onClick={() => setPrincipal((v) => !v)}
            aria-pressed={principal}
            className={cn(
              "min-h-11 w-full cursor-pointer rounded-full border px-4 text-sm font-medium",
              principal
                ? "border-transparent bg-brand text-on-brand"
                : "border-line-button bg-surface text-ink-2",
            )}
          >
            Marcar como contato principal
          </button>
        )}

        {erro && <p className="text-sm text-danger">{erro}</p>}
      </div>
    </BottomSheet>
  );
}

const ENTRADA =
  "min-h-11 w-full rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

function Campo({
  label,
  htmlFor,
  obrigatorio,
  children,
}: {
  label: string;
  htmlFor: string;
  obrigatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
        {obrigatorio && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
