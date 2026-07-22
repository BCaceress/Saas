"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  PencilLine,
  RefreshCw,
  Scissors,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal, Sheet } from "@/components/ui/sheet";
import { Badge, Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { maskCnpj, maskCpf } from "@/lib/masks";
import { fmtMoney, relDia } from "../../compras/_ui";
import {
  cancelarNotaAction,
  cartaCorrecaoAction,
  inutilizarFaixaAction,
  reenviarDocumentoAction,
} from "./actions";

type Status =
  | "PENDENTE"
  | "PROCESSANDO"
  | "AUTORIZADO"
  | "REJEITADO"
  | "DENEGADO"
  | "CANCELADO"
  | "CONTINGENCIA"
  | "INUTILIZADO";

export type NotaEmitida = {
  id: string;
  modelo: "NFCE" | "NFE";
  status: Status;
  serie: number;
  numero: number;
  chave: string | null;
  protocolo: string | null;
  dataEmissao: string;
  dataAutorizacao: string | null;
  destNome: string | null;
  destDocumento: string | null;
  valorTotal: number;
  motivoRejeicao: string | null;
  codigoRejeicao: string | null;
  contingencia: boolean;
  urlConsulta: string | null;
  siteNome: string;
  siteId: string;
  saleId: string | null;
};

const STATUS_UI: Record<
  Status,
  { label: string; tone: "ok" | "warn" | "danger" | "brand" | "neutral"; icon: React.ElementType }
> = {
  PENDENTE: { label: "Na fila", tone: "brand", icon: Loader2 },
  PROCESSANDO: { label: "Transmitindo", tone: "brand", icon: Loader2 },
  AUTORIZADO: { label: "Autorizada", tone: "ok", icon: CheckCircle2 },
  REJEITADO: { label: "Rejeitada", tone: "danger", icon: AlertTriangle },
  DENEGADO: { label: "Denegada", tone: "danger", icon: Ban },
  CANCELADO: { label: "Cancelada", tone: "neutral", icon: Ban },
  CONTINGENCIA: { label: "Contingência", tone: "warn", icon: WifiOff },
  INUTILIZADO: { label: "Inutilizada", tone: "neutral", icon: Scissors },
};

const FILTROS = [
  { id: "TODAS", label: "Todas" },
  { id: "AUTORIZADO", label: "Autorizadas" },
  { id: "PENDENTES", label: "Em andamento" },
  { id: "REJEITADO", label: "Rejeitadas" },
  { id: "CANCELADO", label: "Canceladas" },
] as const;

const EM_ANDAMENTO: Status[] = ["PENDENTE", "PROCESSANDO", "CONTINGENCIA"];

/** Minutos restantes para cancelar. null = não se aplica. */
function minutosParaCancelar(nota: NotaEmitida, prazoMin: number): number | null {
  if (nota.status !== "AUTORIZADO" || !nota.dataAutorizacao) return null;
  const passados = (Date.now() - new Date(nota.dataAutorizacao).getTime()) / 60_000;
  return Math.floor(prazoMin - passados);
}

export function NotasEmitidasClient({
  notas,
  sites,
  prazoCancelamentoMin,
  podeCancelar,
  podeCorrigir,
  podeBaixar,
  podeEmitir,
}: {
  notas: NotaEmitida[];
  sites: { id: string; nome: string }[];
  prazoCancelamentoMin: number;
  podeCancelar: boolean;
  podeCorrigir: boolean;
  podeBaixar: boolean;
  podeEmitir: boolean;
}) {
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("TODAS");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<NotaEmitida | null>(null);
  const [inutilizando, setInutilizando] = useState(false);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return notas.filter((n) => {
      const passaFiltro =
        filtro === "TODAS" ||
        (filtro === "PENDENTES" ? EM_ANDAMENTO.includes(n.status) : n.status === filtro);
      if (!passaFiltro) return false;
      if (!q) return true;
      return (
        String(n.numero).includes(q) ||
        (n.chave ?? "").includes(q) ||
        (n.destNome ?? "").toLowerCase().includes(q) ||
        (n.destDocumento ?? "").includes(q)
      );
    });
  }, [notas, filtro, busca]);

  const rejeitadas = notas.filter((n) => n.status === "REJEITADO").length;

  return (
    <>
      {rejeitadas > 0 && (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-ink-2">
            {rejeitadas} nota(s) rejeitada(s). O número já saiu da série — depois de corrigir o
            cadastro, inutilize a faixa para explicar o salto à SEFAZ.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtro === f.id
                ? "border-transparent bg-brand text-white"
                : "border-line text-muted hover:bg-surface-2",
            )}
          >
            {f.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Número, chave ou cliente"
            className="w-56"
            aria-label="Buscar nota"
          />
          {podeCorrigir && (
            <Button variant="outline" onClick={() => setInutilizando(true)}>
              <Scissors size={16} /> Inutilizar faixa
            </Button>
          )}
        </div>
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-line bg-surface p-10 text-center">
          <FileText size={22} className="mx-auto text-faint" />
          <p className="mt-3 font-semibold text-ink">Nenhuma nota aqui</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            As notas aparecem sozinhas conforme as vendas são fechadas no PDV.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nota</th>
                <th className="px-4 py-3 font-medium">Modelo</th>
                <th className="px-4 py-3 font-medium">Destinatário</th>
                <th className="px-4 py-3 font-medium">Emissão</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visiveis.map((n) => {
                const ui = STATUS_UI[n.status];
                return (
                  <tr
                    key={n.id}
                    onClick={() => setAberta(n)}
                    className="cursor-pointer transition-colors hover:bg-surface-2"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-ink-2">
                      {n.numero}/{n.serie}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {n.modelo === "NFCE" ? "NFC-e" : "NF-e"}
                    </td>
                    <td className="px-4 py-3">
                      {n.destNome ? (
                        <>
                          <p className="text-ink">{n.destNome}</p>
                          {n.destDocumento && (
                            <p className="font-mono text-[11px] text-faint">
                              {n.destDocumento.length > 11
                                ? maskCnpj(n.destDocumento)
                                : maskCpf(n.destDocumento)}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-faint">Consumidor não identificado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{relDia(n.dataEmissao)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtMoney(n.valorTotal)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={ui.tone}>
                        <ui.icon size={11} className={n.status === "PROCESSANDO" ? "animate-spin" : ""} />
                        {ui.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {aberta && (
        <DetalheNota
          nota={notas.find((n) => n.id === aberta.id) ?? aberta}
          prazoCancelamentoMin={prazoCancelamentoMin}
          podeCancelar={podeCancelar}
          podeCorrigir={podeCorrigir}
          podeBaixar={podeBaixar}
          podeEmitir={podeEmitir}
          onClose={() => setAberta(null)}
        />
      )}

      {inutilizando && (
        <InutilizarFaixa sites={sites} onClose={() => setInutilizando(false)} />
      )}
    </>
  );
}

// ── Detalhe ─────────────────────────────────────────────────

function DetalheNota({
  nota,
  prazoCancelamentoMin,
  podeCancelar,
  podeCorrigir,
  podeBaixar,
  podeEmitir,
  onClose,
}: {
  nota: NotaEmitida;
  prazoCancelamentoMin: number;
  podeCancelar: boolean;
  podeCorrigir: boolean;
  podeBaixar: boolean;
  podeEmitir: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<"cancelar" | "cce" | null>(null);
  const [texto, setTexto] = useState("");

  const restam = minutosParaCancelar(nota, prazoCancelamentoMin);
  const podeCancelarAgora = podeCancelar && restam !== null && restam > 0;
  // CC-e é só de NF-e — a SEFAZ não aceita em NFC-e.
  const aceitaCce = podeCorrigir && nota.modelo === "NFE" && nota.status === "AUTORIZADO";
  const naFila = EM_ANDAMENTO.includes(nota.status);

  function executar(fn: () => Promise<{ ok: boolean; mensagem: string }>) {
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          toast.success(r.mensagem);
          setModal(null);
          setTexto("");
          onClose();
        } else {
          toast.error("A SEFAZ recusou", r.mensagem);
        }
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha na operação.");
      }
    });
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={`${nota.modelo === "NFCE" ? "NFC-e" : "NF-e"} ${nota.numero}/${nota.serie}`}
        description={nota.siteNome}
        width="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {podeEmitir && naFila && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await reenviarDocumentoAction(nota.id);
                      toast.success("Reenviada para a SEFAZ.");
                      router.refresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Falha ao reenviar.");
                    }
                  })
                }
              >
                <RefreshCw size={16} /> Tentar de novo
              </Button>
            )}
            {aceitaCce && (
              <Button variant="outline" onClick={() => setModal("cce")} disabled={pending}>
                <PencilLine size={16} /> Carta de correção
              </Button>
            )}
            {podeCancelar && nota.status === "AUTORIZADO" && (
              <Button
                variant="outline"
                onClick={() => setModal("cancelar")}
                disabled={pending || !podeCancelarAgora}
                title={podeCancelarAgora ? undefined : "Fora do prazo de cancelamento"}
              >
                <Ban size={16} /> Cancelar nota
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[var(--radius-md)] border border-line bg-surface-2 p-4 sm:grid-cols-3">
            <Info label="Situação" valor={STATUS_UI[nota.status].label} />
            <Info label="Emissão" valor={relDia(nota.dataEmissao)} />
            <Info label="Valor" valor={fmtMoney(nota.valorTotal)} mono />
            <Info
              label="Destinatário"
              valor={nota.destNome ?? "Consumidor não identificado"}
            />
            <Info label="Protocolo" valor={nota.protocolo ?? "—"} mono />
            <Info
              label="Prazo p/ cancelar"
              valor={
                restam === null
                  ? "—"
                  : restam > 0
                    ? `${restam} min restantes`
                    : "vencido — use devolução"
              }
            />
            {nota.chave && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-[11px] uppercase tracking-wider text-faint">Chave de acesso</p>
                <p className="mt-0.5 font-mono text-[11px] break-all text-ink-2">{nota.chave}</p>
              </div>
            )}
          </div>

          {nota.status === "REJEITADO" && (
            <div className="rounded-[var(--radius-md)] border border-danger/30 bg-danger-soft p-4">
              <p className="text-sm font-medium text-danger">
                Rejeitada{nota.codigoRejeicao ? ` (${nota.codigoRejeicao})` : ""}
              </p>
              <p className="mt-1 text-sm text-ink-2">{nota.motivoRejeicao}</p>
              <p className="mt-2 text-xs text-muted">
                Corrija o cadastro e refaça a venda. Este número não volta a ser usado — inutilize
                a faixa para justificar o salto.
              </p>
            </div>
          )}

          {nota.contingencia && (
            <p className="text-sm text-warn">
              Emitida em contingência: o cupom vale, a transmissão segue pendente.
            </p>
          )}

          {(podeBaixar || nota.urlConsulta) && (
            <div className="flex flex-wrap gap-2">
              {podeBaixar && nota.status !== "PENDENTE" && (
                <>
                  <a
                    href={`/api/fiscal/documentos/${nota.id}/xml`}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    <FileDown size={15} /> Baixar XML
                  </a>
                  <a
                    href={`/api/fiscal/documentos/${nota.id}/pdf`}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    <FileText size={15} /> Baixar DANFE
                  </a>
                </>
              )}
              {nota.urlConsulta && (
                <a
                  href={nota.urlConsulta}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2"
                >
                  <ExternalLink size={15} /> Consultar na SEFAZ
                </a>
              )}
            </div>
          )}
        </div>
      </Sheet>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === "cancelar" ? "Cancelar nota" : "Carta de correção"}
        description={
          modal === "cancelar"
            ? "O cancelamento é definitivo e vai para a SEFAZ."
            : "Corrige informação que não muda valor, imposto, destinatário nem data."
        }
        width="md"
      >
        <Field
          label={modal === "cancelar" ? "Justificativa" : "Texto da correção"}
          htmlFor="texto"
          hint="Mínimo de 15 caracteres — a SEFAZ recusa textos curtos."
        >
          <Textarea
            id="texto"
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={
              modal === "cancelar"
                ? "Ex.: cliente desistiu da compra logo após a emissão"
                : "Ex.: o transportador correto é Transportes Silva Ltda"
            }
          />
        </Field>
        <p className="mt-1 text-xs text-muted">{texto.trim().length}/15</p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)} disabled={pending}>
            Voltar
          </Button>
          <Button
            disabled={pending || texto.trim().length < 15}
            onClick={() =>
              executar(() =>
                modal === "cancelar"
                  ? cancelarNotaAction({ documentId: nota.id, justificativa: texto })
                  : cartaCorrecaoAction({ documentId: nota.id, correcao: texto }),
              )
            }
          >
            {pending ? "Enviando…" : modal === "cancelar" ? "Cancelar nota" : "Enviar correção"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function Info({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-faint">{label}</p>
      <p className={cn("mt-0.5 text-sm text-ink-2", mono && "font-mono")}>{valor}</p>
    </div>
  );
}

// ── Inutilização ────────────────────────────────────────────

function InutilizarFaixa({
  sites,
  onClose,
}: {
  sites: { id: string; nome: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    siteId: sites[0]?.id ?? "",
    modelo: "NFCE" as "NFCE" | "NFE",
    serie: "1",
    numeroInicial: "",
    numeroFinal: "",
    justificativa: "",
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  function enviar() {
    start(async () => {
      try {
        const r = await inutilizarFaixaAction(form);
        if (r.ok) {
          toast.success(r.mensagem);
          onClose();
        } else {
          toast.error("A SEFAZ recusou", r.mensagem);
        }
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao inutilizar.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Inutilizar faixa de numeração"
      description="Declara à SEFAZ que estes números não viraram nota. Serve para o salto deixado por uma rejeição."
      width="md"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loja" htmlFor="i-site">
          <Select id="i-site" value={form.siteId} onChange={(e) => set({ siteId: e.target.value })}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Modelo" htmlFor="i-modelo">
          <Select
            id="i-modelo"
            value={form.modelo}
            onChange={(e) => set({ modelo: e.target.value as "NFCE" | "NFE" })}
          >
            <option value="NFCE">NFC-e (65)</option>
            <option value="NFE">NF-e (55)</option>
          </Select>
        </Field>
        <Field label="Série" htmlFor="i-serie">
          <Input
            id="i-serie"
            value={form.serie}
            onChange={(e) => set({ serie: e.target.value.replace(/\D/g, "") })}
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nº inicial" htmlFor="i-ini">
            <Input
              id="i-ini"
              value={form.numeroInicial}
              onChange={(e) => set({ numeroInicial: e.target.value.replace(/\D/g, "") })}
              inputMode="numeric"
              className="font-mono"
            />
          </Field>
          <Field label="Nº final" htmlFor="i-fim">
            <Input
              id="i-fim"
              value={form.numeroFinal}
              onChange={(e) => set({ numeroFinal: e.target.value.replace(/\D/g, "") })}
              inputMode="numeric"
              className="font-mono"
            />
          </Field>
        </div>
        <Field
          label="Justificativa"
          htmlFor="i-just"
          hint="Mínimo de 15 caracteres."
          className="sm:col-span-2"
        >
          <Textarea
            id="i-just"
            rows={2}
            value={form.justificativa}
            onChange={(e) => set({ justificativa: e.target.value })}
            placeholder="Ex.: numeração perdida por rejeição de NCM inválido"
          />
        </Field>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Voltar
        </Button>
        <Button
          onClick={enviar}
          disabled={
            pending ||
            !form.numeroInicial ||
            !form.numeroFinal ||
            form.justificativa.trim().length < 15
          }
        >
          {pending ? "Enviando…" : "Inutilizar"}
        </Button>
      </div>
    </Modal>
  );
}
