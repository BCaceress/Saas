"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Archive,
  ArchiveRestore,
  Truck,
  MapPin,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { maskCnpj, maskPhone } from "@/lib/masks";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import {
  createSupplier,
  updateSupplier,
  setSupplierActive,
} from "../produtos/actions";
import type { SupplierRow } from "../produtos/_types";

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

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

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

function enderecoMapsUrl(s: SupplierRow): string | null {
  const partes = [
    s.logradouro && s.numero ? `${s.logradouro}, ${s.numero}` : s.logradouro,
    s.bairro,
    s.municipio,
    s.uf,
    s.cep,
  ].filter(Boolean);
  if (partes.length === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes.join(", "))}`;
}

function whatsappUrl(telefone: string): string {
  const digits = telefone.replace(/\D/g, "");
  const withDdi = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${withDdi}`;
}

export function FornecedoresManager({ suppliers }: { suppliers: SupplierRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [error, setError] = useState<string>();
  const [q, setQ] = useState("");

  const [cnpj, setCnpj] = useState("");
  const [form, setForm] = useState<SupplierForm | null>(null);
  const [modalNote, setModalNote] = useState<string>();
  const [modalError, setModalError] = useState<string>();

  function refresh() {
    router.refresh();
  }

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
        setForm(emptyForm(maskCnpj(cnpj)));
        setModalNote("CNPJ não encontrado na Receita — preencha manualmente.");
      } else {
        setError(d.error ?? "Consulta indisponível. Tente de novo.");
      }
    } catch {
      setError("Falha ao consultar o CNPJ. Verifique a conexão e tente de novo.");
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

  const list = suppliers
    .filter((s) =>
      `${s.razaoSocial} ${s.nomeFantasia ?? ""} ${s.cnpj ?? ""}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .sort((a, b) =>
      (a.nomeFantasia || a.razaoSocial).localeCompare(
        b.nomeFantasia || b.razaoSocial,
        "pt-BR",
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Fornecedores"
        icon={navIcon("/fornecedores")}
        description="Cadastre e gerencie os fornecedores da sua operação."
        innerClassName="max-w-none"
        actions={
          <button
            onClick={() => {
              setModalNote(undefined);
              setModalError(undefined);
              setError(undefined);
              setCnpj("");
              setForm(emptyForm());
            }}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Plus size={16} /> Adicionar
          </button>
        }
      />

      <div className="relative">
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

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
          <Truck size={32} className="text-faint" />
          <p className="text-sm text-muted">
            Nenhum fornecedor cadastrado. Adicione o primeiro.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {list.map((s, idx) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2",
                idx !== 0 && "border-t border-line",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <Truck size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium text-ink",
                    !s.ativo && "text-faint line-through",
                  )}
                >
                  {s.nomeFantasia || s.razaoSocial}
                </p>
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-faint">
                  <span>{s.cnpj ? maskCnpj(s.cnpj) : "sem CNPJ"}</span>
                  {s.telefone && (
                    <>
                      <span>·</span>
                      <a
                        href={whatsappUrl(s.telefone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir no WhatsApp"
                        className="text-faint underline-offset-2 hover:text-brand hover:underline"
                      >
                        {maskPhone(s.telefone)}
                      </a>
                    </>
                  )}
                  {s.email && (
                    <>
                      <span>·</span>
                      <a
                        href={`mailto:${s.email}`}
                        onClick={(e) => e.stopPropagation()}
                        title="Enviar e-mail"
                        className="text-faint underline-offset-2 hover:text-brand hover:underline"
                      >
                        {s.email}
                      </a>
                    </>
                  )}
                </p>
              </div>
              {!s.ativo && <Badge>Inativo</Badge>}
              <Menu
                align="end"
                trigger={
                  <button
                    type="button"
                    aria-label="Ações do fornecedor"
                    title="Ações do fornecedor"
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
                {enderecoMapsUrl(s) && (
                  <MenuItem
                    icon={<MapPin size={15} />}
                    onClick={() => window.open(enderecoMapsUrl(s)!, "_blank", "noopener,noreferrer")}
                  >
                    Ver endereço no Maps
                  </MenuItem>
                )}
                <MenuItem
                  icon={
                    s.ativo ? <Archive size={15} /> : <ArchiveRestore size={15} />
                  }
                  onClick={() => toggleActive(s)}
                >
                  {s.ativo ? "Inativar" : "Reativar"}
                </MenuItem>
              </Menu>
            </div>
          ))}
        </div>
      )}

      <Sheet
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar fornecedor" : "Novo fornecedor"}
        description="Pesquise pelo CNPJ para preencher automaticamente."
        width="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={pending} className="gap-1">
              <Plus size={16} /> {pending ? "Salvando…" : "Salvar fornecedor"}
            </Button>
          </div>
        }
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
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarCnpj())}
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

        {modalNote && (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            {modalNote}
          </p>
        )}
        {form && (
          <div className="mt-4 grid grid-cols-12 gap-x-3 gap-y-2">
            <Field className="col-span-12" label="Razão social" htmlFor="m-razao">
              <Input id="m-razao" value={form.razaoSocial} onChange={(e) => upd("razaoSocial", e.target.value)} />
            </Field>

            <Field className="col-span-12 sm:col-span-7" label="Nome fantasia" htmlFor="m-fant">
              <Input id="m-fant" value={form.nomeFantasia} onChange={(e) => upd("nomeFantasia", e.target.value)} />
            </Field>
            <Field className="col-span-12 sm:col-span-5" label="Contato principal" htmlFor="m-cont">
              <Input id="m-cont" value={form.contato} onChange={(e) => upd("contato", e.target.value)} />
            </Field>

            <Field className="col-span-12 sm:col-span-7" label="E-mail" htmlFor="m-mail">
              <Input id="m-mail" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} />
            </Field>
            <Field className="col-span-12 sm:col-span-5" label="Telefone / WhatsApp" htmlFor="m-tel">
              <Input id="m-tel" value={form.telefone} onChange={(e) => upd("telefone", maskPhone(e.target.value))} inputMode="numeric" maxLength={15} placeholder="(11) 99999-9999" />
            </Field>

            <Field className="col-span-12" label="Website" htmlFor="m-site">
              <Input id="m-site" value={form.website} onChange={(e) => upd("website", e.target.value)} placeholder="https://" />
            </Field>

            <p className="col-span-12 mt-1 text-[11px] font-medium uppercase tracking-wider text-faint">Endereço</p>

            <Field className="col-span-12 sm:col-span-4" label="CEP" htmlFor="m-cep">
              <Input id="m-cep" value={form.cep} onChange={(e) => upd("cep", e.target.value)} inputMode="numeric" />
            </Field>
            <Field className="col-span-12 sm:col-span-8" label="Município" htmlFor="m-mun">
              <Input id="m-mun" value={form.municipio} onChange={(e) => upd("municipio", e.target.value)} />
            </Field>

            <Field className="col-span-6 sm:col-span-5" label="Bairro" htmlFor="m-bairro">
              <Input id="m-bairro" value={form.bairro} onChange={(e) => upd("bairro", e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" label="UF" htmlFor="m-uf">
              <Select id="m-uf" value={form.uf} onChange={(e) => upd("uf", e.target.value)}>
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="col-span-12 sm:col-span-4" label="Compl." htmlFor="m-comp">
              <Input id="m-comp" value={form.complemento} onChange={(e) => upd("complemento", e.target.value)} />
            </Field>

            <Field className="col-span-8 sm:col-span-9" label="Logradouro" htmlFor="m-log">
              <Input id="m-log" value={form.logradouro} onChange={(e) => upd("logradouro", e.target.value)} />
            </Field>
            <Field className="col-span-4 sm:col-span-3" label="Número" htmlFor="m-num">
              <Input id="m-num" value={form.numero} onChange={(e) => upd("numero", e.target.value)} />
            </Field>
          </div>
        )}
        {modalError && <p className="mt-2 text-sm text-danger">{modalError}</p>}
      </Sheet>
    </div>
  );
}
