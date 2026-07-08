"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Search, MoreVertical, Pencil, Archive, ArchiveRestore, Users,
  Cake, AlertTriangle, Send, Star, ChevronRight,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn, brl } from "@/lib/utils";
import { maskCpf, maskDate, maskPhone } from "@/lib/masks";
import { tierFromGasto, fmtDataUTC, fmtDiasAtras } from "@/lib/customers";
import { CustomerSidePanel } from "@/components/app/customer-side-panel";
import {
  createCustomer, updateCustomer, setCustomerActive, sendCoupon,
} from "./actions";
import type { CustomerRow, CouponCandidate } from "./_types";
import type { Sexo } from "@/generated/prisma";

type CustomerForm = {
  id?: string;
  nome: string;
  cpf: string;
  dataNascimento: string;
  sexo: "" | Sexo;
  whatsapp: string;
};

const emptyForm = (): CustomerForm => ({
  nome: "", cpf: "", dataNascimento: "", sexo: "", whatsapp: "",
});

function formFromRow(c: CustomerRow): CustomerForm {
  return {
    id: c.id,
    nome: c.nome,
    cpf: c.cpf ? maskCpf(c.cpf) : "",
    dataNascimento: c.dataNascimento ? fmtDataUTC(c.dataNascimento) : "",
    sexo: c.sexo ?? "",
    whatsapp: c.whatsapp ? maskPhone(c.whatsapp) : "",
  };
}

export function ClientesClient({
  rows, candidates, cupomAutomatico, cupomDiasRisco,
}: {
  rows: CustomerRow[];
  candidates: CouponCandidate[];
  cupomAutomatico: boolean;
  cupomDiasRisco: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [modalError, setModalError] = useState<string>();
  const [selected, setSelected] = useState<CustomerRow | null>(null);

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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Clientes</h1>
          <p className="text-sm text-muted">
            Fidelize quem compra com você. {rows.length} {rows.length === 1 ? "cliente" : "clientes"}.
          </p>
        </div>
        <button
          onClick={() => { setModalError(undefined); setForm(emptyForm()); }}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          <Plus size={16} /> Adicionar
        </button>
      </div>

      {/* Inteligência — cupons sugeridos */}
      {pendentes.length > 0 && (
        <IntelBanner
          candidates={pendentes}
          cupomAutomatico={cupomAutomatico}
          onSent={refresh}
        />
      )}

      {/* Busca */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, CPF ou WhatsApp"
          className="pl-9"
        />
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
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {list.map((c, idx) => {
            const tier = tierFromGasto(c.totalGasto);
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
                      <Star size={10} className={cn("fill-current", tier.text)} />
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
          </div>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>
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
