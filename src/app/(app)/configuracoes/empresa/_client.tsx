"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj, maskPhone, maskCep } from "@/lib/masks";
import { updateEmpresa } from "../actions";

type EmpresaForm = {
  nome: string;
  razaoSocial: string;
  cnpj: string;
  telefone: string;
  emailContato: string;
  cep: string;
  rua: string;
  numero: string;
  cidade: string;
  estado: string;
};

export function EmpresaClient({
  subdomain,
  initial,
}: {
  subdomain: string;
  initial: EmpresaForm;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [form, setForm] = useState<EmpresaForm>({
    ...initial,
    cnpj: initial.cnpj ? maskCnpj(initial.cnpj) : "",
    telefone: initial.telefone ? maskPhone(initial.telefone) : "",
    cep: initial.cep ? maskCep(initial.cep) : "",
  });

  const set = (patch: Partial<EmpresaForm>) => setForm((f) => ({ ...f, ...patch }));

  async function buscarCnpj() {
    const digits = form.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) {
      toast.error("Informe os 14 dígitos do CNPJ para pesquisar.");
      return;
    }
    setLoadingCnpj(true);
    try {
      const res = await fetch(`/api/fornecedores/cnpj/${digits}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao consultar o CNPJ.");
      set({
        razaoSocial: data.razaoSocial || form.razaoSocial,
        telefone: data.telefone ? maskPhone(data.telefone) : form.telefone,
        emailContato: data.email || form.emailContato,
        cep: data.cep ? maskCep(data.cep) : form.cep,
        rua: data.logradouro || form.rua,
        numero: data.numero || form.numero,
        cidade: data.municipio || form.cidade,
        estado: data.uf || form.estado,
      });
      toast.success("Dados da Receita preenchidos — revise e salve.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar o CNPJ.");
    } finally {
      setLoadingCnpj(false);
    }
  }

  function salvar() {
    start(async () => {
      try {
        await updateEmpresa(form);
        toast.success("Dados da empresa salvos.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Endereço do app (só leitura) */}
      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <Globe size={18} />
        </span>
        <div>
          <p className="font-semibold text-ink">Endereço do sistema</p>
          <p className="mt-0.5 font-mono text-sm text-muted">{subdomain}.nohub.market</p>
        </div>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do mercado" htmlFor="nome" className="sm:col-span-2">
            <Input
              id="nome"
              value={form.nome}
              onChange={(e) => set({ nome: e.target.value })}
              placeholder="Ex.: Mercadinho do João"
            />
          </Field>

          <Field
            label="CNPJ"
            htmlFor="cnpj"
            hint="Pesquise para preencher razão social, contato e endereço."
          >
            <div className="flex gap-2">
              <Input
                id="cnpj"
                value={form.cnpj}
                onChange={(e) => set({ cnpj: maskCnpj(e.target.value) })}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarCnpj())}
              />
              <Button
                type="button"
                variant="outline"
                onClick={buscarCnpj}
                disabled={loadingCnpj}
              >
                <Search size={16} /> {loadingCnpj ? "Buscando…" : "Pesquisar"}
              </Button>
            </div>
          </Field>

          <Field label="Razão social" htmlFor="razao">
            <Input
              id="razao"
              value={form.razaoSocial}
              onChange={(e) => set({ razaoSocial: e.target.value })}
              placeholder="Razão social na Receita"
            />
          </Field>

          <Field label="Telefone" htmlFor="telefone">
            <Input
              id="telefone"
              value={form.telefone}
              onChange={(e) => set({ telefone: maskPhone(e.target.value) })}
              placeholder="(00) 00000-0000"
              inputMode="tel"
            />
          </Field>

          <Field label="E-mail de contato" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={form.emailContato}
              onChange={(e) => set({ emailContato: e.target.value })}
              placeholder="contato@seumercado.com.br"
            />
          </Field>
        </div>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <p className="mb-4 text-sm font-semibold text-ink">Endereço</p>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="CEP" htmlFor="cep" className="sm:col-span-2">
            <Input
              id="cep"
              value={form.cep}
              onChange={(e) => set({ cep: maskCep(e.target.value) })}
              placeholder="00000-000"
              inputMode="numeric"
            />
          </Field>
          <Field label="Rua" htmlFor="rua" className="sm:col-span-3">
            <Input
              id="rua"
              value={form.rua}
              onChange={(e) => set({ rua: e.target.value })}
              placeholder="Rua, avenida…"
            />
          </Field>
          <Field label="Número" htmlFor="numero" className="sm:col-span-1">
            <Input
              id="numero"
              value={form.numero}
              onChange={(e) => set({ numero: e.target.value })}
              placeholder="123"
            />
          </Field>
          <Field label="Cidade" htmlFor="cidade" className="sm:col-span-4">
            <Input
              id="cidade"
              value={form.cidade}
              onChange={(e) => set({ cidade: e.target.value })}
              placeholder="Cidade"
            />
          </Field>
          <Field label="UF" htmlFor="estado" className="sm:col-span-2">
            <Input
              id="estado"
              value={form.estado}
              onChange={(e) => set({ estado: e.target.value.toUpperCase().slice(0, 2) })}
              placeholder="SP"
              maxLength={2}
            />
          </Field>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar dados"}
        </Button>
      </div>
    </div>
  );
}
