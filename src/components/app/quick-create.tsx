"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  UserPlus,
  Truck,
  ShoppingCart,
  Package,
  Store,
  Search,
  Loader2,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCpf, maskDate, maskPhone, maskCnpj } from "@/lib/masks";
import { createCustomer } from "@/app/(app)/clientes/actions";
import { createSupplier } from "@/app/(app)/produtos/actions";
import { loadComprasFormOptionsAction } from "@/app/(app)/estoque/actions";
import { PedidoFormSheet, type FormOptions } from "@/app/(app)/compras/_pedidos";
import type { Sexo } from "@/generated/prisma";

type Panel = "cliente" | "fornecedor" | "pedido" | null;

export function QuickCreate({ empresa }: { empresa: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);
  const done = () => {
    close();
    router.refresh();
  };

  return (
    <>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            aria-label="Cadastro rápido"
            title="Cadastro rápido"
            className="hidden h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:grid cursor-pointer"
          >
            <Plus size={18} />
          </button>
        }
      >
        <p className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Cadastro rápido
        </p>
        <MenuItem icon={<UserPlus size={15} />} onClick={() => setPanel("cliente")}>
          Novo cliente
        </MenuItem>
        <MenuItem icon={<Truck size={15} />} onClick={() => setPanel("fornecedor")}>
          Novo fornecedor
        </MenuItem>
        <MenuItem icon={<ShoppingCart size={15} />} onClick={() => setPanel("pedido")}>
          Novo pedido de compra
        </MenuItem>
        <div className="my-1 h-px bg-line" />
        <p className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Atalhos
        </p>
        <MenuItem icon={<Package size={15} />} onClick={() => router.push("/produtos/novo/simples")}>
          Novo produto
        </MenuItem>
        <MenuItem icon={<Store size={15} />} onClick={() => router.push("/vendas")}>
          Nova venda (PDV)
        </MenuItem>
      </Menu>

      <ClienteSheet open={panel === "cliente"} onClose={close} onDone={done} />
      <FornecedorSheet open={panel === "fornecedor"} onClose={close} onDone={done} />
      <PedidoSheet open={panel === "pedido"} onClose={close} onDone={done} empresa={empresa} />
    </>
  );
}

// ── Cliente ──────────────────────────────────────────────────

type ClienteForm = {
  nome: string;
  cpf: string;
  dataNascimento: string;
  sexo: "" | Sexo;
  whatsapp: string;
};

const emptyCliente = (): ClienteForm => ({
  nome: "",
  cpf: "",
  dataNascimento: "",
  sexo: "",
  whatsapp: "",
});

function ClienteSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ClienteForm>(emptyCliente);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function upd<K extends keyof ClienteForm>(k: K, v: ClienteForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function fechar() {
    setForm(emptyCliente());
    setError(undefined);
    onClose();
  }

  function salvar() {
    setError(undefined);
    start(async () => {
      try {
        await createCustomer({
          nome: form.nome,
          cpf: form.cpf,
          dataNascimento: form.dataNascimento,
          sexo: form.sexo || null,
          whatsapp: form.whatsapp,
        });
        toast.success("Cliente cadastrado");
        setForm(emptyCliente());
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Informe ao menos o nome.");
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={fechar}
      title="Novo cliente"
      description="Cadastro básico para fidelização."
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={fechar} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending} className="gap-1">
            <Plus size={16} /> {pending ? "Salvando…" : "Salvar cliente"}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-12 gap-x-3 gap-y-3">
        <Field className="col-span-12" label="Nome" htmlFor="q-nome">
          <Input id="q-nome" value={form.nome} onChange={(e) => upd("nome", e.target.value)} placeholder="João Silva" autoFocus />
        </Field>
        <Field className="col-span-12 sm:col-span-7" label="CPF (opcional)" htmlFor="q-cpf">
          <Input id="q-cpf" value={form.cpf} onChange={(e) => upd("cpf", maskCpf(e.target.value))} inputMode="numeric" maxLength={14} placeholder="000.000.000-00" />
        </Field>
        <Field className="col-span-12 sm:col-span-5" label="WhatsApp" htmlFor="q-wpp">
          <Input id="q-wpp" value={form.whatsapp} onChange={(e) => upd("whatsapp", maskPhone(e.target.value))} inputMode="numeric" maxLength={15} placeholder="(11) 99999-9999" />
        </Field>
        <Field className="col-span-6" label="Nascimento (opcional)" htmlFor="q-nasc">
          <Input id="q-nasc" value={form.dataNascimento} onChange={(e) => upd("dataNascimento", maskDate(e.target.value))} inputMode="numeric" maxLength={10} placeholder="dd/mm/aaaa" />
        </Field>
        <Field className="col-span-6" label="Sexo (opcional)" htmlFor="q-sexo">
          <Select id="q-sexo" value={form.sexo} onChange={(e) => upd("sexo", e.target.value as ClienteForm["sexo"])}>
            <option value="">Não informar</option>
            <option value="MASCULINO">Masculino</option>
            <option value="FEMININO">Feminino</option>
            <option value="OUTRO">Outro</option>
          </Select>
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Sheet>
  );
}

// ── Fornecedor ───────────────────────────────────────────────

type FornecedorForm = {
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

const emptyFornecedor = (cnpj = ""): FornecedorForm => ({
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

function FornecedorSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [cnpj, setCnpj] = useState("");
  const [form, setForm] = useState<FornecedorForm>(emptyFornecedor);
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function upd<K extends keyof FornecedorForm>(k: K, v: FornecedorForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function fechar() {
    setCnpj("");
    setForm(emptyFornecedor());
    setNote(undefined);
    setError(undefined);
    onClose();
  }

  async function buscarCnpj() {
    setError(undefined);
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14) return setError("CNPJ precisa de 14 dígitos.");
    setLoadingCnpj(true);
    setNote(undefined);
    try {
      const res = await fetch(`/api/fornecedores/cnpj/${digits}`);
      const d = await res.json();
      if (res.ok) {
        setForm({
          ...emptyFornecedor(maskCnpj(cnpj)),
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
        setNote("Confira os dados e complete o que faltar.");
      } else if (res.status === 404) {
        setForm(emptyFornecedor(maskCnpj(cnpj)));
        setNote("CNPJ não encontrado na Receita — preencha manualmente.");
      } else {
        setError(d.error ?? "Consulta indisponível. Tente de novo.");
      }
    } catch {
      setError("Falha ao consultar o CNPJ. Verifique a conexão e tente de novo.");
    } finally {
      setLoadingCnpj(false);
    }
  }

  function salvar() {
    setError(undefined);
    start(async () => {
      try {
        await createSupplier({
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
        });
        toast.success("Fornecedor cadastrado");
        setCnpj("");
        setForm(emptyFornecedor());
        setNote(undefined);
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Informe ao menos a razão social.");
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={fechar}
      title="Novo fornecedor"
      description="Pesquise pelo CNPJ para preencher automaticamente."
      width="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={fechar} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending} className="gap-1">
            <Plus size={16} /> {pending ? "Salvando…" : "Salvar fornecedor"}
          </Button>
        </div>
      }
    >
      <Field label="CNPJ" htmlFor="q-cnpj">
        <div className="flex gap-2">
          <Input
            id="q-cnpj"
            value={cnpj}
            onChange={(e) => setCnpj(maskCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            maxLength={18}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarCnpj())}
          />
          <Button type="button" onClick={buscarCnpj} disabled={loadingCnpj} className="shrink-0 gap-1.5">
            <Search size={16} /> {loadingCnpj ? "Buscando…" : "Pesquisar"}
          </Button>
        </div>
      </Field>
      {note && (
        <p className="mt-4 rounded-[var(--radius-sm)] bg-brand-soft px-3 py-2 text-xs text-brand-strong">
          {note}
        </p>
      )}
      <div className="mt-4 grid grid-cols-12 gap-x-3 gap-y-3">
        <Field className="col-span-12 sm:col-span-7" label="Razão social" htmlFor="q-razao">
          <Input id="q-razao" value={form.razaoSocial} onChange={(e) => upd("razaoSocial", e.target.value)} />
        </Field>
        <Field className="col-span-12 sm:col-span-5" label="Nome fantasia" htmlFor="q-fant">
          <Input id="q-fant" value={form.nomeFantasia} onChange={(e) => upd("nomeFantasia", e.target.value)} />
        </Field>
        <Field className="col-span-12 sm:col-span-4" label="Telefone / WhatsApp" htmlFor="q-tel">
          <Input id="q-tel" value={form.telefone} onChange={(e) => upd("telefone", maskPhone(e.target.value))} inputMode="numeric" maxLength={15} placeholder="(11) 99999-9999" />
        </Field>
        <Field className="col-span-12 sm:col-span-4" label="E-mail" htmlFor="q-mail">
          <Input id="q-mail" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} />
        </Field>
        <Field className="col-span-12 sm:col-span-4" label="Contato principal" htmlFor="q-cont">
          <Input id="q-cont" value={form.contato} onChange={(e) => upd("contato", e.target.value)} />
        </Field>
        <Field className="col-span-12" label="Website" htmlFor="q-web">
          <Input id="q-web" value={form.website} onChange={(e) => upd("website", e.target.value)} placeholder="https://" />
        </Field>
        <p className="col-span-12 mt-1 text-[11px] font-medium uppercase tracking-wider text-faint">Endereço</p>
        <Field className="col-span-4 sm:col-span-3" label="CEP" htmlFor="q-cep">
          <Input id="q-cep" value={form.cep} onChange={(e) => upd("cep", e.target.value)} inputMode="numeric" />
        </Field>
        <Field className="col-span-8 sm:col-span-7" label="Logradouro" htmlFor="q-log">
          <Input id="q-log" value={form.logradouro} onChange={(e) => upd("logradouro", e.target.value)} />
        </Field>
        <Field className="col-span-12 sm:col-span-2" label="Número" htmlFor="q-num">
          <Input id="q-num" value={form.numero} onChange={(e) => upd("numero", e.target.value)} />
        </Field>
        <Field className="col-span-6 sm:col-span-5" label="Bairro" htmlFor="q-bairro">
          <Input id="q-bairro" value={form.bairro} onChange={(e) => upd("bairro", e.target.value)} />
        </Field>
        <Field className="col-span-6 sm:col-span-4" label="Município" htmlFor="q-mun">
          <Input id="q-mun" value={form.municipio} onChange={(e) => upd("municipio", e.target.value)} />
        </Field>
        <Field className="col-span-4 sm:col-span-1" label="UF" htmlFor="q-uf">
          <Input id="q-uf" value={form.uf} onChange={(e) => upd("uf", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
        </Field>
        <Field className="col-span-8 sm:col-span-2" label="Compl." htmlFor="q-comp">
          <Input id="q-comp" value={form.complemento} onChange={(e) => upd("complemento", e.target.value)} />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Sheet>
  );
}

// ── Pedido de compra ─────────────────────────────────────────

function PedidoSheet({
  open,
  onClose,
  onDone,
  empresa,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  empresa: string;
}) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // Carrega opções (fornecedores/produtos/sites) na primeira abertura.
  useEffect(() => {
    if (!open || options || loading) return;
    setLoading(true);
    setError(undefined);
    loadComprasFormOptionsAction()
      .then((o) => setOptions(o))
      .catch(() => setError("Não foi possível carregar fornecedores e produtos."))
      .finally(() => setLoading(false));
  }, [open, options, loading]);

  // Enquanto as opções carregam (só na primeira abertura), um Sheet simples;
  // depois disso o form assume o próprio Sheet (footer fixo, busca, etc.).
  if (options) {
    return open ? <PedidoFormSheet open onClose={onClose} mode="novo" formOptions={options} empresa={empresa} onDone={onDone} /> : null;
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Novo pedido de compra"
      description="Monte o pedido ao fornecedor. A entrada no estoque só acontece no recebimento."
      width="xl"
    >
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Carregando…
        </div>
      )}
      {error && (
        <p className="rounded-[var(--radius)] bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>
      )}
    </Sheet>
  );
}
