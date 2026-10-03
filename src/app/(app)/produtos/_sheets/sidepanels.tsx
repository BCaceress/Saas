"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  ChevronRight,
  MoreVertical,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { maskCnpj, maskPhone } from "@/lib/masks";
import {
  createBrand,
  updateBrand,
  createCategory,
  updateCategory,
  setCategoryActive,
  deleteCategory,
  dependenciasDaCategoria,
  createSubcategory,
  updateSubcategory,
  setSubcategoryActive,
  deleteSubcategory,
  dependenciasDaSubcategoria,
  type Dependencias,
  createStorageLocation,
  createSupplier,
  updateSupplier,
  setSupplierActive,
} from "../actions";
import type {
  BrandOpt,
  CategoryNode,
  FiscalOpt,
  StorageOpt,
  SupplierRow,
} from "../_types";
import type { StorageType } from "@/generated/prisma";
import {
  StorageIcon,
  STORAGE_LABEL,
} from "@/components/app/armazenagem";
import { SkBarra } from "../_skeleton";

function useRefresh() {
  const router = useRouter();
  return () => router.refresh();
}

/**
 * Placeholder da lista enquanto os dados do painel estão em voo.
 *
 * O painel abre inteiro na hora — título, campo de cadastro, botão — e só a
 * LISTA fica em cinza. Antes o slide-over inteiro era trocado por um
 * "Carregando…", o que desmontava o Sheet e rodava a animação de entrada duas
 * vezes; o operador via o painel entrar, sumir e entrar de novo.
 */
function ListaSkeleton({
  linhas = 6,
  className = "mt-5 space-y-2",
}: {
  linhas?: number;
  className?: string;
}) {
  const larguras = ["w-1/2", "w-2/3", "w-3/5", "w-5/12", "w-7/12"];
  return (
    <>
      <ul className={className} aria-hidden>
        {Array.from({ length: linhas }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-line px-3 py-3"
          >
            <SkBarra className={cn("h-3.5", larguras[i % larguras.length])} />
            <span className="flex-1" />
            <SkBarra className="h-4 w-4" />
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        Carregando…
      </span>
    </>
  );
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
  const [editing, setEditing] = useState<{ id: string; nome: string } | null>(
    null,
  );
  const [editError, setEditError] = useState<string>();

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

  function saveEdit() {
    if (!editing) return;
    setEditError(undefined);
    start(async () => {
      try {
        await updateBrand({ id: editing.id, nome: editing.nome });
        setEditing(null);
        refresh();
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Falha ao salvar.");
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
          <li
            key={b.id}
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-ink"
          >
            <span className="flex-1">{b.nome}</span>
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Ações da marca"
                  className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <MoreVertical size={16} />
                </button>
              }
            >
              <MenuItem
                icon={<Pencil size={15} />}
                onClick={() => {
                  setEditError(undefined);
                  setEditing({ id: b.id, nome: b.nome });
                }}
              >
                Editar
              </MenuItem>
            </Menu>
          </li>
        ))}
      </ul>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Editar marca"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              onClick={saveEdit}
              disabled={
                pending || !editing || editing.nome.trim().length < 2
              }
            >
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        <Field label="Nome" htmlFor="marca-nome">
          <Input
            id="marca-nome"
            autoFocus
            value={editing?.nome ?? ""}
            onChange={(e) =>
              setEditing((cur) =>
                cur ? { ...cur, nome: e.target.value } : cur,
              )
            }
            onKeyDown={(e) => e.key === "Enter" && saveEdit()}
          />
        </Field>
        {editError && <p className="mt-2 text-xs text-muted">{editError}</p>}
      </Modal>
    </Sheet>
  );
}

// ── Categorias / subcategorias ─────────────────────────────
type SubModal = {
  mode: "new" | "edit";
  categoryId: string;
  categoriaNome: string;
  /** Só no modo "edit". */
  subId?: string;
  nome: string;
  /** Prefixo gravado — exibido travado (entra no SKU, não muda). */
  skuPrefix?: string;
  defaultStorageType: StorageType | null;
  defaultFiscalProfileId: string | null;
};

/** Edição de categoria: só o nome muda. O prefixo aparece, travado. */
type CatModal = { id: string; nome: string; skuPrefix: string };

/**
 * Exclusão pedida, com o resultado da checagem de vínculos.
 *
 * `dep: null` = ainda consultando. O diálogo abre já nesse estado em vez de
 * esperar: a contagem leva uma ida ao banco, e abrir só depois faz o clique
 * parecer perdido.
 */
type Exclusao = {
  tipo: "categoria" | "subcategoria";
  id: string;
  nome: string;
  /** Já está inativa? Então não oferece "inativar em vez de excluir". */
  inativa: boolean;
  dep: Dependencias | null;
};

const LABEL_TIPO = { categoria: "categoria", subcategoria: "subcategoria" } as const;

export function CategorySheet({
  open,
  onClose,
  tree,
  fiscalOpts = [],
  carregando,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tree: CategoryNode[];
  /** Perfis fiscais — alimentam o padrão da subcategoria na edição. */
  fiscalOpts?: FiscalOpt[];
  /** Árvore ainda em voo: mostra placeholder no lugar da lista. */
  carregando?: boolean;
  /** Recarrega a árvore de categorias (fonte fica fora do RSC — `router.refresh()` não alcança). */
  onChanged: () => void;
}) {
  const refresh = useRefresh();
  const [error, setError] = useState<string>();

  // Estados de "salvando" separados por ação. Um `useTransition` compartilhado
  // segurava o pending até o `router.refresh()` terminar — e o botão do modal
  // seguinte já nascia desabilitado com "Salvando…".
  const [savingCat, setSavingCat] = useState(false);
  const [savingSub, setSavingSub] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [catNome, setCatNome] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [modal, setModal] = useState<SubModal | null>(null);
  const [modalError, setModalError] = useState<string>();
  const [catModal, setCatModal] = useState<CatModal | null>(null);
  const [catModalError, setCatModalError] = useState<string>();
  const [exclusao, setExclusao] = useState<Exclusao | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  function toggle(id: string) {
    setOpenCat((cur) => (cur === id ? null : id));
  }

  async function addCat() {
    setError(undefined);
    if (catNome.trim().length < 2)
      return setError("Informe o nome da categoria.");
    setSavingCat(true);
    try {
      const r = await createCategory(catNome);
      setCatNome("");
      refresh();
      onChanged();
      if (r.jaExistia) setError(`«${r.nome}» já existia.`);
      else toast.success("Categoria criada", `«${r.nome}» adicionada.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSavingCat(false);
    }
  }

  async function saveSub() {
    if (!modal || savingSub) return;
    setModalError(undefined);
    setSavingSub(true);
    try {
      if (modal.mode === "edit" && modal.subId) {
        await updateSubcategory({
          id: modal.subId,
          nome: modal.nome,
          defaultStorageType: modal.defaultStorageType,
          defaultFiscalProfileId: modal.defaultFiscalProfileId,
        });
        toast.success("Subcategoria atualizada", `«${modal.nome}» salva.`);
      } else {
        await createSubcategory({
          categoryId: modal.categoryId,
          nome: modal.nome,
          defaultStorageType: modal.defaultStorageType,
          defaultFiscalProfileId: modal.defaultFiscalProfileId,
        });
        setOpenCat(modal.categoryId);
        toast.success("Subcategoria criada", `«${modal.nome}» adicionada.`);
      }
      setModal(null);
      refresh();
      onChanged();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSavingSub(false);
    }
  }

  async function toggleActive(subId: string, ativo: boolean) {
    setTogglingId(subId);
    try {
      await setSubcategoryActive(subId, ativo);
      refresh();
      onChanged();
      toast.success(ativo ? "Subcategoria reativada" : "Subcategoria inativada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    } finally {
      setTogglingId(null);
    }
  }

  async function saveCat() {
    if (!catModal || savingCat) return;
    setCatModalError(undefined);
    setSavingCat(true);
    try {
      const r = await updateCategory({ id: catModal.id, nome: catModal.nome });
      setCatModal(null);
      refresh();
      onChanged();
      toast.success(
        "Categoria renomeada",
        // O ajuste dos modelos salvos é silencioso por natureza (eles passariam
        // a vir vazios); dizer quantos foram corrigidos é o que transforma isso
        // em informação em vez de mágica.
        r.modelosAjustados > 0
          ? `«${catModal.nome}» salva. Ajustei ${r.modelosAjustados} ${r.modelosAjustados === 1 ? "relatório salvo que filtrava" : "relatórios salvos que filtravam"} pelo nome antigo.`
          : `«${catModal.nome}» salva.`,
      );
    } catch (e) {
      setCatModalError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSavingCat(false);
    }
  }

  async function toggleCatActive(id: string, ativo: boolean) {
    setTogglingId(id);
    try {
      await setCategoryActive(id, ativo);
      refresh();
      onChanged();
      toast.success(
        ativo ? "Categoria reativada" : "Categoria inativada",
        ativo
          ? undefined
          : "Sai das escolhas novas. As subcategorias dela seguem como estão.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    } finally {
      setTogglingId(null);
    }
  }

  /** Abre o diálogo JÁ e consulta os vínculos em seguida. */
  function pedirExclusao(
    tipo: Exclusao["tipo"],
    id: string,
    nome: string,
    inativa: boolean,
  ) {
    setExclusao({ tipo, id, nome, inativa, dep: null });
    const consulta =
      tipo === "categoria" ? dependenciasDaCategoria(id) : dependenciasDaSubcategoria(id);
    consulta
      .then((dep) => setExclusao((cur) => (cur && cur.id === id ? { ...cur, dep } : cur)))
      .catch(() => {
        setExclusao(null);
        toast.error("Não deu para conferir os vínculos", "Tente de novo.");
      });
  }

  async function confirmarExclusao() {
    if (!exclusao || excluindo) return;
    setExcluindo(true);
    try {
      if (exclusao.tipo === "categoria") await deleteCategory(exclusao.id);
      else await deleteSubcategory(exclusao.id);
      setExclusao(null);
      refresh();
      onChanged();
      toast.success(
        exclusao.tipo === "categoria" ? "Categoria excluída" : "Subcategoria excluída",
        `«${exclusao.nome}» saiu do cadastro.`,
      );
    } catch (e) {
      // O servidor reconfere: a tela pode ter sido aberta antes de alguém
      // cadastrar um produto aqui.
      toast.error("Não deu para excluir", e instanceof Error ? e.message : "Tente de novo.");
      setExclusao(null);
    } finally {
      setExcluindo(false);
    }
  }

  /** Saída do diálogo de bloqueio: inativa em vez de excluir. */
  async function inativarDoDialogo() {
    if (!exclusao) return;
    const { tipo, id } = exclusao;
    setExclusao(null);
    if (tipo === "categoria") await toggleCatActive(id, false);
    else await toggleActive(id, false);
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
          disabled={savingCat || catNome.trim().length < 2}
          className="shrink-0 gap-1"
        >
          <Plus size={16} /> {savingCat ? "Adicionando…" : "Adicionar"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-muted">{error}</p>}

      {carregando ? <ListaSkeleton /> : (
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
                  <span className={cn("flex-1", !c.ativo && "text-faint line-through")}>
                    {c.nome}
                  </span>
                  {!c.ativo && <Badge>Inativa</Badge>}
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
                        defaultStorageType: null,
                        defaultFiscalProfileId: null,
                      });
                    }}
                  >
                    Nova subcategoria
                  </MenuItem>
                  <MenuItem
                    icon={<Pencil size={15} />}
                    onClick={() => {
                      setCatModalError(undefined);
                      setCatModal({ id: c.id, nome: c.nome, skuPrefix: c.skuPrefix });
                    }}
                  >
                    Renomear
                  </MenuItem>
                  <MenuItem
                    icon={c.ativo ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                    onClick={() => toggleCatActive(c.id, !c.ativo)}
                    disabled={togglingId === c.id}
                  >
                    {c.ativo ? "Inativar" : "Reativar"}
                  </MenuItem>
                  <MenuItem
                    icon={<Trash2 size={15} />}
                    danger
                    onClick={() => pedirExclusao("categoria", c.id, c.nome, !c.ativo)}
                  >
                    Excluir
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
                        {/* Riscado = o operador inativou ESTA subcategoria.
                            Apagado sem risco = ela está ativa, mas a categoria
                            acima não — a distinção importa porque reativar a
                            categoria devolve esta, e desriscar a outra não. */}
                        <span
                          className={cn(
                            "flex-1 text-sm text-ink-2",
                            !s.disponivel && "text-faint",
                            !s.ativo && "line-through",
                          )}
                        >
                          {s.nome}
                        </span>
                        {!s.ativo ? (
                          <Badge>Inativa</Badge>
                        ) : !s.disponivel ? (
                          <Badge>Categoria inativa</Badge>
                        ) : null}
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
                                skuPrefix: s.skuPrefix,
                                defaultStorageType: s.defaultStorageType,
                                defaultFiscalProfileId: s.defaultFiscalProfileId,
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
                            disabled={togglingId === s.id}
                          >
                            {s.ativo ? "Inativar" : "Reativar"}
                          </MenuItem>
                          <MenuItem
                            icon={<Trash2 size={15} />}
                            danger
                            onClick={() =>
                              pedirExclusao("subcategoria", s.id, s.nome, !s.ativo)
                            }
                          >
                            Excluir
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
      )}

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
              disabled={savingSub}
            >
              Cancelar
            </Button>
            <Button
              onClick={saveSub}
              disabled={savingSub || !modal || modal.nome.trim().length < 2}
            >
              {savingSub ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
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

          {modal?.skuPrefix && <PrefixoTravado prefixo={modal.skuPrefix} />}

          {/* Os dois padrões só podiam ser escolhidos na CRIAÇÃO: errou a
              armazenagem, não consertava mais. São sugestões para o cadastro
              novo — produto já cadastrado não é tocado. */}
          <Field
            label="Armazenagem sugerida"
            htmlFor="sub-storage"
            hint="Preenchida no cadastro de produto novo desta subcategoria."
          >
            <Select
              id="sub-storage"
              value={modal?.defaultStorageType ?? ""}
              onChange={(e) =>
                setModal((m) =>
                  m
                    ? {
                        ...m,
                        defaultStorageType: (e.target.value || null) as StorageType | null,
                      }
                    : m,
                )
              }
            >
              <option value="">Sem sugestão</option>
              {(["AMBIENTE", "REFRIGERADO", "CONGELADO"] as StorageType[]).map((t) => (
                <option key={t} value={t}>
                  {STORAGE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>

          {fiscalOpts.length > 0 && (
            <Field
              label="Perfil fiscal padrão"
              htmlFor="sub-fiscal"
              hint="Herdado pelo produto que não define o seu."
            >
              <Select
                id="sub-fiscal"
                value={modal?.defaultFiscalProfileId ?? ""}
                onChange={(e) =>
                  setModal((m) =>
                    m ? { ...m, defaultFiscalProfileId: e.target.value || null } : m,
                  )
                }
              >
                <option value="">Sem perfil padrão</option>
                {fiscalOpts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                    {f.ncm ? ` · NCM ${f.ncm}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {modalError && <p className="mt-2 text-sm text-danger">{modalError}</p>}
      </Modal>

      {/* ── Renomear categoria ── */}
      <Modal
        open={!!catModal}
        onClose={() => setCatModal(null)}
        title="Renomear categoria"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setCatModal(null)} disabled={savingCat}>
              Cancelar
            </Button>
            <Button
              onClick={saveCat}
              disabled={savingCat || !catModal || catModal.nome.trim().length < 2}
            >
              {savingCat ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Nome" htmlFor="cat-nome">
            <Input
              id="cat-nome"
              autoFocus
              value={catModal?.nome ?? ""}
              onChange={(e) => setCatModal((m) => (m ? { ...m, nome: e.target.value } : m))}
              onKeyDown={(e) => e.key === "Enter" && saveCat()}
              placeholder="Ex.: Bebidas"
            />
          </Field>
          {catModal && <PrefixoTravado prefixo={catModal.skuPrefix} />}
          <p className="text-xs text-muted">
            Relatórios salvos que filtram por esta categoria são ajustados para o
            nome novo automaticamente.
          </p>
        </div>
        {catModalError && <p className="mt-2 text-sm text-danger">{catModalError}</p>}
      </Modal>

      <DialogoExclusao
        exclusao={exclusao}
        excluindo={excluindo}
        onClose={() => setExclusao(null)}
        onConfirmar={confirmarExclusao}
        onInativar={inativarDoDialogo}
      />
    </Sheet>
  );
}

/**
 * Prefixo do SKU, exibido e travado.
 *
 * Mostrar em vez de esconder porque o operador reconhece o prefixo nas
 * etiquetas e vai procurá-lo aqui. Travado porque `Product.sku` é string
 * GRAVADA ("BEB-CER-6489"), não derivada: mudar o prefixo faria os SKUs novos
 * discordarem das etiquetas de prateleira, planilhas e notas já emitidas.
 */
function PrefixoTravado({ prefixo }: { prefixo: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-line bg-surface-2/40 px-3 py-2.5">
      <span className="font-mono text-sm font-medium text-ink">{prefixo}</span>
      <span className="min-w-0 flex-1 text-xs text-muted">
        Prefixo usado nos SKUs já gerados. Não muda — os códigos impressos nas
        etiquetas continuariam com o antigo.
      </span>
    </div>
  );
}

/**
 * Exclusão de categoria/subcategoria.
 *
 * Três telas num diálogo, porque são três respostas diferentes e misturá-las
 * produziria o genérico "não é possível excluir":
 *
 *  1. sem vínculo  → confirma e exclui;
 *  2. com vínculo ajustável → mostra a CONTAGEM, o LINK para a lista de
 *     trabalho e o atalho para inativar;
 *  3. com vínculo histórico (inventário) → diz que nunca vai dar, e some com o
 *     "ajuste e volte". Mandar o operador numa tarefa impossível é pior que
 *     dizer não.
 */
function DialogoExclusao({
  exclusao,
  excluindo,
  onClose,
  onConfirmar,
  onInativar,
}: {
  exclusao: Exclusao | null;
  excluindo: boolean;
  onClose: () => void;
  onConfirmar: () => void;
  onInativar: () => void;
}) {
  const dep = exclusao?.dep ?? null;
  const carregando = !!exclusao && dep === null;
  const livre = !!dep?.podeExcluir;
  const tipo = exclusao ? LABEL_TIPO[exclusao.tipo] : "";

  return (
    <Modal
      open={!!exclusao}
      onClose={onClose}
      title={livre ? `Excluir ${tipo}?` : `Não dá para excluir «${exclusao?.nome ?? ""}»`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={excluindo}>
            {livre ? "Cancelar" : "Fechar"}
          </Button>
          {/* Inativar é a saída real na prática — fica ao lado do "fechar", não
              escondido num menu depois de o operador já ter desistido. */}
          {!carregando && !livre && !exclusao?.inativa && (
            <Button variant="secondary" onClick={onInativar}>
              Inativar em vez de excluir
            </Button>
          )}
          {livre && (
            <Button variant="danger" onClick={onConfirmar} disabled={excluindo}>
              {excluindo ? "Excluindo…" : "Excluir"}
            </Button>
          )}
        </div>
      }
    >
      {carregando && <p className="text-sm text-muted">Conferindo os vínculos…</p>}

      {!carregando && livre && (
        <p className="text-sm text-ink-2">
          «{exclusao?.nome}» não está em uso em nenhum produto
          {exclusao?.tipo === "categoria" ? ", subcategoria ou inventário" : ""}. A
          exclusão é definitiva.
        </p>
      )}

      {!carregando && !livre && dep && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2.5">
            {dep.motivos.map((m) => (
              <li key={m.tipo} className="flex items-start gap-2.5 text-sm">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <p className="text-ink-2">{m.texto}</p>
                  {m.href && (
                    <Link
                      href={m.href}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-strong underline-offset-2 hover:underline"
                    >
                      {m.tipo === "produtos"
                        ? `Ver ${m.quantidade === 1 ? "o produto" : `os ${m.quantidade} produtos`}`
                        : "Ver os inventários"}
                      <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* A dica muda com o motivo. "Use a edição em lote" numa categoria
              sem produto nenhum mandaria o operador a uma tela vazia. */}
          {dep.definitivo ? (
            <p className="text-xs text-muted">
              Inventário não se altera depois de criado, então esta categoria não
              poderá ser excluída. Inative para tirá-la das escolhas — o histórico
              continua intacto.
            </p>
          ) : dep.motivos.some((m) => m.tipo === "produtos") ? (
            <p className="text-xs text-muted">
              Na listagem de produtos, selecione todos e use a edição em lote para
              trocar a subcategoria de uma vez. Depois volte aqui.
            </p>
          ) : (
            <p className="text-xs text-muted">
              Exclua as subcategorias primeiro — elas estão listadas abaixo da
              categoria, neste painel.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Armazenagem ────────────────────────────────────────────
export function StorageSheet({
  open,
  onClose,
  locations,
  sites,
  carregando,
}: {
  open: boolean;
  onClose: () => void;
  locations: StorageOpt[];
  sites: { id: string; nome: string }[];
  /** Locais ainda em voo: mostra placeholder no lugar da lista. */
  carregando?: boolean;
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
      {carregando ? <ListaSkeleton linhas={4} /> : (
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
              <StorageIcon tipo={l.tipo} size={12} />
              {STORAGE_LABEL[l.tipo]}
            </Badge>
          </li>
        ))}
      </ul>
      )}
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
  carregando,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: SupplierRow[];
  /** Fornecedores ainda em voo: mostra placeholder no lugar da lista. */
  carregando?: boolean;
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
      {carregando ? <ListaSkeleton linhas={5} className="mt-3 space-y-2" /> : (
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
      )}

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
