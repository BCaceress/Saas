"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, MoreVertical, Pencil, Trash2, Scale } from "lucide-react";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import {
  createFiscalProfile,
  updateFiscalProfile,
  deleteFiscalProfile,
  setSubcategoryFiscalProfile,
} from "./actions";
import { createSubcategory } from "../../produtos/actions";

export type FiscalProfileRow = {
  id: string;
  nome: string;
  ncm: string;
  cest: string | null;
  origem: string;
  csosn: string | null;
  cst: string | null;
  cstPis: string | null;
  cstCofins: string | null;
  aliquotaIcms: number | null;
  temSt: boolean;
  precisaRevisao: boolean;
};

export type CategoryWithSub = {
  id: string;
  nome: string;
  subcategorias: {
    id: string;
    nome: string;
    ativo: boolean;
    defaultFiscalProfileId: string | null;
  }[];
};

type ProfileForm = {
  id?: string;
  nome: string;
  ncm: string;
  cest: string;
  origem: string;
  csosn: string;
  cst: string;
  cstPis: string;
  cstCofins: string;
  aliquotaIcms: string;
  temSt: boolean;
  precisaRevisao: boolean;
};

const emptyProfileForm: ProfileForm = {
  nome: "",
  ncm: "",
  cest: "",
  origem: "0",
  csosn: "",
  cst: "",
  cstPis: "",
  cstCofins: "",
  aliquotaIcms: "",
  temSt: false,
  precisaRevisao: false,
};

function formFromProfile(p: FiscalProfileRow): ProfileForm {
  return {
    id: p.id,
    nome: p.nome,
    ncm: p.ncm,
    cest: p.cest ?? "",
    origem: p.origem,
    csosn: p.csosn ?? "",
    cst: p.cst ?? "",
    cstPis: p.cstPis ?? "",
    cstCofins: p.cstCofins ?? "",
    aliquotaIcms: p.aliquotaIcms != null ? String(p.aliquotaIcms) : "",
    temSt: p.temSt,
    precisaRevisao: p.precisaRevisao,
  };
}

export function FiscalManager({
  fiscalProfiles: initialProfiles,
  categories: initialCategories,
}: {
  fiscalProfiles: FiscalProfileRow[];
  categories: CategoryWithSub[];
}) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initialProfiles);
  const [categories, setCategories] = useState(initialCategories);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const [form, setForm] = useState<ProfileForm | null>(null);
  const [formError, setFormError] = useState<string>();

  const [subModal, setSubModal] = useState<{ categoryId: string; nome: string } | null>(null);
  const [subError, setSubError] = useState<string>();

  function refresh() {
    router.refresh();
  }

  function upd<K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function salvarPerfil() {
    if (!form) return;
    setFormError(undefined);
    const payload = {
      nome: form.nome,
      ncm: form.ncm,
      cest: form.cest,
      origem: form.origem,
      csosn: form.csosn,
      cst: form.cst,
      cstPis: form.cstPis,
      cstCofins: form.cstCofins,
      aliquotaIcms: form.aliquotaIcms ? Number(form.aliquotaIcms) : null,
      temSt: form.temSt,
      precisaRevisao: form.precisaRevisao,
    };
    start(async () => {
      try {
        if (form.id) {
          await updateFiscalProfile(form.id, payload);
          setProfiles((prev) =>
            prev.map((p) => (p.id === form.id ? { ...p, ...payload } : p)),
          );
        } else {
          const id = await createFiscalProfile(payload);
          setProfiles((prev) => [...prev, { id, ...payload }]);
        }
        setForm(null);
        refresh();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function excluirPerfil(id: string) {
    setError(undefined);
    start(async () => {
      try {
        await deleteFiscalProfile(id);
        setProfiles((prev) => prev.filter((p) => p.id !== id));
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao excluir.");
      }
    });
  }

  function linkFiscal(subId: string, fiscalProfileId: string) {
    setCategories((prev) =>
      prev.map((c) => ({
        ...c,
        subcategorias: c.subcategorias.map((s) =>
          s.id === subId ? { ...s, defaultFiscalProfileId: fiscalProfileId || null } : s,
        ),
      })),
    );
    start(async () => {
      try {
        await setSubcategoryFiscalProfile(subId, fiscalProfileId || null);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao vincular.");
      }
    });
  }

  function salvarSubcategoria() {
    if (!subModal) return;
    const nome = subModal.nome.trim();
    if (nome.length < 2) return setSubError("Informe o nome da subcategoria.");
    setSubError(undefined);
    start(async () => {
      try {
        const id = await createSubcategory({ categoryId: subModal.categoryId, nome });
        setCategories((prev) =>
          prev.map((c) =>
            c.id === subModal.categoryId
              ? {
                  ...c,
                  subcategorias: [
                    ...c.subcategorias,
                    { id, nome, ativo: true, defaultFiscalProfileId: null },
                  ],
                }
              : c,
          ),
        );
        setSubModal(null);
        refresh();
      } catch (e) {
        setSubError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Perfis fiscais */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Perfis fiscais</h2>
            <p className="text-xs text-muted">NCM, CEST e tributação por perfil.</p>
          </div>
          <button
            onClick={() => {
              setFormError(undefined);
              setForm({ ...emptyProfileForm });
            }}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Plus size={16} /> Adicionar
          </button>
        </div>

        {profiles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
            <Scale size={32} className="text-faint" />
            <p className="text-sm text-muted">
              Nenhum perfil fiscal cadastrado. Adicione o primeiro.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {profiles.map((p, idx) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2",
                  idx !== 0 && "border-t border-line",
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Scale size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
                  <p className="font-mono text-xs text-faint">
                    NCM {p.ncm}
                    {p.cest ? ` · CEST ${p.cest}` : ""}
                  </p>
                </div>
                {p.temSt && <Badge tone="accent">ST</Badge>}
                {p.precisaRevisao && <Badge tone="warn">Revisão pendente</Badge>}
                <Menu
                  align="end"
                  trigger={
                    <button
                      type="button"
                      aria-label="Ações do perfil fiscal"
                      className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      <MoreVertical size={16} />
                    </button>
                  }
                >
                  <MenuItem
                    icon={<Pencil size={15} />}
                    onClick={() => {
                      setFormError(undefined);
                      setForm(formFromProfile(p));
                    }}
                  >
                    Editar
                  </MenuItem>
                  <MenuItem
                    danger
                    icon={<Trash2 size={15} />}
                    onClick={() => excluirPerfil(p.id)}
                  >
                    Excluir
                  </MenuItem>
                </Menu>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subcategorias — vínculo com perfil fiscal */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Subcategorias</h2>
            <p className="text-xs text-muted">
              Vincule o perfil fiscal padrão de cada subcategoria.
            </p>
          </div>
          <button
            onClick={() => {
              setSubError(undefined);
              setSubModal({ categoryId: categories[0]?.id ?? "", nome: "" });
            }}
            disabled={categories.length === 0}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} /> Nova subcategoria
          </button>
        </div>

        {categories.length === 0 ? (
          <div className="rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
            <p className="text-sm text-muted">
              Nenhuma categoria cadastrada ainda — crie categorias em Produtos.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {categories.map((c, cIdx) => (
              <div key={c.id} className={cn(cIdx !== 0 && "border-t border-line")}>
                <p className="bg-surface-2/60 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-faint">
                  {c.nome}
                </p>
                {c.subcategorias.length === 0 ? (
                  <p className="px-5 py-3 text-sm text-muted">
                    Sem subcategorias nesta categoria.
                  </p>
                ) : (
                  <div className="divide-y divide-line">
                    {c.subcategorias.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 px-5 py-2.5"
                      >
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm text-ink-2",
                            !s.ativo && "text-faint line-through",
                          )}
                        >
                          {s.nome}
                        </span>
                        {!s.ativo && <Badge>Inativa</Badge>}
                        <Select
                          value={s.defaultFiscalProfileId ?? ""}
                          onChange={(e) => linkFiscal(s.id, e.target.value)}
                          containerClassName="w-56 shrink-0"
                        >
                          <option value="">— nenhum perfil —</option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nome} ({p.ncm})
                            </option>
                          ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sidepanel — criar/editar perfil fiscal */}
      <Sheet
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar perfil fiscal" : "Novo perfil fiscal"}
        description="NCM/CEST e tributação usados como padrão da subcategoria."
        width="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              onClick={salvarPerfil}
              disabled={pending || !form || form.nome.trim().length < 2 || form.ncm.trim().length < 1}
            >
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        {form && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12" label="Nome" htmlFor="f-nome" hint='Ex.: "Cerveja ST — RS"'>
              <Input id="f-nome" value={form.nome} onChange={(e) => upd("nome", e.target.value)} autoFocus />
            </Field>

            <Field className="col-span-6 sm:col-span-4" label="NCM" htmlFor="f-ncm">
              <Input id="f-ncm" value={form.ncm} onChange={(e) => upd("ncm", e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-4" label="CEST" htmlFor="f-cest">
              <Input id="f-cest" value={form.cest} onChange={(e) => upd("cest", e.target.value)} />
            </Field>
            <Field className="col-span-12 sm:col-span-4" label="Origem" htmlFor="f-origem">
              <Input id="f-origem" value={form.origem} onChange={(e) => upd("origem", e.target.value)} maxLength={2} />
            </Field>

            <Field className="col-span-6 sm:col-span-3" label="CSOSN" htmlFor="f-csosn">
              <Input id="f-csosn" value={form.csosn} onChange={(e) => upd("csosn", e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" label="CST" htmlFor="f-cst">
              <Input id="f-cst" value={form.cst} onChange={(e) => upd("cst", e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" label="CST PIS" htmlFor="f-pis">
              <Input id="f-pis" value={form.cstPis} onChange={(e) => upd("cstPis", e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" label="CST COFINS" htmlFor="f-cofins">
              <Input id="f-cofins" value={form.cstCofins} onChange={(e) => upd("cstCofins", e.target.value)} />
            </Field>

            <Field className="col-span-6" label="Alíquota ICMS (%)" htmlFor="f-icms">
              <Input
                id="f-icms"
                inputMode="decimal"
                value={form.aliquotaIcms}
                onChange={(e) => upd("aliquotaIcms", e.target.value.replace(",", "."))}
              />
            </Field>

            <div className="col-span-12 mt-1 flex flex-col gap-2 border-t border-line pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.temSt}
                  onChange={(e) => upd("temSt", e.target.checked)}
                  className="cursor-pointer accent-brand"
                />
                Possui substituição tributária (ST)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.precisaRevisao}
                  onChange={(e) => upd("precisaRevisao", e.target.checked)}
                  className="cursor-pointer accent-brand"
                />
                Precisa de revisão do contador
              </label>
            </div>
          </div>
        )}
        {formError && <p className="mt-2 text-sm text-danger">{formError}</p>}
      </Sheet>

      {/* Modal — nova subcategoria */}
      <Modal
        open={!!subModal}
        onClose={() => setSubModal(null)}
        title="Nova subcategoria"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setSubModal(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              onClick={salvarSubcategoria}
              disabled={pending || !subModal || subModal.nome.trim().length < 2}
            >
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        {subModal && (
          <div className="flex flex-col gap-3">
            <Field label="Categoria" htmlFor="sub-cat">
              <Select
                id="sub-cat"
                value={subModal.categoryId}
                onChange={(e) =>
                  setSubModal((m) => (m ? { ...m, categoryId: e.target.value } : m))
                }
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome" htmlFor="sub-nome" hint="Não pode repetir na mesma categoria.">
              <Input
                id="sub-nome"
                autoFocus
                value={subModal.nome}
                onChange={(e) =>
                  setSubModal((m) => (m ? { ...m, nome: e.target.value } : m))
                }
                onKeyDown={(e) => e.key === "Enter" && salvarSubcategoria()}
                placeholder="Ex.: Cervejas"
              />
            </Field>
          </div>
        )}
        {subError && <p className="mt-2 text-sm text-danger">{subError}</p>}
      </Modal>
    </div>
  );
}
