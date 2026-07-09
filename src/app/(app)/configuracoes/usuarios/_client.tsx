"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2, MailQuestion, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import type { Role } from "@/generated/prisma";
import { inviteMember, revokeInvite, updateMemberRole, removeMember } from "../actions";

type Membro = {
  id: string;
  userId: string;
  nome: string;
  email: string;
  role: Role;
  desde: string;
};

type Convite = { id: string; email: string; role: Role; em: string };

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  MEMBER: "Operador",
};

const selectCls =
  "cursor-pointer rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function UsuariosClient({
  meuUserId,
  meuPapel,
  membros,
  convites,
}: {
  meuUserId: string;
  meuPapel: Role;
  membros: Membro[];
  convites: Convite[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");

  const gestor = meuPapel === "OWNER" || meuPapel === "ADMIN";

  function run(fn: () => Promise<void>) {
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha na operação.");
      }
    });
  }

  function convidar() {
    if (!email.trim()) {
      toast.error("Informe o e-mail de quem você quer convidar.");
      return;
    }
    run(async () => {
      const r = await inviteMember({ email, role });
      setEmail("");
      toast.success(
        r.status === "member"
          ? "Pessoa adicionada à equipe."
          : "Convite criado — vale assim que a pessoa se cadastrar com esse e-mail.",
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Convidar */}
      {gestor && (
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <UserPlus size={15} className="text-brand" /> Convidar para a equipe
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="E-mail" htmlFor="convite-email" className="flex-1">
              <Input
                id="convite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@email.com"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), convidar())}
              />
            </Field>
            <Field label="Papel" htmlFor="convite-papel">
              <select
                id="convite-papel"
                value={role}
                onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}
                className={selectCls}
              >
                <option value="MEMBER">Operador</option>
                {meuPapel === "OWNER" && <option value="ADMIN">Administrador</option>}
              </select>
            </Field>
            <Button onClick={convidar} disabled={pending}>
              <UserPlus size={16} /> Convidar
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Operador usa o dia a dia (PDV, estoque). Administrador também altera
            configurações e convida operadores.
          </p>
        </div>
      )}

      {/* Membros */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface">
        <p className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">
          Equipe <span className="text-muted">({membros.length})</span>
        </p>
        <ul className="divide-y divide-line">
          {membros.map((m) => {
            const souEu = m.userId === meuUserId;
            const podeEditar =
              gestor && !souEu && m.role !== "OWNER" &&
              (meuPapel === "OWNER" || m.role === "MEMBER");
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
                  {m.nome.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                    {m.nome}
                    {souEu && <Badge tone="brand">você</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
                {m.role === "OWNER" ? (
                  <Badge tone="accent">
                    <Crown size={11} /> {ROLE_LABEL.OWNER}
                  </Badge>
                ) : meuPapel === "OWNER" && !souEu ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      run(() => updateMemberRole(m.id, e.target.value as "ADMIN" | "MEMBER"))
                    }
                    disabled={pending}
                    className={selectCls}
                    aria-label={`Papel de ${m.nome}`}
                  >
                    <option value="ADMIN">Administrador</option>
                    <option value="MEMBER">Operador</option>
                  </select>
                ) : (
                  <Badge>{ROLE_LABEL[m.role]}</Badge>
                )}
                {podeEditar && (
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
            {convites.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{c.email}</p>
                  <p className="text-xs text-muted">
                    Entra como {ROLE_LABEL[c.role]} ao se cadastrar com esse e-mail.
                  </p>
                </div>
                {gestor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => run(() => revokeInvite(c.id))}
                    disabled={pending}
                  >
                    Cancelar convite
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
