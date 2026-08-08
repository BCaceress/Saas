"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Monitor } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { maskCpf, maskDate, maskPhone } from "@/lib/masks";
import { fmtDataUTC } from "@/lib/customers";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createCustomer, updateCustomer } from "@/app/(app)/clientes/actions";
import type { CustomerRow } from "@/app/(app)/clientes/_types";
import type { Sexo } from "@/generated/prisma";

const SEXOS: Array<{ valor: Sexo; label: string }> = [
  { valor: "MASCULINO", label: "Masculino" },
  { valor: "FEMININO", label: "Feminino" },
  { valor: "OUTRO", label: "Outro" },
];

/**
 * Cadastro de cliente no celular — só o que se digita de pé no balcão: nome,
 * WhatsApp, CPF, nascimento, sexo e e-mail.
 *
 * Os campos de nota fiscal (CNPJ, IE, endereço, código IBGE) ficam de fora de
 * propósito: são doze campos que ninguém preenche no telefone, e a NF-e é
 * trabalho de mesa. Eles NÃO se perdem na edição — o payload reenvia o que já
 * estava gravado, porque a action grava o objeto inteiro e um campo omitido
 * viraria `null` no banco.
 */
export function FormCliente({
  base,
  onFechar,
}: {
  base: CustomerRow | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = React.useState(base?.nome ?? "");
  const [whatsapp, setWhatsapp] = React.useState(
    base?.whatsapp ? maskPhone(base.whatsapp) : "",
  );
  const [cpf, setCpf] = React.useState(base?.cpf ? maskCpf(base.cpf) : "");
  const [nascimento, setNascimento] = React.useState(
    base?.dataNascimento ? fmtDataUTC(base.dataNascimento) : "",
  );
  const [sexo, setSexo] = React.useState<Sexo | "">(base?.sexo ?? "");
  const [email, setEmail] = React.useState(base?.email ?? "");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const podeSalvar = nome.trim().length >= 2 && !salvando;

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    try {
      const payload = {
        nome,
        cpf,
        dataNascimento: nascimento,
        sexo: sexo || null,
        whatsapp,
        email,
        // Preservados como estão — a tela de mesa é quem edita fiscal.
        cnpj: base?.cnpj ?? null,
        razaoSocial: base?.razaoSocial ?? null,
        ie: base?.ie ?? null,
        indicadorIE: base?.indicadorIE ?? null,
        cep: base?.cep ?? null,
        logradouro: base?.logradouro ?? null,
        numero: base?.numero ?? null,
        complemento: base?.complemento ?? null,
        bairro: base?.bairro ?? null,
        municipio: base?.municipio ?? null,
        codigoMunicipio: base?.codigoMunicipio ?? null,
        uf: base?.uf ?? null,
      };

      if (base) await updateCustomer(base.id, payload);
      else await createCustomer(payload);

      toast.success(base ? "Cliente atualizado." : "Cliente cadastrado.");
      router.refresh();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Informe ao menos o nome.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={base ? "Editar cliente" : "Novo cliente"}
      descricao="Cadastro básico para fidelização."
      rodape={
        <Button onClick={salvar} disabled={!podeSalvar} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {base ? "Salvar alterações" : "Salvar cliente"}
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <Campo label="Nome" htmlFor="mc-nome">
          <input
            id="mc-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="João Silva"
            autoFocus
            autoComplete="name"
            className={ENTRADA}
          />
        </Campo>

        <Campo label="WhatsApp" htmlFor="mc-wpp">
          <input
            id="mc-wpp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
            inputMode="numeric"
            maxLength={15}
            placeholder="(11) 99999-9999"
            className={ENTRADA}
          />
        </Campo>

        <div className="grid grid-cols-2 gap-2">
          <Campo label="CPF" htmlFor="mc-cpf">
            <input
              id="mc-cpf"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              inputMode="numeric"
              maxLength={14}
              placeholder="000.000.000-00"
              className={cn(ENTRADA, "font-mono")}
            />
          </Campo>
          <Campo label="Nascimento" htmlFor="mc-nasc">
            <input
              id="mc-nasc"
              value={nascimento}
              onChange={(e) => setNascimento(maskDate(e.target.value))}
              inputMode="numeric"
              maxLength={10}
              placeholder="dd/mm/aaaa"
              className={cn(ENTRADA, "font-mono")}
            />
          </Campo>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">Sexo</p>
          <div className="flex flex-wrap gap-1.5">
            {SEXOS.map((s) => (
              <button
                key={s.valor}
                type="button"
                onClick={() => setSexo(sexo === s.valor ? "" : s.valor)}
                aria-pressed={sexo === s.valor}
                className={cn(
                  "min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-medium",
                  sexo === s.valor
                    ? "border-transparent bg-brand text-on-brand"
                    : "border-line-button bg-surface text-ink-2",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <Campo label="E-mail" htmlFor="mc-email">
          <input
            id="mc-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Para receber a nota"
            autoComplete="email"
            inputMode="email"
            className={ENTRADA}
          />
        </Campo>

        <p className="flex items-start gap-1.5 px-1 text-xs text-muted">
          <Monitor className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            CNPJ, inscrição estadual e endereço para NF-e ficam em{" "}
            <Link href="/clientes" className="font-medium text-brand">
              Clientes na versão de computador
            </Link>
            .
          </span>
        </p>

        {erro && <p className="text-sm text-danger">{erro}</p>}
      </div>
    </BottomSheet>
  );
}

const ENTRADA =
  "min-h-11 w-full rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

function Campo({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}
