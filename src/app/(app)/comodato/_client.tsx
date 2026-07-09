"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Search, MoreVertical, Pencil, Recycle, Package, Wrench,
  ArrowRightLeft, Undo2, Ban, CheckCircle2, Archive, ArchiveRestore,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn, brl } from "@/lib/utils";
import { maskDate } from "@/lib/masks";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import {
  createAsset, updateAsset, loanAssetAction, returnAssetAction, setAssetStatusAction,
  createContainerType, updateContainerType, setContainerTypeActive,
  registerContainerMovementAction,
} from "./actions";
import type {
  AssetRow, ContainerTypeRow, ContainerBalanceRow, CustomerOption,
} from "./_types";
import type { ComodatoAssetStatus } from "@/generated/prisma";

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });

const STATUS_BADGE: Record<ComodatoAssetStatus, { label: string; tone: "ok" | "brand" | "warn" | "neutral" }> = {
  DISPONIVEL: { label: "Disponível", tone: "ok" },
  EMPRESTADO: { label: "Emprestado", tone: "brand" },
  MANUTENCAO: { label: "Manutenção", tone: "warn" },
  BAIXADO: { label: "Baixado", tone: "neutral" },
};

// ── Máscara R$ (mesma família do caixa) ──
const fmtCentavos = (s: string) => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
const parseMask = (s: string): number | null => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10) / 100;
};
const toMask = (v: number | null) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Aba = "equipamentos" | "vasilhames";

type AssetForm = { id?: string; nome: string; identificacao: string; valorEstimado: string; observacao: string };
type LoanForm = { assetId: string; assetNome: string; customerId: string; previsaoDevolucao: string; condicaoSaida: string; observacao: string };
type ReturnForm = { loanId: string; assetNome: string; customerNome: string; condicaoRetorno: string; paraManutencao: boolean };
type TypeForm = { id?: string; nome: string; valorUnitario: string };
type MovForm = { containerTypeId: string; customerId: string; tipo: "ENTREGA" | "DEVOLUCAO" | "AJUSTE"; quantidade: string; observacao: string };

export function ComodatoClient({
  assets, containerTypes, balances, customers,
}: {
  assets: AssetRow[];
  containerTypes: ContainerTypeRow[];
  balances: ContainerBalanceRow[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aba, setAba] = useState<Aba>("equipamentos");
  const [q, setQ] = useState("");
  const [modalError, setModalError] = useState<string>();

  const [assetForm, setAssetForm] = useState<AssetForm | null>(null);
  const [loanForm, setLoanForm] = useState<LoanForm | null>(null);
  const [returnForm, setReturnForm] = useState<ReturnForm | null>(null);
  const [typeForm, setTypeForm] = useState<TypeForm | null>(null);
  const [movForm, setMovForm] = useState<MovForm | null>(null);

  const refresh = () => router.refresh();

  const assetsFiltrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return assets;
    return assets.filter((a) =>
      `${a.nome} ${a.identificacao} ${a.loanAtual?.customerNome ?? ""}`.toLowerCase().includes(t),
    );
  }, [assets, q]);

  const saldosFiltrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return balances;
    return balances.filter((b) =>
      `${b.customerNome} ${b.containerTypeNome}`.toLowerCase().includes(t),
    );
  }, [balances, q]);

  function run(fn: () => Promise<unknown>, sucesso: string, fecharForms = true) {
    setModalError(undefined);
    start(async () => {
      try {
        await fn();
        if (fecharForms) {
          setAssetForm(null); setLoanForm(null); setReturnForm(null);
          setTypeForm(null); setMovForm(null);
        }
        toast.success(sucesso);
        refresh();
      } catch (e) {
        setModalError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  const emCampo = assets.filter((a) => a.status === "EMPRESTADO").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Comodato"
        icon={navIcon("/comodato")}
        description={`Equipamentos e vasilhames emprestados a clientes. ${emCampo} equipamento${emCampo === 1 ? "" : "s"} em campo.`}
        innerClassName="max-w-none"
        actions={
          aba === "equipamentos" ? (
            <button
              onClick={() => { setModalError(undefined); setAssetForm({ nome: "", identificacao: "", valorEstimado: "", observacao: "" }); }}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <Plus size={16} /> Novo equipamento
            </button>
          ) : (
            <button
              onClick={() => {
                setModalError(undefined);
                setMovForm({ containerTypeId: containerTypes.find((t) => t.ativo)?.id ?? "", customerId: "", tipo: "ENTREGA", quantidade: "", observacao: "" });
              }}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <ArrowRightLeft size={16} /> Registrar movimento
            </button>
          )
        }
      />

      {/* Abas */}
      <div className="flex w-fit rounded-full border border-line bg-surface p-1">
        {([
          ["equipamentos", "Equipamentos"],
          ["vasilhames", "Vasilhames"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setAba(key); setQ(""); }}
            className={cn(
              "cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              aba === key ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={aba === "equipamentos" ? "Buscar por nome, identificação ou cliente" : "Buscar por cliente ou vasilhame"}
          className="pl-9"
        />
      </div>

      {aba === "equipamentos" ? (
        <ListaEquipamentos
          rows={assetsFiltrados}
          vazioTotal={assets.length === 0}
          pending={pending}
          onEditar={(a) => {
            setModalError(undefined);
            setAssetForm({ id: a.id, nome: a.nome, identificacao: a.identificacao, valorEstimado: toMask(a.valorEstimado), observacao: a.observacao ?? "" });
          }}
          onEmprestar={(a) => {
            setModalError(undefined);
            setLoanForm({ assetId: a.id, assetNome: a.nome, customerId: "", previsaoDevolucao: "", condicaoSaida: "", observacao: "" });
          }}
          onDevolver={(a) => {
            if (!a.loanAtual) return;
            setModalError(undefined);
            setReturnForm({ loanId: a.loanAtual.loanId, assetNome: a.nome, customerNome: a.loanAtual.customerNome, condicaoRetorno: "", paraManutencao: false });
          }}
          onStatus={(a, status) =>
            run(() => setAssetStatusAction(a.id, status), "Status atualizado.")
          }
        />
      ) : (
        <AbaVasilhames
          types={containerTypes}
          balances={saldosFiltrados}
          vazioSaldos={balances.length === 0}
          onNovoTipo={() => { setModalError(undefined); setTypeForm({ nome: "", valorUnitario: "" }); }}
          onEditarTipo={(t) => { setModalError(undefined); setTypeForm({ id: t.id, nome: t.nome, valorUnitario: toMask(t.valorUnitario) }); }}
          onToggleTipo={(t) =>
            run(() => setContainerTypeActive(t.id, !t.ativo), t.ativo ? "Vasilhame desativado." : "Vasilhame reativado.")
          }
        />
      )}

      {/* ── Sheet: equipamento ── */}
      <Sheet
        open={!!assetForm}
        onClose={() => setAssetForm(null)}
        title={assetForm?.id ? "Editar equipamento" : "Novo equipamento"}
        description="Equipamento seu que pode ser emprestado a um cliente."
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setAssetForm(null)} disabled={pending}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!assetForm) return;
                const payload = {
                  nome: assetForm.nome,
                  identificacao: assetForm.identificacao,
                  valorEstimado: parseMask(assetForm.valorEstimado),
                  observacao: assetForm.observacao || null,
                };
                run(
                  () => (assetForm.id ? updateAsset(assetForm.id, payload) : createAsset(payload)),
                  "Equipamento salvo.",
                );
              }}
              disabled={pending}
              className="gap-1"
            >
              <Plus size={16} /> {pending ? "Salvando…" : "Salvar equipamento"}
            </Button>
          </div>
        }
      >
        {assetForm && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12" label="Nome" htmlFor="a-nome">
              <Input id="a-nome" value={assetForm.nome} onChange={(e) => setAssetForm({ ...assetForm, nome: e.target.value })} placeholder="Chopeira 2 vias" autoFocus />
            </Field>
            <Field className="col-span-12 sm:col-span-7" label="Identificação (serial/patrimônio)" htmlFor="a-id">
              <Input id="a-id" value={assetForm.identificacao} onChange={(e) => setAssetForm({ ...assetForm, identificacao: e.target.value })} placeholder="CHOP-001" className="font-mono" />
            </Field>
            <Field className="col-span-12 sm:col-span-5" label="Valor de reposição (R$)" htmlFor="a-valor">
              <Input id="a-valor" value={assetForm.valorEstimado} onChange={(e) => setAssetForm({ ...assetForm, valorEstimado: fmtCentavos(e.target.value) })} inputMode="numeric" placeholder="0,00" className="tabular-nums" />
            </Field>
            <Field className="col-span-12" label="Observação (opcional)" htmlFor="a-obs">
              <Input id="a-obs" value={assetForm.observacao} onChange={(e) => setAssetForm({ ...assetForm, observacao: e.target.value })} placeholder="Detalhes, estado, acessórios…" />
            </Field>
          </div>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>

      {/* ── Sheet: emprestar ── */}
      <Sheet
        open={!!loanForm}
        onClose={() => setLoanForm(null)}
        title="Emprestar equipamento"
        description={loanForm ? `${loanForm.assetNome} sai em comodato para o cliente escolhido.` : ""}
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setLoanForm(null)} disabled={pending}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!loanForm) return;
                run(
                  () => loanAssetAction({
                    assetId: loanForm.assetId,
                    customerId: loanForm.customerId,
                    previsaoDevolucao: loanForm.previsaoDevolucao || null,
                    condicaoSaida: loanForm.condicaoSaida || null,
                    observacao: loanForm.observacao || null,
                  }),
                  "Empréstimo registrado.",
                );
              }}
              disabled={pending || !loanForm?.customerId}
              className="gap-1"
            >
              <ArrowRightLeft size={16} /> {pending ? "Salvando…" : "Emprestar"}
            </Button>
          </div>
        }
      >
        {loanForm && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12" label="Cliente" htmlFor="l-cliente">
              <Select id="l-cliente" value={loanForm.customerId} onChange={(e) => setLoanForm({ ...loanForm, customerId: e.target.value })}>
                <option value="">Escolha o cliente…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </Select>
            </Field>
            <Field className="col-span-6" label="Previsão de devolução (opcional)" htmlFor="l-prev">
              <Input id="l-prev" value={loanForm.previsaoDevolucao} onChange={(e) => setLoanForm({ ...loanForm, previsaoDevolucao: maskDate(e.target.value) })} inputMode="numeric" maxLength={10} placeholder="dd/mm/aaaa" />
            </Field>
            <Field className="col-span-6" label="Condição na saída (opcional)" htmlFor="l-cond">
              <Input id="l-cond" value={loanForm.condicaoSaida} onChange={(e) => setLoanForm({ ...loanForm, condicaoSaida: e.target.value })} placeholder="Ex.: novo, riscado…" />
            </Field>
            <Field className="col-span-12" label="Observação (opcional)" htmlFor="l-obs">
              <Input id="l-obs" value={loanForm.observacao} onChange={(e) => setLoanForm({ ...loanForm, observacao: e.target.value })} placeholder="Contrato, endereço de instalação…" />
            </Field>
          </div>
        )}
        {customers.length === 0 && (
          <p className="mt-3 text-sm text-muted">
            Nenhum cliente ativo cadastrado — cadastre em Clientes antes de emprestar.
          </p>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>

      {/* ── Sheet: devolver ── */}
      <Sheet
        open={!!returnForm}
        onClose={() => setReturnForm(null)}
        title="Registrar devolução"
        description={returnForm ? `${returnForm.assetNome} volta de ${returnForm.customerNome}.` : ""}
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturnForm(null)} disabled={pending}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!returnForm) return;
                run(
                  () => returnAssetAction({
                    loanId: returnForm.loanId,
                    condicaoRetorno: returnForm.condicaoRetorno || null,
                    paraManutencao: returnForm.paraManutencao,
                  }),
                  "Devolução registrada.",
                );
              }}
              disabled={pending}
              className="gap-1"
            >
              <Undo2 size={16} /> {pending ? "Salvando…" : "Confirmar devolução"}
            </Button>
          </div>
        }
      >
        {returnForm && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12" label="Condição no retorno (opcional)" htmlFor="r-cond">
              <Input id="r-cond" value={returnForm.condicaoRetorno} onChange={(e) => setReturnForm({ ...returnForm, condicaoRetorno: e.target.value })} placeholder="Ex.: ok, precisa de limpeza…" />
            </Field>
            <label className="col-span-12 flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={returnForm.paraManutencao}
                onChange={(e) => setReturnForm({ ...returnForm, paraManutencao: e.target.checked })}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              Enviar para manutenção em vez de disponível
            </label>
          </div>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>

      {/* ── Sheet: tipo de vasilhame ── */}
      <Sheet
        open={!!typeForm}
        onClose={() => setTypeForm(null)}
        title={typeForm?.id ? "Editar vasilhame" : "Novo tipo de vasilhame"}
        description="Retornável controlado por quantidade (casco, barril, garrafão…)."
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setTypeForm(null)} disabled={pending}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!typeForm) return;
                const payload = { nome: typeForm.nome, valorUnitario: parseMask(typeForm.valorUnitario) };
                run(
                  () => (typeForm.id ? updateContainerType(typeForm.id, payload) : createContainerType(payload)),
                  "Vasilhame salvo.",
                );
              }}
              disabled={pending}
              className="gap-1"
            >
              <Plus size={16} /> {pending ? "Salvando…" : "Salvar vasilhame"}
            </Button>
          </div>
        }
      >
        {typeForm && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12 sm:col-span-7" label="Nome" htmlFor="t-nome">
              <Input id="t-nome" value={typeForm.nome} onChange={(e) => setTypeForm({ ...typeForm, nome: e.target.value })} placeholder="Casco 600ml" autoFocus />
            </Field>
            <Field className="col-span-12 sm:col-span-5" label="Valor unitário (R$)" htmlFor="t-valor">
              <Input id="t-valor" value={typeForm.valorUnitario} onChange={(e) => setTypeForm({ ...typeForm, valorUnitario: fmtCentavos(e.target.value) })} inputMode="numeric" placeholder="0,00" className="tabular-nums" />
            </Field>
          </div>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>

      {/* ── Sheet: movimento de vasilhame ── */}
      <Sheet
        open={!!movForm}
        onClose={() => setMovForm(null)}
        title="Registrar movimento"
        description="Entrega, devolução ou ajuste de vasilhames de um cliente."
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setMovForm(null)} disabled={pending}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!movForm) return;
                const qtd = parseInt(movForm.quantidade, 10);
                if (!Number.isFinite(qtd)) { setModalError("Informe a quantidade."); return; }
                run(
                  () => registerContainerMovementAction({
                    containerTypeId: movForm.containerTypeId,
                    customerId: movForm.customerId,
                    tipo: movForm.tipo,
                    quantidade: qtd,
                    observacao: movForm.observacao || null,
                  }),
                  "Movimento registrado.",
                );
              }}
              disabled={pending || !movForm?.containerTypeId || !movForm?.customerId}
              className="gap-1"
            >
              <ArrowRightLeft size={16} /> {pending ? "Salvando…" : "Registrar"}
            </Button>
          </div>
        }
      >
        {movForm && (
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field className="col-span-12 sm:col-span-6" label="Tipo de movimento" htmlFor="m-tipo">
              <Select id="m-tipo" value={movForm.tipo} onChange={(e) => setMovForm({ ...movForm, tipo: e.target.value as MovForm["tipo"] })}>
                <option value="ENTREGA">Entrega ao cliente</option>
                <option value="DEVOLUCAO">Devolução do cliente</option>
                <option value="AJUSTE">Ajuste manual (±)</option>
              </Select>
            </Field>
            <Field className="col-span-12 sm:col-span-6" label="Vasilhame" htmlFor="m-vasilhame">
              <Select id="m-vasilhame" value={movForm.containerTypeId} onChange={(e) => setMovForm({ ...movForm, containerTypeId: e.target.value })}>
                <option value="">Escolha…</option>
                {containerTypes.filter((t) => t.ativo || t.id === movForm.containerTypeId).map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </Select>
            </Field>
            <Field className="col-span-12 sm:col-span-8" label="Cliente" htmlFor="m-cliente">
              <Select id="m-cliente" value={movForm.customerId} onChange={(e) => setMovForm({ ...movForm, customerId: e.target.value })}>
                <option value="">Escolha o cliente…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </Select>
            </Field>
            <Field className="col-span-12 sm:col-span-4" label={movForm.tipo === "AJUSTE" ? "Quantidade (±)" : "Quantidade"} htmlFor="m-qtd">
              <Input
                id="m-qtd"
                value={movForm.quantidade}
                onChange={(e) => {
                  const permitido = movForm.tipo === "AJUSTE" ? e.target.value.replace(/[^\d-]/g, "") : e.target.value.replace(/\D/g, "");
                  setMovForm({ ...movForm, quantidade: permitido });
                }}
                inputMode="numeric"
                placeholder={movForm.tipo === "AJUSTE" ? "-2" : "12"}
                className="tabular-nums"
              />
            </Field>
            <Field className="col-span-12" label="Observação (opcional)" htmlFor="m-obs">
              <Input id="m-obs" value={movForm.observacao} onChange={(e) => setMovForm({ ...movForm, observacao: e.target.value })} placeholder="Nota, motivo do ajuste…" />
            </Field>
          </div>
        )}
        {modalError && <p className="mt-3 text-sm text-danger">{modalError}</p>}
      </Sheet>
    </div>
  );
}

// ── Lista de equipamentos ────────────────────────────────────
function ListaEquipamentos({
  rows, vazioTotal, pending, onEditar, onEmprestar, onDevolver, onStatus,
}: {
  rows: AssetRow[];
  vazioTotal: boolean;
  pending: boolean;
  onEditar: (a: AssetRow) => void;
  onEmprestar: (a: AssetRow) => void;
  onDevolver: (a: AssetRow) => void;
  onStatus: (a: AssetRow, status: "DISPONIVEL" | "MANUTENCAO" | "BAIXADO") => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
        <Recycle size={32} className="text-faint" />
        <p className="text-sm text-muted">
          {vazioTotal
            ? "Nenhum equipamento cadastrado. Cadastre a primeira chopeira, freezer ou cilindro."
            : "Nenhum equipamento encontrado para essa busca."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      {rows.map((a, idx) => {
        const badge = STATUS_BADGE[a.status];
        return (
          <div
            key={a.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
              idx !== 0 && "border-t border-line",
            )}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <Package size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium text-ink", a.status === "BAIXADO" && "text-faint line-through")}>
                {a.nome}
              </p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
                <span className="font-mono">{a.identificacao}</span>
                {a.loanAtual && (
                  <span>· com {a.loanAtual.customerNome} desde {fmtData(a.loanAtual.emprestadoEm)}</span>
                )}
                {a.loanAtual?.previsaoDevolucao && (
                  <span>· devolução prevista {fmtData(a.loanAtual.previsaoDevolucao)}</span>
                )}
              </p>
            </div>
            {a.valorEstimado != null && (
              <span className="hidden font-mono text-sm text-muted sm:block">{brl(a.valorEstimado)}</span>
            )}
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Ações do equipamento"
                  className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <MoreVertical size={16} />
                </button>
              }
            >
              {a.status === "DISPONIVEL" && (
                <MenuItem icon={<ArrowRightLeft size={15} />} onClick={() => onEmprestar(a)}>
                  Emprestar
                </MenuItem>
              )}
              {a.status === "EMPRESTADO" && (
                <MenuItem icon={<Undo2 size={15} />} onClick={() => onDevolver(a)}>
                  Registrar devolução
                </MenuItem>
              )}
              <MenuItem icon={<Pencil size={15} />} onClick={() => onEditar(a)}>
                Editar
              </MenuItem>
              {a.status === "DISPONIVEL" && (
                <MenuItem icon={<Wrench size={15} />} onClick={() => onStatus(a, "MANUTENCAO")} disabled={pending}>
                  Enviar para manutenção
                </MenuItem>
              )}
              {(a.status === "MANUTENCAO" || a.status === "BAIXADO") && (
                <MenuItem icon={<CheckCircle2 size={15} />} onClick={() => onStatus(a, "DISPONIVEL")} disabled={pending}>
                  Marcar disponível
                </MenuItem>
              )}
              {a.status !== "BAIXADO" && a.status !== "EMPRESTADO" && (
                <MenuItem icon={<Ban size={15} />} onClick={() => onStatus(a, "BAIXADO")} disabled={pending}>
                  Baixar (fora de uso)
                </MenuItem>
              )}
            </Menu>
          </div>
        );
      })}
    </div>
  );
}

// ── Aba de vasilhames ────────────────────────────────────────
function AbaVasilhames({
  types, balances, vazioSaldos, onNovoTipo, onEditarTipo, onToggleTipo,
}: {
  types: ContainerTypeRow[];
  balances: ContainerBalanceRow[];
  vazioSaldos: boolean;
  onNovoTipo: () => void;
  onEditarTipo: (t: ContainerTypeRow) => void;
  onToggleTipo: (t: ContainerTypeRow) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Tipos */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Tipos de vasilhame</h2>
          <Button variant="outline" size="sm" onClick={onNovoTipo} className="gap-1">
            <Plus size={14} /> Novo tipo
          </Button>
        </div>
        {types.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
            Nenhum tipo cadastrado. Crie «Casco 600ml», «Barril 30L»…
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-semibold text-ink", !t.ativo && "text-faint line-through")}>
                    {t.nome}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t.totalEmCampo} em campo
                    {t.valorUnitario != null && ` · ${brl(t.valorUnitario)}/un`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {!t.ativo && <Badge>Inativo</Badge>}
                  <Menu
                    align="end"
                    trigger={
                      <button
                        type="button"
                        aria-label="Ações do vasilhame"
                        className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <MoreVertical size={16} />
                      </button>
                    }
                  >
                    <MenuItem icon={<Pencil size={15} />} onClick={() => onEditarTipo(t)}>
                      Editar
                    </MenuItem>
                    <MenuItem
                      icon={t.ativo ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                      onClick={() => onToggleTipo(t)}
                    >
                      {t.ativo ? "Desativar" : "Reativar"}
                    </MenuItem>
                  </Menu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saldos por cliente */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Saldos por cliente</h2>
        {balances.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
            <Recycle size={32} className="text-faint" />
            <p className="text-sm text-muted">
              {vazioSaldos
                ? "Nenhum vasilhame em campo. Registre a primeira entrega."
                : "Nenhum saldo encontrado para essa busca."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Vasilhame</th>
                  <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Última movimentação</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b, idx) => (
                  <tr key={b.customerId + b.containerTypeId} className={cn(idx !== 0 && "border-t border-line")}>
                    <td className="px-4 py-2.5 font-medium text-ink">{b.customerNome}</td>
                    <td className="px-4 py-2.5 text-muted">{b.containerTypeNome}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-ink">
                      {b.saldo}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs text-faint sm:table-cell">
                      {fmtData(b.ultimaMovimentacao)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
