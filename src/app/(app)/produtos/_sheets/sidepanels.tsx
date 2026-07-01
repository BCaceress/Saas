"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Snowflake,
  Refrigerator,
  Box,
  ChevronRight,
  MoreVertical,
  Pencil,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { maskCnpj, maskPhone } from "@/lib/masks";
import {
  createBrand,
  createCategory,
  createSubcategory,
  updateSubcategory,
  setSubcategoryActive,
  createStorageLocation,
  createSupplier,
  updateSupplier,
  setSupplierActive,
} from "../actions";
import type {
  BrandOpt,
  CategoryNode,
  StorageOpt,
  SupplierRow,
} from "../_types";
import type { StorageType } from "@/generated/prisma";

function useRefresh() {
  const router = useRouter();
  return () => router.refresh();
}

// ── Marcas ─────────────────────────────────────────────────
export function BrandSheet({
  open,
  onClose,
  brands,
}: {
  open: boolean;
  onClose: () => void;
  brands: BrandOpt[];
}) {
  const refresh = useRefresh();
  const [nome, setNome] = useState("");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const list = brands.filter((b) =>
    b.nome.toLowerCase().includes(q.toLowerCase()),
  );

  function add() {
    setError(undefined);
    start(async () => {
      try {
        const r = await createBrand(nome);
        setNome("");
        refresh();
        if (r.jaExistia)
          setError(`«${r.nome}» já existia — vinculei à existente.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Marcas"
      description="Cadastre fabricantes. Duplicatas por digitação são unificadas."
    >
      <div className="flex gap-2">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nova marca"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button
          onClick={add}
          disabled={pending || nome.trim().length < 2}
          className="shrink-0 gap-1"
        >
          <Plus size={16} /> Adicionar
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-muted">{error}</p>}
      <div className="relative mt-5">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar marca"
          className="pl-9"
        />
      </div>
      <ul className="mt-3 divide-y divide-line rounded-[var(--radius-sm)] border border-line">
        {list.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted">
            Nenhuma marca ainda.
          </li>
        )}
        {list.map((b) => (
          <li key={b.id} className="px-3 py-2.5 text-sm text-ink">
            {b.nome}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ── Categorias / subcategorias ─────────────────────────────
type SubModal =
  | {
      mode: "new";
      categoryId: string;
      categoriaNome: string;
      subId?: undefined;
      nome: string;
    }
  | {
      mode: "edit";
      categoryId: string;
      categoriaNome: string;
      subId: string;
      nome: string;
    };

export function CategorySheet({
  open,
  onClose,
  tree,
}: {
  open: boolean;
  onClose: () => void;
  tree: CategoryNode[];
}) {
  const refresh = useRefresh();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const [catNome, setCatNome] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [modal, setModal] = useState<SubModal | null>(null);
  const [modalError, setModalError] = useState<string>();

  function toggle(id: string) {
    setOpenCat((cur) => (cur === id ? null : id));
  }

  function addCat() {
    setError(undefined);
    if (catNome.trim().length < 2)
      return setError("Informe o nome da categoria.");
    start(async () => {
      try {
        const r = await createCategory(catNome);
        setCatNome("");
        refresh();
        if (r.jaExistia) setError(`«${r.nome}» já existia.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function saveSub() {
    if (!modal) return;
    setModalError(undefined);
    start(async () => {
      try {
        if (modal.mode === "edit") {
          await updateSubcategory({ id: modal.subId, nome: modal.nome });
        } else {
          await createSubcategory({
            categoryId: modal.categoryId,
            nome: modal.nome,
          });
          setOpenCat(modal.categoryId);
        }
        setModal(null);
        refresh();
      } catch (e) {
        setModalError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function toggleActive(subId: string, ativo: boolean) {
    start(async () => {
      try {
        await setSubcategoryActive(subId, ativo);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha.");
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Categorias"
      description="Clique numa categoria para ver e gerenciar suas subcategorias."
    >
      <div className="flex gap-2">
        <Input
          value={catNome}
          onChange={(e) => setCatNome(e.target.value)}
          placeholder="Nova categoria"
          onKeyDown={(e) => e.key === "Enter" && addCat()}
        />
        <Button
          onClick={addCat}
          disabled={pending || catNome.trim().length < 2}
          className="shrink-0 gap-1"
        >
          <Plus size={16} /> Adicionar
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-muted">{error}</p>}

      <ul className="mt-5 space-y-2">
        {tree.length === 0 && (
          <li className="rounded-[var(--radius-sm)] border border-line px-3 py-6 text-center text-sm text-muted">
            Nenhuma categoria ainda. Cadastre a primeira acima.
          </li>
        )}
        {tree.map((c) => {
          const isOpen = openCat === c.id;
          return (
            <li
              key={c.id}
              className="overflow-hidden rounded-[var(--radius-sm)] border border-line"
            >
              <div className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-expanded={isOpen}
                  className="flex flex-1 cursor-pointer items-center gap-2 px-3 py-3 text-left text-sm font-medium text-ink hover:bg-surface-2"
                >
                  <ChevronRight
                    size={16}
                    className={cn(
                      "text-muted transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <span className="flex-1">{c.nome}</span>
                  <span className="text-xs text-faint">
                    {c.subcategorias.length} subcat.
                  </span>
                </button>
                <Menu
                  align="end"
                  trigger={
                    <button
                      type="button"
                      aria-label="Ações da categoria"
                      className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      <MoreVertical size={16} />
                    </button>
                  }
                >
                  <MenuItem
                    icon={<Plus size={15} />}
                    onClick={() => {
                      setModalError(undefined);
                      setOpenCat(c.id);
                      setModal({
                        mode: "new",
                        categoryId: c.id,
                        categoriaNome: c.nome,
                        nome: "",
                      });
                    }}
                  >
                    Nova subcategoria
                  </MenuItem>
                </Menu>
              </div>
              {isOpen && (
                <div className="border-t border-line bg-surface-2/40">
                  <ul className="divide-y divide-line">
                    {c.subcategorias.length === 0 && (
                      <li className="px-3 py-3 text-xs text-muted">
                        Sem subcategorias ainda.
                      </li>
                    )}
                    {c.subcategorias.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center gap-2 px-3 py-2.5"
                      >
                        <span
                          className={cn(
                            "flex-1 text-sm text-ink-2",
                            !s.ativo && "text-faint line-through",
                          )}
                        >
                          {s.nome}
                        </span>
                        {!s.ativo && <Badge>Inativa</Badge>}
                        <Menu
                          align="end"
                          trigger={
                            <button
                              type="button"
                              aria-label="Ações da subcategoria"
                              className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface hover:text-ink"
                            >
                              <MoreVertical size={16} />
                            </button>
                          }
                        >
                          <MenuItem
                            icon={<Pencil size={15} />}
                            onClick={() => {
                              setModalError(undefined);
                              setModal({
                                mode: "edit",
                                categoryId: c.id,
                                categoriaNome: c.nome,
                                subId: s.id,
                                nome: s.nome,
                              });
                            }}
                          >
                            Editar
                          </MenuItem>
                          <MenuItem
                            icon={
                              s.ativo ? (
                                <Archive size={15} />
                              ) : (
                                <ArchiveRestore size={15} />
                              )
                            }
                            onClick={() => toggleActive(s.id, !s.ativo)}
                          >
                            {s.ativo ? "Inativar" : "Reativar"}
                          </MenuItem>
                        </Menu>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={
          modal?.mode === "edit" ? "Editar subcategoria" : "Nova subcategoria"
        }
        description={modal ? `Categoria: ${modal.categoriaNome}` : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setModal(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              onClick={saveSub}
              disabled={pending || !modal || modal.nome.trim().length < 2}
            >
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        <Field
          label="Nome"
          htmlFor="sub-nome"
          hint="Não pode repetir na mesma categoria."
        >
          <Input
            id="sub-nome"
            autoFocus
            value={modal?.nome ?? ""}
            onChange={(e) =>
              setModal((m) => (m ? { ...m, nome: e.target.value } : m))
            }
            onKeyDown={(e) => e.key === "Enter" && saveSub()}
            placeholder="Ex.: Cervejas"
          />
        </Field>
        {modalError && <p className="mt-2 text-sm text-danger">{modalError}</p>}
      </Modal>
    </Sheet>
  );
}

// ── Armazenagem ────────────────────────────────────────────
const STORAGE_ICON: Record<StorageType, React.ReactNode> = {
  AMBIENTE: <Box size={14} />,
  REFRIGERADO: <Refrigerator size={14} />,
  CONGELADO: <Snowflake size={14} />,
};
const STORAGE_LABEL: Record<StorageType, string> = {
  AMBIENTE: "Ambiente",
  REFRIGERADO: "Refrigerado",
  CONGELADO: "Congelado",
};
const STORAGE_ICON_COLOR: Record<StorageType, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

export function StorageSheet({
  open,
  onClose,
  locations,
  sites,
}: {
  open: boolean;
  onClose: () => void;
  locations: StorageOpt[];
  sites: { id: string; nome: string }[];
}) {
  const refresh = useRefresh();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<StorageType>("AMBIENTE");
  const [siteId, setSiteId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const effectiveSiteId = siteId || sites[0]?.id || "";

  function add() {
    setError(undefined);
    if (!effectiveSiteId) {
      setError("Cadastre um estabelecimento antes de criar locais.");
      return;
    }
    start(async () => {
      try {
        await createStorageLocation({ nome, tipo, siteId: effectiveSiteId });
        setNome("");
        setSiteId("");
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha.");
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Armazenagem"
      description="Locais físicos. Para gestão completa acesse Configurações → Sites."
    >
      <div className="flex flex-col gap-3">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Geladeira 2"
        />
        {sites.length > 1 && (
          <Select value={effectiveSiteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        )}
        <Select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as StorageType)}
        >
          {(["AMBIENTE", "REFRIGERADO", "CONGELADO"] as StorageType[]).map(
            (t) => (
              <option key={t} value={t}>
                {STORAGE_LABEL[t]}
              </option>
            ),
          )}
        </Select>
        <Button
          onClick={add}
          disabled={pending || nome.trim().length < 2}
          className="gap-1"
        >
          <Plus size={16} /> Adicionar local
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-5 divide-y divide-line rounded-[var(--radius-sm)] border border-line">
        {locations.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted">
            Nenhum local ainda.
          </li>
        )}
        {locations.map((l) => (
          <li
            key={l.id}
            className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-ink"
          >
            <span className="min-w-0 truncate">
              {l.nome}
              {sites.length > 1 && l.siteNome && (
                <span className="ml-1.5 text-xs text-faint">— {l.siteNome}</span>
              )}
            </span>
            <Badge tone="neutral">
              <span className={STORAGE_ICON_COLOR[l.tipo]}>{STORAGE_ICON[l.tipo]}</span>
              {STORAGE_LABEL[l.tipo]}
            </Badge>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ── Fornecedores ───────────────────────────────────────────
type SupplierForm = {
  id?: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  email: string;
  telefone: string;
  contato: string;
  website: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
};
const emptyForm = (cnpj = ""): SupplierForm => ({
  cnpj,
  razaoSocial: "",
  nomeFantasia: "",
  email: "",
  telefone: "",
  contato: "",
  website: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  municipio: "",
  uf: "",
});
function formFromRow(s: SupplierRow): SupplierForm {
  return {
    id: s.id,
    cnpj: s.cnpj ? maskCnpj(s.cnpj) : "",
    razaoSocial: s.razaoSocial,
    nomeFantasia: s.nomeFantasia ?? "",
    email: s.email ?? "",
    telefone: s.telefone ?? "",
    contato: s.nomeContatoPrincipal ?? "",
    website: s.website ?? "",
    cep: s.cep ?? "",
    logradouro: s.logradouro ?? "",
    numero: s.numero ?? "",
    complemento: s.complemento ?? "",
    bairro: s.bairro ?? "",
    municipio: s.municipio ?? "",
    uf: s.uf ?? "",
  };
}

export function SupplierSheet({
  open,
  onClose,
  suppliers,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: SupplierRow[];
}) {
  const refresh = useRefresh();
  const [pending, start] = useTransition();
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [error, setError] = useState<string>();
  const [q, setQ] = useState("");

  const [cnpj, setCnpj] = useState("");
  const [form, setForm] = useState<SupplierForm | null>(null);
  const [modalNote, setModalNote] = useState<string>();
  const [modalError, setModalError] = useState<string>();

  async function buscarCnpj() {
    setError(undefined);
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14) return setError("CNPJ precisa de 14 dígitos.");
    setLoadingCnpj(true);
    setModalNote(undefined);
    setModalError(undefined);
    try {
      const res = await fetch(`/api/fornecedores/cnpj/${digits}`);
      const d = await res.json();
      if (res.ok) {
        setForm({
          ...emptyForm(maskCnpj(cnpj)),
          razaoSocial: d.razaoSocial || "",
          nomeFantasia: d.nomeFantasia || "",
          email: d.email || "",
          telefone: d.telefone ? maskPhone(d.telefone) : "",
          cep: d.cep || "",
          logradouro: d.logradouro || "",
          numero: d.numero || "",
          complemento: d.complemento || "",
          bairro: d.bairro || "",
          municipio: d.municipio || "",
          uf: d.uf || "",
        });
        setModalNote("Confira os dados e complete o que faltar.");
      } else if (res.status === 404) {
        // Não achou na Receita: abre o modal para cadastro manual.
        setForm(emptyForm(maskCnpj(cnpj)));
        setModalNote("CNPJ não encontrado na Receita — preencha manualmente.");
      } else {
        // Transiente (rate limit / indisponível): mantém no painel para repetir.
        setError(d.error ?? "Consulta indisponível. Tente de novo.");
      }
    } catch {
      setError(
        "Falha ao consultar o CNPJ. Verifique a conexão e tente de novo.",
      );
    } finally {
      setLoadingCnpj(false);
    }
  }

  function upd<K extends keyof SupplierForm>(k: K, v: SupplierForm[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function salvar() {
    if (!form) return;
    setModalError(undefined);
    const payload = {
      cnpj: form.cnpj,
      razaoSocial: form.razaoSocial,
      nomeFantasia: form.nomeFantasia,
      email: form.email,
      telefone: form.telefone,
      nomeContatoPrincipal: form.contato,
      website: form.website,
      cep: form.cep,
      logradouro: form.logradouro,
      numero: form.numero,
      complemento: form.complemento,
      bairro: form.bairro,
      municipio: form.municipio,
      uf: form.uf,
    };
    start(async () => {
      try {
        if (form.id) await updateSupplier(form.id, payload);
        else await createSupplier(payload);
        setForm(null);
        setCnpj("");
        refresh();
      } catch (e) {
        setModalError(
          e instanceof Error ? e.message : "Informe ao menos a razão social.",
        );
      }
    });
  }

  function toggleActive(s: SupplierRow) {
    start(async () => {
      try {
        await setSupplierActive(s.id, !s.ativo);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha.");
      }
    });
  }

  const list = suppliers.filter((s) =>
    `${s.razaoSocial} ${s.nomeFantasia ?? ""} ${s.cnpj ?? ""}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Fornecedores"
      description="Pesquise pelo CNPJ e finalize o cadastro no formulário."
      width="lg"
    >
      <Field label="CNPJ" htmlFor="cnpj">
        <div className="flex gap-2">
          <Input
            id="cnpj"
            value={cnpj}
            onChange={(e) => setCnpj(maskCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            maxLength={18}
            onKeyDown={(e) => e.key === "Enter" && buscarCnpj()}
          />
          <Button
            type="button"
            onClick={buscarCnpj}
            disabled={loadingCnpj}
            className="shrink-0 gap-1.5"
          >
            <Search size={16} /> {loadingCnpj ? "Buscando…" : "Pesquisar"}
          </Button>
        </div>
      </Field>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="relative mt-6">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar fornecedor cadastrado"
          className="pl-9"
        />
      </div>
      <ul className="mt-3 divide-y divide-line rounded-[var(--radius-sm)] border border-line">
        {list.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted">
            Nenhum fornecedor ainda.
          </li>
        )}
        {list.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-sm font-medium text-ink",
                  !s.ativo && "text-faint line-through",
                )}
              >
                {s.nomeFantasia || s.razaoSocial}
              </p>
              <p className="text-xs text-muted">
                {s.cnpj ? maskCnpj(s.cnpj) : "sem CNPJ"}
                {s.telefone ? ` · ${maskPhone(s.telefone)}` : ""}
              </p>
            </div>
            {!s.ativo && <Badge>Inativo</Badge>}
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Ações do fornecedor"
                  className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <MoreVertical size={16} />
                </button>
              }
            >
              <MenuItem
                icon={<Pencil size={15} />}
                onClick={() => {
                  setModalNote(undefined);
                  setModalError(undefined);
                  setForm(formFromRow(s));
                }}
              >
                Editar
              </MenuItem>
              <MenuItem
                icon={
                  s.ativo ? <Archive size={15} /> : <ArchiveRestore size={15} />
                }
                onClick={() => toggleActive(s)}
              >
                {s.ativo ? "Inativar" : "Reativar"}
              </MenuItem>
            </Menu>
          </li>
        ))}
      </ul>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar fornecedor" : "Finalizar fornecedor"}
        description={form?.cnpj ? `CNPJ ${form.cnpj}` : undefined}
        width="2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setForm(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={pending} className="gap-1">
              <Plus size={16} /> {pending ? "Salvando…" : "Salvar fornecedor"}
            </Button>
          </div>
        }
      >
        {modalNote && (
          <p className="mb-3 rounded-[var(--radius-sm)] bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            {modalNote}
          </p>
        )}
        {form && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12 sm:col-span-7" label="Razão social" htmlFor="m-razao">
              <Input id="m-razao" value={form.razaoSocial} onChange={(e) => upd("razaoSocial", e.target.value)} />
            </Field>
            <Field className="col-span-12 sm:col-span-5" label="Nome fantasia" htmlFor="m-fant">
              <Input id="m-fant" value={form.nomeFantasia} onChange={(e) => upd("nomeFantasia", e.target.value)} />
            </Field>

            <Field className="col-span-12 sm:col-span-4" label="Telefone / WhatsApp" htmlFor="m-tel">
              <Input id="m-tel" value={form.telefone} onChange={(e) => upd("telefone", maskPhone(e.target.value))} inputMode="numeric" maxLength={15} placeholder="(11) 99999-9999" />
            </Field>
            <Field className="col-span-12 sm:col-span-4" label="E-mail" htmlFor="m-mail">
              <Input id="m-mail" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} />
            </Field>
            <Field className="col-span-12 sm:col-span-4" label="Contato principal" htmlFor="m-cont">
              <Input id="m-cont" value={form.contato} onChange={(e) => upd("contato", e.target.value)} />
            </Field>

            <Field className="col-span-12" label="Website" htmlFor="m-site">
              <Input id="m-site" value={form.website} onChange={(e) => upd("website", e.target.value)} placeholder="https://" />
            </Field>

            <p className="col-span-12 mt-1 text-[11px] font-medium uppercase tracking-wider text-faint">Endereço</p>

            <Field className="col-span-4 sm:col-span-3" label="CEP" htmlFor="m-cep">
              <Input id="m-cep" value={form.cep} onChange={(e) => upd("cep", e.target.value)} inputMode="numeric" />
            </Field>
            <Field className="col-span-8 sm:col-span-7" label="Logradouro" htmlFor="m-log">
              <Input id="m-log" value={form.logradouro} onChange={(e) => upd("logradouro", e.target.value)} />
            </Field>
            <Field className="col-span-12 sm:col-span-2" label="Número" htmlFor="m-num">
              <Input id="m-num" value={form.numero} onChange={(e) => upd("numero", e.target.value)} />
            </Field>

            <Field className="col-span-6 sm:col-span-5" label="Bairro" htmlFor="m-bairro">
              <Input id="m-bairro" value={form.bairro} onChange={(e) => upd("bairro", e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-4" label="Município" htmlFor="m-mun">
              <Input id="m-mun" value={form.municipio} onChange={(e) => upd("municipio", e.target.value)} />
            </Field>
            <Field className="col-span-4 sm:col-span-1" label="UF" htmlFor="m-uf">
              <Input id="m-uf" value={form.uf} onChange={(e) => upd("uf", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
            </Field>
            <Field className="col-span-8 sm:col-span-2" label="Compl." htmlFor="m-comp">
              <Input id="m-comp" value={form.complemento} onChange={(e) => upd("complemento", e.target.value)} />
            </Field>
          </div>
        )}
        {modalError && <p className="mt-2 text-sm text-danger">{modalError}</p>}
      </Modal>
    </Sheet>
  );
}
