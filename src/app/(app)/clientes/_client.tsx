"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, Search, MoreVertical, Pencil, Archive, ArchiveRestore, Users,
  Cake, AlertTriangle, Send, Star, ChevronRight, Award,
} from "lucide-react";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn, brl } from "@/lib/utils";
import { maskCpf, maskDate, maskPhone, maskCnpj, maskCep } from "@/lib/masks";
import { tierFromGasto, fmtDataUTC, fmtDiasAtras, tiersFromThresholds } from "@/lib/customers";
import type { TierThresholds } from "@/lib/customers";
import { CustomerSidePanel } from "@/components/app/customer-side-panel";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ViewToggle, useViewMode } from "@/components/app/view-toggle";
import {
  createCustomer, updateCustomer, setCustomerActive, sendCoupon,
} from "./actions";
import type { CustomerRow, CouponCandidate } from "./_types";
import type { Sexo, IndicadorIE } from "@/generated/prisma";

type CustomerForm = {
  id?: string;
  nome: string;
  cpf: string;
  dataNascimento: string;
  sexo: "" | Sexo;
  whatsapp: string;
  email: string;
  // Fiscal — só a NF-e usa. Fica recolhido no formulário.
  cnpj: string;
  razaoSocial: string;
  ie: string;
  indicadorIE: "" | IndicadorIE;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
};

const emptyForm = (): CustomerForm => ({
  nome: "", cpf: "", dataNascimento: "", sexo: "", whatsapp: "", email: "",
  cnpj: "", razaoSocial: "", ie: "", indicadorIE: "", cep: "", logradouro: "",
  numero: "", complemento: "", bairro: "", municipio: "", codigoMunicipio: "", uf: "",
});

function formFromRow(c: CustomerRow): CustomerForm {
  return {
    id: c.id,
    nome: c.nome,
    cpf: c.cpf ? maskCpf(c.cpf) : "",
    dataNascimento: c.dataNascimento ? fmtDataUTC(c.dataNascimento) : "",
    sexo: c.sexo ?? "",
    whatsapp: c.whatsapp ? maskPhone(c.whatsapp) : "",
    email: c.email ?? "",
    cnpj: c.cnpj ? maskCnpj(c.cnpj) : "",
    razaoSocial: c.razaoSocial ?? "",
    ie: c.ie ?? "",
    indicadorIE: c.indicadorIE ?? "",
    cep: c.cep ? maskCep(c.cep) : "",
    logradouro: c.logradouro ?? "",
    numero: c.numero ?? "",
    complemento: c.complemento ?? "",
    bairro: c.bairro ?? "",
    municipio: c.municipio ?? "",
    codigoMunicipio: c.codigoMunicipio ?? "",
    uf: c.uf ?? "",
  };
}

export function ClientesClient({
  rows, candidates, cupomAutomatico, cupomDiasRisco, tierThresholds,
}: {
  rows: CustomerRow[];
  candidates: CouponCandidate[];
  cupomAutomatico: boolean;
  cupomDiasRisco: number;
  tierThresholds: TierThresholds;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [view, setView] = useViewMode("nohub:clientes:view");
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [modalError, setModalError] = useState<string>();
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [showTiers, setShowTiers] = useState(false);

  const refresh = () => router.refresh();

  function upd<K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function salvar() {
    if (!form) return;
    setModalError(undefined);
    const payload = {
      nome: form.nome,
      cpf: form.cpf,
      dataNascimento: form.dataNascimento,
      sexo: form.sexo || null,
      whatsapp: form.whatsapp,
      email: form.email,
      cnpj: form.cnpj,
      razaoSocial: form.razaoSocial,
      ie: form.ie,
      indicadorIE: form.indicadorIE || null,
      cep: form.cep,
      logradouro: form.logradouro,
      numero: form.numero,
      complemento: form.complemento,
      bairro: form.bairro,
      municipio: form.municipio,
      codigoMunicipio: form.codigoMunicipio,
      uf: form.uf,
    };
    start(async () => {
      try {
        if (form.id) await updateCustomer(form.id, payload);
        else await createCustomer(payload);
        setForm(null);
        refresh();
      } catch (e) {
        setModalError(e instanceof Error ? e.message : "Informe ao menos o nome.");
      }
    });
  }

  function toggleActive(c: CustomerRow) {
    start(async () => {
      try {
        await setCustomerActive(c.id, !c.ativo);
        refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha.");
      }
    });
  }

  const list = rows.filter((c) =>
    `${c.nome} ${c.cpf ?? ""} ${c.whatsapp ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  const pendentes = candidates.filter((c) => !c.jaEnviado);

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho */}
      <PageHeader
        title="Clientes"
        icon={navIcon("/clientes")}
        description={`Fidelize quem compra com você. ${rows.length} ${rows.length === 1 ? "cliente" : "clientes"}.`}
        innerClassName="max-w-none"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTiers(true)}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2"
            >
              <Award size={16} /> Níveis
            </button>
            <button
              onClick={() => { setModalError(undefined); setForm(emptyForm()); }}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <Plus size={16} /> Adicionar
            </button>
          </div>
        }
      />

      {/* Inteligência — cupons sugeridos */}
      {pendentes.length > 0 && (
        <IntelBanner
          candidates={pendentes}
          cupomAutomatico={cupomAutomatico}
          onSent={refresh}
        />
      )}

      {/* Busca */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, CPF ou WhatsApp"
            className="pl-9"
          />
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* Lista */}
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
          <Users size={32} className="text-faint" />
          <p className="text-sm text-muted">
            {rows.length === 0
              ? "Nenhum cliente cadastrado. Adicione o primeiro."
              : "Nenhum cliente encontrado para essa busca."}
          </p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const tier = tierFromGasto(c.totalGasto, tierThresholds);
            const iniciais = c.nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
            return (
              <div
                key={c.id}
                onClick={() => setSelected(c)}
                className="flex cursor-pointer flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                    {iniciais || <Users size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium text-ink", !c.ativo && "text-faint line-through")}>
                      {c.nome}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-faint">
                      <span className={cn("flex items-center gap-0.5", tier.text)}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={10} className={i < tier.estrelas ? "fill-current" : "opacity-25"} />
                        ))}
                      </span>
                      <span className={tier.text}>{tier.label.replace("Cliente ", "")}</span>
                    </p>
                  </div>
                  {!c.ativo && <Badge>Inativo</Badge>}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Menu
                      align="end"
                      trigger={
                        <button
                          type="button"
                          aria-label="Ações do cliente"
                          className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                        >
                          <MoreVertical size={16} />
                        </button>
                      }
                    >
                      <MenuItem icon={<Pencil size={15} />} onClick={() => { setModalError(undefined); setForm(formFromRow(c)); }}>
                        Editar
                      </MenuItem>
                      <MenuItem
                        icon={c.ativo ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                        onClick={() => toggleActive(c)}
                      >
                        {c.ativo ? "Inativar" : "Reativar"}
                      </MenuItem>
                    </Menu>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
                  <span className="text-faint">{c.whatsapp ? maskPhone(c.whatsapp) : "sem WhatsApp"}</span>
                  <div className="text-right">
                    <p className="font-mono font-medium text-ink tnum">{brl(c.totalGasto)}</p>
                    <p className="text-[11px] text-faint">
                      {c.ultimaCompra ? `compra ${fmtDiasAtras(c.ultimaCompra)}` : "sem compras"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {list.map((c, idx) => {
            const tier = tierFromGasto(c.totalGasto, tierThresholds);
            const iniciais = c.nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
            return (
              <div
                key={c.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
                  idx !== 0 && "border-t border-line",
                )}
              >
                <button
                  onClick={() => setSelected(c)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                    {iniciais || <Users size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium text-ink", !c.ativo && "text-faint line-through")}>
                      {c.nome}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-faint">
                      <span className={cn("flex items-center gap-0.5", tier.text)}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={10} className={i < tier.estrelas ? "fill-current" : "opacity-25"} />
                        ))}
                      </span>
                      <span className={tier.text}>{tier.label.replace("Cliente ", "")}</span>
                      {c.whatsapp && <span>· {maskPhone(c.whatsapp)}</span>}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="font-mono text-sm font-medium text-ink tnum">{brl(c.totalGasto)}</p>
                    <p className="text-[11px] text-faint">
                      {c.ultimaCompra ? `compra ${fmtDiasAtras(c.ultimaCompra)}` : "sem compras"}
                    </p>
                  </div>
                </button>
                {!c.ativo && <Badge>Inativo</Badge>}
                <Menu
                  align="end"
                  trigger={
                    <button
                      type="button"
                      aria-label="Ações do cliente"
                      className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      <MoreVertical size={16} />
                    </button>
                  }
                >
                  <MenuItem icon={<Pencil size={15} />} onClick={() => { setModalError(undefined); setForm(formFromRow(c)); }}>
                    Editar
                  </MenuItem>
                  <MenuItem
                    icon={c.ativo ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                    onClick={() => toggleActive(c)}
                  >
                    {c.ativo ? "Inativar" : "Reativar"}
                  </MenuItem>
                </Menu>
              </div>
            );
          })}
        </div>
      )}

      {/* Detalhe (resumo) */}
      {selected && (
        <CustomerSidePanel
          key={selected.id}
          customer={selected}
          diasRisco={cupomDiasRisco}
          tierThresholds={tierThresholds}
          onClose={() => setSelected(null)}
          onEdit={() => { setModalError(undefined); setForm(formFromRow(selected)); setSelected(null); }}
        />
      )}

      {/* Formulário de cadastro */}
      <Sheet
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar cliente" : "Novo cliente"}
        description="Cadastro básico para fidelização."
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)} disabled={pending}>Cancelar</Button>
            <Button onClick={salvar} disabled={pending} className="gap-1">
              <Plus size={16} /> {pending ? "Salvando…" : "Salvar cliente"}
            </Button>
          </div>
        }
      >
        {form && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12" label="Nome" htmlFor="c-nome">
              <Input id="c-nome" value={form.nome} onChange={(e) => upd("nome", e.target.value)} placeholder="João Silva" autoFocus />
            </Field>
            <Field className="col-span-12 sm:col-span-7" label="CPF (opcional)" htmlFor="c-cpf">
              <Input id="c-cpf" value={form.cpf} onChange={(e) => upd("cpf", maskCpf(e.target.value))} inputMode="numeric" maxLength={14} placeholder="000.000.000-00" />
            </Field>
            <Field className="col-span-12 sm:col-span-5" label="WhatsApp" htmlFor="c-wpp">
              <Input id="c-wpp" value={form.whatsapp} onChange={(e) => upd("whatsapp", maskPhone(e.target.value))} inputMode="numeric" maxLength={15} placeholder="(11) 99999-9999" />
            </Field>
            <Field className="col-span-6 sm:col-span-6" label="Nascimento (opcional)" htmlFor="c-nasc">
              <Input id="c-nasc" value={form.dataNascimento} onChange={(e) => upd("dataNascimento", maskDate(e.target.value))} inputMode="numeric" maxLength={10} placeholder="dd/mm/aaaa" />
            </Field>
            <Field className="col-span-6 sm:col-span-6" label="Sexo (opcional)" htmlFor="c-sexo">
              <Select id="c-sexo" value={form.sexo} onChange={(e) => upd("sexo", e.target.value as CustomerForm["sexo"])}>
                <option value="">Não informar</option>
                <option value="MASCULINO">Masculino</option>
                <option value="FEMININO">Feminino</option>
                <option value="OUTRO">Outro</option>
              </Select>
            </Field>

            {/*
              Nota fiscal: só a NF-e (modelo 55) precisa disso. No cupom do
              balcão o CPF já basta — por isso fica fechado.
            */}
            <details className="group col-span-12 border-t border-line pt-3">
              <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-sm text-muted transition-colors hover:text-ink-2 [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  size={13}
                  className="shrink-0 transition-transform duration-200 group-open:rotate-90"
                />
                Dados para nota fiscal
              </summary>
              <div className="mt-3 grid grid-cols-12 gap-x-3 gap-y-3">
                <Field className="col-span-12 sm:col-span-6" label="E-mail" htmlFor="c-email">
                  <Input id="c-email" type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} placeholder="Para receber o XML/DANFE" />
                </Field>
                <Field className="col-span-12 sm:col-span-6" label="CNPJ (cliente empresa)" htmlFor="c-cnpj">
                  <Input id="c-cnpj" value={form.cnpj} onChange={(e) => upd("cnpj", maskCnpj(e.target.value))} inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" />
                </Field>
                <Field className="col-span-12 sm:col-span-6" label="Razão social" htmlFor="c-razao">
                  <Input id="c-razao" value={form.razaoSocial} onChange={(e) => upd("razaoSocial", e.target.value)} />
                </Field>
                <Field className="col-span-6 sm:col-span-3" label="Inscrição estadual" htmlFor="c-ie">
                  <Input id="c-ie" value={form.ie} onChange={(e) => upd("ie", e.target.value)} className="font-mono" />
                </Field>
                <Field className="col-span-6 sm:col-span-3" label="Indicador de IE" htmlFor="c-indie">
                  <Select id="c-indie" value={form.indicadorIE} onChange={(e) => upd("indicadorIE", e.target.value as CustomerForm["indicadorIE"])}>
                    <option value="">Não informar</option>
                    <option value="CONTRIBUINTE">Contribuinte</option>
                    <option value="ISENTO">Isento</option>
                    <option value="NAO_CONTRIBUINTE">Não contribuinte</option>
                  </Select>
                </Field>
                <Field className="col-span-6 sm:col-span-3" label="CEP" htmlFor="c-cep">
                  <Input id="c-cep" value={form.cep} onChange={(e) => upd("cep", maskCep(e.target.value))} inputMode="numeric" maxLength={9} placeholder="00000-000" className="font-mono" />
                </Field>
                <Field className="col-span-12 sm:col-span-6" label="Logradouro" htmlFor="c-log">
                  <Input id="c-log" value={form.logradouro} onChange={(e) => upd("logradouro", e.target.value)} />
                </Field>
                <Field className="col-span-6 sm:col-span-3" label="Número" htmlFor="c-num">
                  <Input id="c-num" value={form.numero} onChange={(e) => upd("numero", e.target.value)} />
                </Field>
                <Field className="col-span-6 sm:col-span-6" label="Complemento" htmlFor="c-comp">
                  <Input id="c-comp" value={form.complemento} onChange={(e) => upd("complemento", e.target.value)} />
                </Field>
                <Field className="col-span-6 sm:col-span-6" label="Bairro" htmlFor="c-bairro">
                  <Input id="c-bairro" value={form.bairro} onChange={(e) => upd("bairro", e.target.value)} />
                </Field>
                <Field className="col-span-6 sm:col-span-4" label="Município" htmlFor="c-mun">
                  <Input id="c-mun" value={form.municipio} onChange={(e) => upd("municipio", e.target.value)} />
                </Field>
                <Field className="col-span-3 sm:col-span-2" label="UF" htmlFor="c-uf">
                  <Input id="c-uf" value={form.uf} onChange={(e) => upd("uf", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
                </Field>
                <Field className="col-span-9 sm:col-span-6" label="Código IBGE do município" htmlFor="c-ibge" hint="A NF-e exige o código, não o nome.">
                  <Input id="c-ibge" value={form.codigoMunicipio} onChange={(e) => upd("codigoMunicipio", e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" className="font-mono" placeholder="4314902" />
                </Field>
              </div>
            </details>
          </div>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>

      {/* Níveis de fidelização — como funciona */}
      <Modal
        open={showTiers}
        onClose={() => setShowTiers(false)}
        title="Níveis de fidelização"
        description="O nível sobe sozinho conforme o total gasto acumulado do cliente."
        width="md"
      >
        <div className="divide-y divide-line">
          {tiersFromThresholds(tierThresholds).map((t) => (
            <div key={t.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className={cn("flex shrink-0 items-center gap-0.5", t.text)}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={13} className={i < t.estrelas ? "fill-current" : "opacity-25"} />
                ))}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-semibold", t.text)}>{t.label}</p>
                <p className="text-[12px] text-muted">
                  {t.minGasto === 0
                    ? "Nível inicial — todo cliente novo começa aqui."
                    : `A partir de ${brl(t.minGasto)} em compras acumuladas.`}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-faint">
          Estes são os valores padrão — ajuste em{" "}
          <Link
            href="/configuracoes/fidelizacao"
            onClick={() => setShowTiers(false)}
            className="font-medium text-brand hover:text-brand-strong"
          >
            Configurações → Fidelização
          </Link>
          .
        </p>
      </Modal>
    </div>
  );
}

/** Banner de cupons sugeridos (risco + aniversário). */
function IntelBanner({
  candidates, cupomAutomatico, onSent,
}: {
  candidates: CouponCandidate[];
  cupomAutomatico: boolean;
  onSent: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  function enviar(c: CouponCandidate) {
    setPendingId(c.customerId + c.tipo);
    start(async () => {
      try {
        const { waLink } = await sendCoupon(c.customerId, c.tipo);
        if (waLink) {
          window.open(waLink, "_blank", "noopener");
          toast.success("Cupom pronto", `WhatsApp aberto para ${c.nome.split(" ")[0]}.`);
        } else {
          toast.info("Cupom registrado", "Cadastre um WhatsApp para disparar a mensagem.");
        }
        onSent();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao enviar cupom.");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Send size={15} className="text-brand" /> Oportunidades de fidelização
        </h2>
        <Badge tone={cupomAutomatico ? "ok" : "neutral"}>
          {cupomAutomatico ? "Envio automático ligado" : "Envio manual"}
        </Badge>
      </div>
      <ul className="space-y-2">
        {candidates.slice(0, 6).map((c) => {
          const aniv = c.tipo === "ANIVERSARIO";
          const id = c.customerId + c.tipo;
          return (
            <li
              key={id}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius)] p-3",
                aniv ? "bg-accent-soft" : "bg-warn-soft",
              )}
            >
              <span className={cn("shrink-0", aniv ? "text-accent" : "text-warn")}>
                {aniv ? <Cake size={16} /> : <AlertTriangle size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">{c.nome}</p>
                <p className="text-[12px] text-muted">
                  {aniv ? `Aniversário em ${c.aniversario}` : `Sem comprar há ${c.dias} dias`}
                </p>
              </div>
              <Button size="sm" onClick={() => enviar(c)} disabled={pendingId === id} className="shrink-0 gap-1.5">
                <Send size={13} /> {pendingId === id ? "…" : "Enviar cupom"}
              </Button>
            </li>
          );
        })}
      </ul>
      {candidates.length > 6 && (
        <p className="mt-2 flex items-center gap-1 text-[12px] text-muted">
          <ChevronRight size={12} /> +{candidates.length - 6} outros clientes aguardando cupom
        </p>
      )}
    </div>
  );
}
