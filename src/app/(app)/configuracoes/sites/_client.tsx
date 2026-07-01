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
  Search,
  Trash2,
  Box,
  Refrigerator,
  Snowflake,
  ChevronDown,
} from "lucide-react";
import { createSite, updateSite, toggleSiteAtivo } from "../../estoque/actions";
import {
  createStorageLocation,
  updateStorageLocation,
  deleteStorageLocation,
  toggleStorageLocationAtivo,
} from "../../produtos/actions";
import { Sheet } from "@/components/ui/sheet";
import { maskCep } from "@/lib/masks";
import { cn } from "@/lib/utils";

type Site = {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  cep?: string | null;
  rua?: string | null;
  numero?: string | null;
  cidade?: string | null;
  estado?: string | null;
  estoquePropio?: boolean;
  cdAbastecedorId?: string | null;
  controleIdade?: boolean;
};

type StorageTipo = "AMBIENTE" | "REFRIGERADO" | "CONGELADO";

type StorageLoc = {
  id: string;
  nome: string;
  tipo: StorageTipo;
  siteId: string;
  ativo: boolean;
  stockCount: number;
};

const STORAGE_LABEL: Record<StorageTipo, string> = {
  AMBIENTE: "Ambiente",
  REFRIGERADO: "Refrigerado",
  CONGELADO: "Congelado",
};

const STORAGE_ICON: Record<StorageTipo, React.ReactNode> = {
  AMBIENTE: <Box size={14} />,
  REFRIGERADO: <Refrigerator size={14} />,
  CONGELADO: <Snowflake size={14} />,
};

const STORAGE_ICON_COLOR: Record<StorageTipo, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

export function SitesManager({
  sites: initial,
  allSites,
  locations: locationsInitial,
}: {
  sites: Site[];
  allSites: Site[];
  locations: StorageLoc[];
}) {
  const [sites, setSites] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Site | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"LOJA" | "CD">("LOJA");
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [estoquePropio, setEstoquePropio] = useState(true);
  const [cdAbastecedorId, setCdAbastecedorId] = useState("");
  const [controleIdade, setControleIdade] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  // Armazenagem — aninhada por estabelecimento
  const [locations, setLocations] = useState(locationsInitial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [storagePending, startStorageTransition] = useTransition();
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageEditing, setStorageEditing] = useState<StorageLoc | null>(null);
  const [storageSiteId, setStorageSiteId] = useState<string | null>(null);
  const [storageNome, setStorageNome] = useState("");
  const [storageTipo, setStorageTipo] = useState<StorageTipo>("AMBIENTE");

  async function buscarCep() {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) {
      setError("CEP precisa de 8 dígitos.");
      return;
    }
    setError(null);
    setCepLoading(true);
    try {
      const res = await fetch(`/api/cep/${digits}`);
      const d = await res.json();
      if (res.ok) {
        if (d.rua) setRua(d.rua);
        if (d.cidade) setCidade(d.cidade);
        if (d.estado) setEstado(d.estado);
      } else {
        setError(d.error ?? "Não foi possível buscar o CEP.");
      }
    } catch {
      setError("Falha ao consultar o CEP. Verifique a conexão.");
    } finally {
      setCepLoading(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setNome("");
    setTipo("LOJA");
    setCep("");
    setRua("");
    setNumero("");
    setCidade("");
    setEstado("");
    setEstoquePropio(true);
    setCdAbastecedorId("");
    setControleIdade(false);
    setError(null);
    setAdding(true);
  }

  function openEdit(s: Site) {
    setAdding(false);
    setNome(s.nome);
    setTipo(s.tipo as "LOJA" | "CD");
    setCep(s.cep ?? "");
    setRua(s.rua ?? "");
    setNumero(s.numero ?? "");
    setCidade(s.cidade ?? "");
    setEstado(s.estado ?? "");
    setEstoquePropio(s.estoquePropio ?? true);
    setCdAbastecedorId(s.cdAbastecedorId ?? "");
    setControleIdade(s.controleIdade ?? false);
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
    if (!estoquePropio && !cdAbastecedorId && tipo === "LOJA") {
      setError("Escolha um CD para abastecer esta loja.");
      return;
    }

    const data = {
      nome: nomeClean,
      tipo,
      cep: cep || null,
      rua: rua || null,
      numero: numero || null,
      cidade: cidade || null,
      estado: estado || null,
      estoquePropio,
      cdAbastecedorId: cdAbastecedorId || null,
      controleIdade: tipo === "LOJA" && controleIdade,
    };

    startTransition(async () => {
      try {
        if (editing) {
          await updateSite(editing.id, data);
          setSites((prev) =>
            prev.map((s) =>
              s.id === editing.id ? { ...s, ...data } : s,
            ),
          );
        } else {
          const id = await createSite(data);
          setSites((prev) => [
            ...prev,
            { id, ...data, ativo: true },
          ]);
        }
        cancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  function toggle(s: Site) {
    if (sites.length === 1) return;
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

  function toggleExpanded(siteId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  }

  function openAddStorage(siteId: string) {
    setStorageEditing(null);
    setStorageSiteId(siteId);
    setStorageNome("");
    setStorageTipo("AMBIENTE");
    setStorageError(null);
  }

  function openEditStorage(l: StorageLoc) {
    setStorageEditing(l);
    setStorageSiteId(l.siteId);
    setStorageNome(l.nome);
    setStorageTipo(l.tipo);
    setStorageError(null);
  }

  function cancelStorage() {
    setStorageEditing(null);
    setStorageSiteId(null);
    setStorageError(null);
  }

  function saveStorage() {
    setStorageError(null);
    const nomeClean = storageNome.trim();
    if (nomeClean.length < 2) {
      setStorageError("Informe o nome (mín. 2 caracteres).");
      return;
    }
    if (!storageSiteId) return;
    const data = { nome: nomeClean, tipo: storageTipo, siteId: storageSiteId };
    startStorageTransition(async () => {
      try {
        if (storageEditing) {
          await updateStorageLocation(storageEditing.id, data);
          setLocations((prev) =>
            prev.map((l) => (l.id === storageEditing.id ? { ...l, ...data } : l)),
          );
        } else {
          const id = await createStorageLocation(data);
          setLocations((prev) => [
            ...prev,
            { id, ...data, ativo: true, stockCount: 0 },
          ]);
        }
        cancelStorage();
      } catch (e) {
        setStorageError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  function removeStorage(l: StorageLoc) {
    startStorageTransition(async () => {
      try {
        await deleteStorageLocation(l.id);
        setLocations((prev) => prev.filter((x) => x.id !== l.id));
      } catch (e) {
        setStorageError(e instanceof Error ? e.message : "Erro ao excluir.");
      }
    });
  }

  function toggleStorage(l: StorageLoc) {
    startStorageTransition(async () => {
      try {
        await toggleStorageLocationAtivo(l.id, !l.ativo);
        setLocations((prev) =>
          prev.map((x) => (x.id === l.id ? { ...x, ativo: !x.ativo } : x)),
        );
      } catch (e) {
        setStorageError(e instanceof Error ? e.message : "Erro ao alterar.");
      }
    });
  }

  const showForm = adding || editing !== null;
  const showStorageForm = storageSiteId !== null;
  const storageSiteNome = storageSiteId
    ? sites.find((s) => s.id === storageSiteId)?.nome
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Header com título + botão à direita */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Estabelecimentos</h2>
          <p className="text-xs text-muted">
            Lojas, pontos e CDs — com os locais de armazenagem de cada um.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          <Plus size={16} /> Adicionar
        </button>
      </div>

      {/* Sidepanel — adicionar / editar estabelecimento */}
      <Sheet
        open={showForm}
        onClose={cancel}
        title={editing ? "Editar estabelecimento" : "Novo estabelecimento"}
        description="Lojas, pontos autônomos e centros de distribuição."
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={cancel}
              className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={pending}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {pending && <Loader2 size={13} className="animate-spin" />}
              {editing ? "Salvar" : "Criar"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Nome */}
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

          {/* Tipo */}
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
                    "flex cursor-pointer flex-1 items-center justify-center gap-2 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                    tipo === t
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-line text-muted hover:bg-surface-2",
                  )}
                >
                  {t === "LOJA" ? <Store size={15} /> : <Warehouse size={15} />}
                  {t === "LOJA" ? "Loja / Ponto" : "CD"}
                </button>
              ))}
            </div>
          </div>

          {/* Endereço — opcional */}
          <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
              Endereço (opcional)
            </legend>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-faint">CEP</label>
              <div className="flex gap-2">
                <input
                  value={cep}
                  onChange={(e) => setCep(maskCep(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarCep())}
                  placeholder="00000-000"
                  inputMode="numeric"
                  maxLength={9}
                  className="flex-1 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                <button
                  type="button"
                  onClick={buscarCep}
                  disabled={cepLoading}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border border-line px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  {cepLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Search size={15} />
                  )}
                  Buscar
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={rua}
                onChange={(e) => setRua(e.target.value)}
                placeholder="Rua"
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="Número"
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:w-28"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="Cidade"
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
              <input
                value={estado}
                onChange={(e) => setEstado(e.target.value.toUpperCase())}
                placeholder="UF"
                maxLength={2}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:w-20"
              />
            </div>
          </fieldset>

          {/* Estoque — se é LOJA */}
          {tipo === "LOJA" && (
            <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
                Estoque
              </legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={estoquePropio}
                  onChange={(e) => setEstoquePropio(e.target.checked)}
                  className="cursor-pointer accent-brand"
                />
                Esta unidade possui estoque próprio
              </label>
              {!estoquePropio && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-faint">
                    Qual CD abastece?
                  </label>
                  <select
                    value={cdAbastecedorId}
                    onChange={(e) => setCdAbastecedorId(e.target.value)}
                    className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <option value="">Selecionar CD…</option>
                    {allSites
                      .filter((s) => s.tipo === "CD")
                      .map((cd) => (
                        <option key={cd.id} value={cd.id}>
                          {cd.nome}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </fieldset>
          )}

          {/* Venda restrita +18 — só faz sentido em loja (PDV) */}
          {tipo === "LOJA" && (
            <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
                Vendas
              </legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={controleIdade}
                  onChange={(e) => setControleIdade(e.target.checked)}
                  className="cursor-pointer accent-brand"
                />
                Controlar venda restrita para maiores de 18 anos
              </label>
              <p className="text-xs text-muted">
                Com isso marcado, o PDV exige a confirmação de maioridade ao vender
                produtos com restrição de idade.
              </p>
            </fieldset>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Sheet>

      {/* Sidepanel — adicionar / editar local de armazenagem */}
      <Sheet
        open={showStorageForm}
        onClose={cancelStorage}
        title={storageEditing ? "Editar local" : "Novo local de armazenagem"}
        description={storageSiteNome ? `Vinculado a ${storageSiteNome}.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={cancelStorage}
              className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={saveStorage}
              disabled={storagePending}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {storagePending && <Loader2 size={13} className="animate-spin" />}
              {storageEditing ? "Salvar" : "Criar"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              Nome
            </label>
            <input
              autoFocus
              value={storageNome}
              onChange={(e) => setStorageNome(e.target.value)}
              placeholder="Ex.: Câmara Fria, Geladeira 2"
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              Tipo
            </label>
            <div className="flex gap-2">
              {(["AMBIENTE", "REFRIGERADO", "CONGELADO"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setStorageTipo(t)}
                  className={cn(
                    "flex cursor-pointer flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border px-2 py-2.5 text-xs font-medium transition-colors",
                    storageTipo === t
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-line text-muted hover:bg-surface-2",
                  )}
                >
                  {STORAGE_ICON[t]} {STORAGE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {storageError && <p className="text-sm text-danger">{storageError}</p>}
        </div>
      </Sheet>

      {/* List */}
      {sites.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
          <Store size={32} className="text-faint" />
          <p className="text-sm text-muted">
            Nenhum estabelecimento cadastrado. Adicione o primeiro.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {sites.map((s, idx) => {
            const isOnly = sites.length === 1;
            const canToggle = !isOnly;
            const isExpanded = expanded.has(s.id);
            const siteLocations = locations.filter((l) => l.siteId === s.id);
            return (
              <div key={s.id} className={cn(idx !== 0 && "border-t border-line")}>
                <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
                  <button
                    onClick={() => toggleExpanded(s.id)}
                    className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                    title={isExpanded ? "Recolher armazenagem" : "Ver armazenagem"}
                  >
                    <ChevronDown
                      size={16}
                      className={cn("transition-transform", isExpanded && "rotate-180")}
                    />
                  </button>
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
                      {siteLocations.length > 0 && (
                        <span className="ml-2">
                          · {siteLocations.length} local{siteLocations.length !== 1 ? "is" : ""} de armazenagem
                        </span>
                      )}
                      {isOnly && (
                        <span className="ml-2 font-semibold text-warn">
                          (Único - não pode inativar)
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(s)}
                      className="grid cursor-pointer h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => toggle(s)}
                      disabled={pending || !canToggle}
                      className={cn(
                        "grid h-9 w-9 place-items-center rounded-lg transition-colors",
                        canToggle
                          ? s.ativo
                            ? "cursor-pointer text-ok hover:bg-ok-soft"
                            : "cursor-pointer text-muted hover:bg-surface-2"
                          : "cursor-not-allowed text-faint opacity-40",
                      )}
                      title={
                        isOnly
                          ? "Único estabelecimento não pode ser inativado"
                          : s.ativo
                            ? "Desativar"
                            : "Ativar"
                      }
                    >
                      {s.ativo ? (
                        <ToggleRight size={18} />
                      ) : (
                        <ToggleLeft size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-line bg-surface-2/40 px-5 py-3 pl-[4.5rem]">
                    <div className="flex items-center justify-between pb-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                        Armazenagem
                      </p>
                      <button
                        onClick={() => openAddStorage(s.id)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
                      >
                        <Plus size={13} /> Local
                      </button>
                    </div>

                    {siteLocations.length === 0 ? (
                      <p className="py-2 text-sm text-muted">
                        Nenhum local de armazenagem neste estabelecimento.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
                        {siteLocations.map((l, lIdx) => (
                          <div
                            key={l.id}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2",
                              lIdx !== 0 && "border-t border-line",
                              !l.ativo && "opacity-60",
                            )}
                          >
                            <span
                              className={cn(
                                "grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2",
                                STORAGE_ICON_COLOR[l.tipo],
                              )}
                            >
                              {STORAGE_ICON[l.tipo]}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm font-medium", l.ativo ? "text-ink" : "text-muted line-through")}>
                                {l.nome}
                              </p>
                              <p className="text-xs text-faint">
                                {STORAGE_LABEL[l.tipo]}
                                {l.stockCount > 0 && (
                                  <span className="ml-1.5 text-warn">
                                    · {l.stockCount} produto{l.stockCount !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditStorage(l)}
                                className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                                title="Editar"
                              >
                                <Pencil size={13} />
                              </button>
                              {l.stockCount === 0 ? (
                                <button
                                  onClick={() => removeStorage(l)}
                                  disabled={storagePending}
                                  className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                                  title="Excluir"
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => toggleStorage(l)}
                                  disabled={storagePending}
                                  className={cn(
                                    "grid h-7 w-7 place-items-center rounded-lg transition-colors",
                                    l.ativo
                                      ? "cursor-pointer text-ok hover:bg-ok-soft"
                                      : "cursor-pointer text-muted hover:bg-surface-2",
                                  )}
                                  title={l.ativo ? "Inativar" : "Ativar"}
                                >
                                  {l.ativo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
