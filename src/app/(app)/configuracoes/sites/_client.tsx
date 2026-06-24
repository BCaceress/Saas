"use client";

import { useState, useTransition } from "react";
import {
  Plus,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Store,
  Warehouse,
} from "lucide-react";
import { createSite, updateSite, toggleSiteAtivo } from "../../estoque/actions";
import { cn } from "@/lib/utils";

type Site = { id: string; nome: string; tipo: string; ativo: boolean };

export function SitesManager({ sites: initial }: { sites: Site[] }) {
  const [sites, setSites] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Site | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"LOJA" | "CD">("LOJA");

  function openAdd() {
    setEditing(null);
    setNome("");
    setTipo("LOJA");
    setError(null);
    setAdding(true);
  }

  function openEdit(s: Site) {
    setAdding(false);
    setNome(s.nome);
    setTipo(s.tipo as "LOJA" | "CD");
    setError(null);
    setEditing(s);
  }

  function cancel() {
    setAdding(false);
    setEditing(null);
    setError(null);
  }

  function save() {
    setError(null);
    const nomeClean = nome.trim();
    if (nomeClean.length < 2) {
      setError("Informe o nome (mín. 2 caracteres).");
      return;
    }

    startTransition(async () => {
      try {
        if (editing) {
          await updateSite(editing.id, { nome: nomeClean, tipo });
          setSites((prev) =>
            prev.map((s) =>
              s.id === editing.id ? { ...s, nome: nomeClean, tipo } : s,
            ),
          );
        } else {
          const id = await createSite({ nome: nomeClean, tipo });
          setSites((prev) => [
            ...prev,
            { id, nome: nomeClean, tipo, ativo: true },
          ]);
        }
        cancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  function toggle(s: Site) {
    startTransition(async () => {
      try {
        await toggleSiteAtivo(s.id, !s.ativo);
        setSites((prev) =>
          prev.map((p) => (p.id === s.id ? { ...p, ativo: !p.ativo } : p)),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao alterar.");
      }
    });
  }

  const showForm = adding || editing !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          <Plus size={16} /> Adicionar ponto/loja
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-brand bg-brand-soft p-5">
          <p className="text-sm font-semibold text-ink">
            {editing ? "Editar loja" : "Nova loja"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">
                Nome
              </label>
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Loja Centro, CD Principal"
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">
                Tipo
              </label>
              <div className="flex gap-2">
                {(["LOJA", "CD"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                      tipo === t
                        ? "border-brand bg-surface text-brand"
                        : "border-line text-muted hover:bg-surface",
                    )}
                  >
                    {t === "LOJA" ? (
                      <Store size={15} />
                    ) : (
                      <Warehouse size={15} />
                    )}
                    {t === "LOJA" ? "Loja / Ponto" : "CD"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={cancel}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={pending}
              className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {pending && <Loader2 size={13} className="animate-spin" />}
              {editing ? "Salvar" : "Criar site"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {sites.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
          <Store size={32} className="text-faint" />
          <p className="text-sm text-muted">
            Nenhum site cadastrado. Adicione o primeiro.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {sites.map((s, idx) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2",
                idx !== 0 && "border-t border-line",
              )}
            >
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  s.tipo === "CD"
                    ? "bg-surface-2 text-muted"
                    : "bg-brand-soft text-brand",
                )}
              >
                {s.tipo === "CD" ? (
                  <Warehouse size={16} />
                ) : (
                  <Store size={16} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "font-medium",
                    s.ativo ? "text-ink" : "text-muted line-through",
                  )}
                >
                  {s.nome}
                </p>
                <p className="text-xs text-faint">
                  {s.tipo === "CD" ? "Centro de Distribuição" : "Loja / Ponto"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEdit(s)}
                  className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => toggle(s)}
                  disabled={pending}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg transition-colors",
                    s.ativo
                      ? "text-ok hover:bg-ok-soft"
                      : "text-muted hover:bg-surface-2",
                  )}
                  title={s.ativo ? "Desativar" : "Ativar"}
                >
                  {s.ativo ? (
                    <ToggleRight size={18} />
                  ) : (
                    <ToggleLeft size={18} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
