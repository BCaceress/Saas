"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  MessageCircle,
  MoreVertical,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { maskPhone } from "@/lib/masks";
import { cn } from "@/lib/utils";
import { ContatoSheet, type ContatoUI } from "@/components/app/contato-fornecedor";
import {
  definirContatoAtivoAction,
  definirContatoPrincipalAction,
  removerContatoAction,
} from "../contatos-actions";
import type { ContatoFornecedor } from "./_data";

// ── Contatos do fornecedor ──────────────────────────────────
// A empresa não responde cotação: gente responde. Esta é a lista dos
// vendedores/representantes daquele fornecedor, em cartões — cada pessoa é uma
// ficha, não uma linha de tabela.
//
// A estrela diz quem já vem escolhido no envio. Contato que JÁ recebeu cotação
// não pode ser excluído, só inativado: apagar levaria junto o "para quem foi"
// do histórico.

export function ContatosFornecedor({
  supplierId,
  contatos,
  podeEditar,
}: {
  supplierId: string;
  contatos: ContatoFornecedor[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<ContatoUI | null>(null);
  const [criando, setCriando] = useState(false);
  const [pendente, start] = useTransition();

  function rodar(fn: () => Promise<unknown>, sucesso: string) {
    start(async () => {
      try {
        await fn();
        toast.success(sucesso);
        router.refresh();
      } catch (e) {
        toast.error("Não deu para salvar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] bg-brand-soft text-brand">
            <Users size={14} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-ink">Contatos</h2>
            <p className="text-[11px] text-muted">
              Quem recebe a cotação. A estrela marca o principal.
            </p>
          </div>
        </div>
        {podeEditar && contatos.length > 0 && <BotaoAdicionar onClick={() => setCriando(true)} />}
      </div>

      <div className="p-4">
        {contatos.length === 0 ? (
          <div className="flex flex-col items-start gap-2.5 rounded-[var(--radius)] border border-dashed border-line px-4 py-5">
            <p className="text-[13px] text-muted">
              Nenhum contato cadastrado. Sem uma pessoa, a cotação sai para o telefone
              geral da empresa — e costuma morrer lá.
            </p>
            {podeEditar && <BotaoAdicionar onClick={() => setCriando(true)} />}
          </div>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {contatos.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex items-start gap-2 rounded-[var(--radius)] border bg-surface p-3",
                  c.principal ? "border-accent/50" : "border-line",
                  !c.ativo && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[13px] font-semibold text-ink",
                      !c.ativo && "line-through",
                    )}
                  >
                    {c.nome}
                    {c.cargo && <span className="font-normal text-muted"> ({c.cargo})</span>}
                  </p>

                  {/* Telefone e e-mail lado a lado quando cabem; em cartão
                      estreito o `flex-wrap` quebra sozinho. */}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
                    {c.telefone && (
                      <span className="flex items-center gap-1">
                        <MessageCircle size={12} className="shrink-0 text-faint" />
                        <span className="truncate font-mono">{maskPhone(c.telefone)}</span>
                      </span>
                    )}
                    {c.email && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} className="shrink-0 text-faint" />
                        <span className="truncate">{c.email}</span>
                      </span>
                    )}
                  </p>

                  {(!c.ativo || c.envios > 0) && (
                    <p className="mt-1.5 text-[11px] text-faint">
                      {!c.ativo && "Inativo"}
                      {!c.ativo && c.envios > 0 && " · "}
                      {c.envios > 0 &&
                        `${c.envios} ${c.envios === 1 ? "envio" : "envios"} no histórico`}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {c.principal && (
                    <Star
                      size={14}
                      className="fill-accent text-accent"
                      aria-label="Principal para cotação"
                    />
                  )}
                  {podeEditar && (
                    <Menu
                      trigger={
                        <button
                          type="button"
                          aria-label={`Ações de ${c.nome}`}
                          aria-haspopup="menu"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          <MoreVertical size={15} />
                        </button>
                      }
                    >
                      {!c.principal && c.ativo && (
                        <MenuItem
                          icon={<Star size={14} />}
                          disabled={pendente}
                          onClick={() =>
                            rodar(
                              () => definirContatoPrincipalAction(c.id),
                              `${c.nome} agora recebe as cotações`,
                            )
                          }
                        >
                          Tornar principal
                        </MenuItem>
                      )}
                      <MenuItem
                        icon={<UserPlus size={14} />}
                        onClick={() =>
                          setEditando({
                            id: c.id,
                            nome: c.nome,
                            cargo: c.cargo,
                            telefone: c.telefone,
                            email: c.email,
                            principal: c.principal,
                          })
                        }
                      >
                        Editar
                      </MenuItem>
                      {/* Quem já recebeu cotação some das listas de envio, mas
                          continua no histórico — por isso inativar, não excluir. */}
                      {c.ativo ? (
                        !c.podeExcluir && (
                          <MenuItem
                            icon={<Trash2 size={14} />}
                            disabled={pendente}
                            onClick={() =>
                              rodar(
                                () => definirContatoAtivoAction(c.id, false),
                                `${c.nome} inativado`,
                              )
                            }
                          >
                            Inativar
                          </MenuItem>
                        )
                      ) : (
                        <MenuItem
                          icon={<UserPlus size={14} />}
                          disabled={pendente}
                          onClick={() =>
                            rodar(
                              () => definirContatoAtivoAction(c.id, true),
                              `${c.nome} reativado`,
                            )
                          }
                        >
                          Reativar
                        </MenuItem>
                      )}
                      {c.podeExcluir && (
                        <MenuItem
                          danger
                          icon={<Trash2 size={14} />}
                          disabled={pendente}
                          onClick={() =>
                            rodar(() => removerContatoAction(c.id), `${c.nome} removido`)
                          }
                        >
                          Excluir
                        </MenuItem>
                      )}
                    </Menu>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ContatoSheet
        aberto={criando}
        supplierId={supplierId}
        primeiro={contatos.length === 0}
        onFechar={() => setCriando(false)}
        onSalvo={() => {
          toast.success("Contato salvo");
          router.refresh();
        }}
      />
      <ContatoSheet
        aberto={editando !== null}
        supplierId={supplierId}
        contato={editando}
        onFechar={() => setEditando(null)}
        onSalvo={() => {
          toast.success("Contato salvo");
          router.refresh();
        }}
      />
    </section>
  );
}

/** Ação principal do card — âmbar, a cor da etiqueta de preço. */
function BotaoAdicionar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-surface transition-opacity hover:opacity-90"
    >
      <UserPlus size={14} />
      Adicionar contato
    </button>
  );
}
