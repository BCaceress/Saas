"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus,
  UserCog,
  Trash2,
  MailQuestion,
  Crown,
  SlidersHorizontal,
  Ban,
  Undo2,
  Copy,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import type { Acesso } from "@/lib/permissoes";
import { AcessosEditor, AcessosChips, type SiteOpt } from "./_acessos-editor";
import {
  inviteMember,
  revokeInvite,
  renovarConvite,
  updateMemberAcessos,
  setMemberAtivo,
  removeMember,
} from "../actions";

type Membro = {
  id: string;
  userId: string;
  nome: string;
  email: string;
  proprietario: boolean;
  ativo: boolean;
  acessos: Acesso[];
  ultimoAcesso: string | null;
  desde: string;
};

type Convite = {
  id: string;
  email: string;
  acessos: Acesso[];
  link: string;
  expiraEm: string;
  em: string;
};

/** Perfil padrão de quem entra: opera o dia a dia, em todas as lojas. */
const ACESSOS_PADRAO: Acesso[] = [
  { perfil: "CAIXA", siteId: null },
  { perfil: "ESTOQUISTA", siteId: null },
];

function validade(iso: string): { texto: string; vencido: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { texto: "link vencido", vencido: true };
  const dias = Math.ceil(ms / 86_400_000);
  return { texto: dias === 1 ? "vence hoje" : `vence em ${dias} dias`, vencido: false };
}

/**
 * Copia para a área de transferência. `navigator.clipboard` só existe em
 * contexto seguro — e o dev roda em http://…lvh.me:3000, que NÃO é seguro. Daí
 * o fallback com execCommand (obsoleto, mas é o que funciona em http).
 */
async function copiar(texto: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // cai no fallback
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function desdeQuando(iso: string | null): string {
  if (!iso) return "nunca acessou";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias === 0) return "acessou hoje";
  if (dias === 1) return "acessou ontem";
  if (dias < 30) return `acessou há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `acessou há ${meses} ${meses === 1 ? "mês" : "meses"}`;
}

export function UsuariosClient({
  meuUserId,
  souAdmin,
  sites,
  membros,
  convites,
}: {
  meuUserId: string;
  souAdmin: boolean;
  sites: SiteOpt[];
  membros: Membro[];
  convites: Convite[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [convidando, setConvidando] = useState(false);
  const [editando, setEditando] = useState<Membro | null>(null);

  function run(fn: () => Promise<void>, aoConcluir?: () => void) {
    start(async () => {
      try {
        await fn();
        aoConcluir?.();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha na operação.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Usuários"
        icon={UserCog}
        description="Quem acessa o sistema, com qual perfil e em quais lojas."
        backHref="/configuracoes"
        innerClassName="max-w-none"
        className="mb-1"
        actions={
          souAdmin && (
            <Button onClick={() => setConvidando(true)}>
              <UserPlus size={16} /> Convidar pessoa
            </Button>
          )
        }
      />

      {/* Equipe */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface">
        <p className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">
          Equipe <span className="text-muted">({membros.length})</span>
        </p>
        <ul className="divide-y divide-line">
          {membros.map((m) => {
            const souEu = m.userId === meuUserId;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
                <span
                  className={
                    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold " +
                    (m.ativo ? "bg-brand-soft text-brand" : "bg-surface-2 text-faint")
                  }
                >
                  {m.nome.slice(0, 1).toUpperCase()}
                </span>

                <div className="min-w-[12rem] flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                    {m.nome}
                    {m.proprietario && (
                      <Badge tone="accent">
                        <Crown size={11} /> Dono da conta
                      </Badge>
                    )}
                    {souEu && <Badge tone="brand">você</Badge>}
                    {!m.ativo && <Badge tone="danger">desativado</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                  <p className="mt-0.5 text-xs text-faint">{desdeQuando(m.ultimoAcesso)}</p>
                </div>

                <div className="flex-1 basis-full sm:basis-auto">
                  <AcessosChips acessos={m.acessos} sites={sites} />
                </div>

                {souAdmin && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditando(m)}
                      disabled={pending}
                      className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-brand-soft hover:text-brand"
                      aria-label={`Editar acessos de ${m.nome}`}
                      title="Editar acessos"
                    >
                      <SlidersHorizontal size={15} />
                    </button>

                    {!m.proprietario && !souEu && (
                      <>
                        <button
                          onClick={() => run(() => setMemberAtivo(m.id, !m.ativo))}
                          disabled={pending}
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-warn-soft hover:text-warn"
                          aria-label={`${m.ativo ? "Desativar" : "Reativar"} ${m.nome}`}
                          title={m.ativo ? "Desativar acesso" : "Reativar acesso"}
                        >
                          {m.ativo ? <Ban size={15} /> : <Undo2 size={15} />}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Remover ${m.nome} da equipe?`)) {
                              run(() => removeMember(m.id));
                            }
                          }}
                          disabled={pending}
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                          aria-label={`Remover ${m.nome}`}
                          title="Remover da equipe"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Convites pendentes */}
      {convites.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface">
          <p className="flex items-center gap-1.5 border-b border-line px-5 py-3 text-sm font-semibold text-ink">
            <MailQuestion size={15} className="text-warn" /> Convites pendentes{" "}
            <span className="text-muted">({convites.length})</span>
          </p>
          <ul className="divide-y divide-line">
            {convites.map((c) => {
              const v = validade(c.expiraEm);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                  <div className="min-w-[12rem] flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                      {c.email}
                      <Badge tone={v.vencido ? "danger" : "neutral"}>{v.texto}</Badge>
                    </p>
                    <p className="text-xs text-muted">
                      Mande o link para a pessoa — nenhum e-mail é enviado ainda.
                    </p>
                  </div>
                  <div className="flex-1 basis-full sm:basis-auto">
                    <AcessosChips acessos={c.acessos} sites={sites} />
                  </div>
                  {souAdmin && !v.vencido && (
                    <input
                      readOnly
                      value={c.link}
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.currentTarget.select()}
                      aria-label={`Link do convite de ${c.email}`}
                      className="basis-full cursor-text rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-muted"
                    />
                  )}
                  {souAdmin && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending || v.vencido}
                        onClick={async () => {
                          if (await copiar(c.link)) toast.success("Link copiado.");
                          else toast.error("Não deu para copiar — use o campo do link acima.");
                        }}
                      >
                        <Copy size={14} /> Copiar link
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const link = await renovarConvite(c.id);
                            const ok = await copiar(link);
                            toast.success(
                              ok
                                ? "Link novo gerado e copiado. O anterior deixou de valer."
                                : "Link novo gerado. O anterior deixou de valer.",
                            );
                          })
                        }
                      >
                        <RefreshCw size={14} /> Novo link
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => run(() => revokeInvite(c.id))}
                        disabled={pending}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {convidando && (
        <SheetConvite
          sites={sites}
          pending={pending}
          onClose={() => setConvidando(false)}
          onSalvar={(email, acessos) =>
            run(async () => {
              const r = await inviteMember({ email, acessos });
              if (r.status === "member") {
                toast.success("Pessoa adicionada à equipe.");
                return;
              }
              const ok = await copiar(r.link);
              toast.success(
                ok
                  ? "Convite criado e link copiado — mande para a pessoa."
                  : "Convite criado. O link está na lista de convites pendentes.",
              );
            }, () => setConvidando(false))
          }
        />
      )}

      {editando && (
        <SheetAcessos
          membro={editando}
          sites={sites}
          pending={pending}
          onClose={() => setEditando(null)}
          onSalvar={(acessos) =>
            run(async () => {
              await updateMemberAcessos(editando.id, acessos);
              toast.success("Acessos atualizados.");
            }, () => setEditando(null))
          }
        />
      )}
    </div>
  );
}

function SheetConvite({
  sites,
  pending,
  onClose,
  onSalvar,
}: {
  sites: SiteOpt[];
  pending: boolean;
  onClose: () => void;
  onSalvar: (email: string, acessos: Acesso[]) => void;
}) {
  const [email, setEmail] = useState("");
  const [acessos, setAcessos] = useState<Acesso[]>(ACESSOS_PADRAO);

  function salvar() {
    if (!email.trim()) return toast.error("Informe o e-mail de quem você quer convidar.");
    if (acessos.length === 0) return toast.error("Escolha pelo menos um perfil.");
    onSalvar(email.trim(), acessos);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Convidar pessoa"
      description="Gera um link de acesso para você mandar — ainda não há envio de e-mail."
      width="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending}>
            <UserPlus size={16} /> Criar convite
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="E-mail" htmlFor="convite-email">
          <Input
            id="convite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@email.com"
            autoFocus
          />
        </Field>
        <AcessosEditor
          acessos={acessos}
          onChange={setAcessos}
          sites={sites}
          disabled={pending}
        />
      </div>
    </Sheet>
  );
}

function SheetAcessos({
  membro,
  sites,
  pending,
  onClose,
  onSalvar,
}: {
  membro: Membro;
  sites: SiteOpt[];
  pending: boolean;
  onClose: () => void;
  onSalvar: (acessos: Acesso[]) => void;
}) {
  const [acessos, setAcessos] = useState<Acesso[]>(membro.acessos);

  return (
    <Sheet
      open
      onClose={onClose}
      title={membro.nome}
      description={membro.email}
      width="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (acessos.length === 0) return toast.error("Escolha pelo menos um perfil.");
              onSalvar(acessos);
            }}
            disabled={pending}
          >
            Salvar acessos
          </Button>
        </div>
      }
    >
      <AcessosEditor
        acessos={acessos}
        onChange={setAcessos}
        sites={sites}
        disabled={pending || membro.proprietario}
      />
      {membro.proprietario && (
        <p className="mt-4 text-xs text-muted">
          O dono da conta é sempre administrador — para mudar isso, transfira a conta primeiro.
        </p>
      )}
    </Sheet>
  );
}
