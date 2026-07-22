"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Gift,
  Link2,
  PackageCheck,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Badge, Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj } from "@/lib/masks";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtQtd, relDia } from "../../compras/_ui";
import {
  buscarProdutosAction,
  descartarNotaAction,
  importarXmlAction,
  pedidosDoFornecedorAction,
  receberNotaAction,
  relacionarItemAction,
  vincularPedidoAction,
} from "./actions";

type Status = "PENDENTE" | "CONCILIADO" | "RECEBIDO" | "DESCARTADO";

export type ItemNota = {
  id: string;
  ordem: number;
  codigoFornecedor: string;
  gtin: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorIpi: number;
  valorFrete: number;
  bonificacao: boolean;
  productId: string | null;
  productNome: string | null;
  productSku: string | null;
  packagingId: string | null;
  fatorConversao: number;
};

export type NotaRecebida = {
  id: string;
  status: Status;
  chave: string;
  numero: number;
  serie: number;
  dataEmissao: string;
  valorTotal: number;
  emitCnpj: string;
  emitRazaoSocial: string;
  emitUf: string | null;
  supplierId: string | null;
  pedidoNumero: string | null;
  purchaseOrderId: string | null;
  temEntrada: boolean;
  observacao: string | null;
  itens: ItemNota[];
};

const STATUS_UI: Record<Status, { label: string; tone: "warn" | "brand" | "ok" | "neutral" }> = {
  PENDENTE: { label: "Falta relacionar", tone: "warn" },
  CONCILIADO: { label: "Pronta para receber", tone: "brand" },
  RECEBIDO: { label: "Recebida", tone: "ok" },
  DESCARTADO: { label: "Descartada", tone: "neutral" },
};

/** Custo real do item: mercadoria + ST + IPI + frete − desconto. */
function custoItem(i: ItemNota): number {
  if (i.bonificacao) return 0;
  return Math.max(0, i.valorTotal - i.valorDesconto + i.valorIcmsSt + i.valorIpi + i.valorFrete);
}

export function NotasRecebidasClient({
  notas,
  podeImportar,
}: {
  notas: NotaRecebida[];
  podeImportar: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [aberta, setAberta] = useState<NotaRecebida | null>(null);
  const [filtro, setFiltro] = useState<"TODAS" | Status>("TODAS");
  const fileRef = useRef<HTMLInputElement>(null);

  const visiveis = filtro === "TODAS" ? notas : notas.filter((n) => n.status === filtro);
  const pendentes = notas.filter((n) => n.status === "PENDENTE").length;

  async function enviarArquivos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const form = new FormData();
    for (const f of files) form.append("arquivos", f);

    setEnviando(true);
    try {
      const r = await importarXmlAction(form);
      const importadas = r.filter((x) => x.status === "IMPORTADA").length;
      const duplicadas = r.filter((x) => x.status === "DUPLICADA").length;
      const erros = r.filter((x) => x.status === "ERRO");

      if (importadas > 0) {
        const auto = r
          .filter((x) => x.status === "IMPORTADA")
          .reduce((s, x) => s + (x.itensResolvidos ?? 0), 0);
        const total = r
          .filter((x) => x.status === "IMPORTADA")
          .reduce((s, x) => s + (x.itensTotal ?? 0), 0);
        toast.success(
          `${importadas} nota(s) importada(s).`,
          `${auto} de ${total} itens já entraram relacionados.`,
        );
      }
      if (duplicadas > 0) {
        toast.info(
          `${duplicadas} nota(s) já tinham sido importadas.`,
          "A mesma chave não entra duas vezes — o estoque dobraria.",
        );
      }
      for (const e of erros.slice(0, 3)) {
        toast.error(e.arquivo, e.motivo ?? "Falha ao importar.");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao importar os arquivos.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {pendentes > 0 && (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-warn/40 bg-warn-soft p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-sm text-ink-2">
            {pendentes} nota(s) esperando você dizer a que produto cada item corresponde. Depois
            da primeira vez, o mesmo item entra sozinho nas próximas notas do fornecedor.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {podeImportar && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,.zip,text/xml,application/xml,application/zip"
              multiple
              className="hidden"
              onChange={enviarArquivos}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={enviando} className="mr-2">
              <Upload size={16} /> {enviando ? "Importando…" : "Importar XML"}
            </Button>
          </>
        )}
        {(["TODAS", "PENDENTE", "CONCILIADO", "RECEBIDO", "DESCARTADO"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtro === f
                ? "border-transparent bg-brand text-white"
                : "border-line text-muted hover:bg-surface-2",
            )}
          >
            {f === "TODAS" ? "Todas" : STATUS_UI[f].label}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-line bg-surface p-10 text-center">
          <FileDown size={22} className="mx-auto text-faint" />
          <p className="mt-3 font-semibold text-ink">Nenhuma nota por aqui</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Importe o XML que o fornecedor mandou — pode ser um arquivo só ou o ZIP do mês
            inteiro. O sistema lê fornecedor, itens e valores.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nota</th>
                <th className="px-4 py-3 font-medium">Fornecedor</th>
                <th className="px-4 py-3 font-medium">Emissão</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visiveis.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => setAberta(n)}
                  className="cursor-pointer transition-colors hover:bg-surface-2"
                >
                  <td className="px-4 py-3 font-mono text-xs text-ink-2">
                    {n.numero}/{n.serie}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{n.emitRazaoSocial}</p>
                    <p className="font-mono text-[11px] text-faint">
                      {maskCnpj(n.emitCnpj)}
                      {n.emitUf ? ` · ${n.emitUf}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted">{relDia(n.dataEmissao)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtMoney(n.valorTotal)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_UI[n.status].tone}>{STATUS_UI[n.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aberta && (
        <DetalheNota
          nota={notas.find((n) => n.id === aberta.id) ?? aberta}
          podeImportar={podeImportar}
          onClose={() => setAberta(null)}
        />
      )}
    </>
  );
}

// ── Detalhe / conciliação ───────────────────────────────────

function DetalheNota({
  nota,
  podeImportar,
  onClose,
}: {
  nota: NotaRecebida;
  podeImportar: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [relacionando, setRelacionando] = useState<ItemNota | null>(null);
  const [descartando, setDescartando] = useState(false);
  const [motivoDescarte, setMotivoDescarte] = useState("");
  const [pedidos, setPedidos] = useState<
    { id: string; numero: string; status: string; valorTotal: number }[] | null
  >(null);

  const faltam = nota.itens.filter((i) => !i.productId).length;
  const custoTotal = nota.itens.reduce((s, i) => s + custoItem(i), 0);
  const editavel = nota.status === "PENDENTE" || nota.status === "CONCILIADO";

  async function carregarPedidos() {
    if (pedidos || !nota.supplierId) return;
    try {
      setPedidos(await pedidosDoFornecedorAction(nota.supplierId));
    } catch {
      setPedidos([]);
    }
  }

  function receber() {
    start(async () => {
      try {
        await receberNotaAction(nota.id);
        toast.success("Entrada gerada.", "Estoque e custo médio atualizados.");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao gerar a entrada.");
      }
    });
  }

  function descartar() {
    start(async () => {
      try {
        await descartarNotaAction({ inboundId: nota.id, motivo: motivoDescarte });
        toast.success("Nota descartada.");
        setDescartando(false);
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao descartar.");
      }
    });
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={`Nota ${nota.numero}/${nota.serie}`}
        description={nota.emitRazaoSocial}
        width="xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">
              Custo total da entrada:{" "}
              <span className="font-mono text-ink-2">{fmtMoney(custoTotal)}</span>
            </span>
            <div className="flex items-center gap-2">
              {editavel && podeImportar && (
                <Button variant="ghost" onClick={() => setDescartando(true)} disabled={pending}>
                  <Trash2 size={16} /> Descartar
                </Button>
              )}
              {editavel && podeImportar && (
                <Button onClick={receber} disabled={pending || faltam > 0}>
                  <PackageCheck size={16} />
                  {pending ? "Gerando…" : "Receber mercadoria"}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[var(--radius-md)] border border-line bg-surface-2 p-4 sm:grid-cols-4">
            <Info label="CNPJ" valor={maskCnpj(nota.emitCnpj)} mono />
            <Info label="Emissão" valor={relDia(nota.dataEmissao)} />
            <Info label="Valor da nota" valor={fmtMoney(nota.valorTotal)} mono />
            <Info label="Situação" valor={STATUS_UI[nota.status].label} />
            <div className="col-span-2 sm:col-span-4">
              <p className="text-[11px] uppercase tracking-wider text-faint">Chave de acesso</p>
              <p className="mt-0.5 font-mono text-[11px] break-all text-ink-2">{nota.chave}</p>
            </div>
          </div>

          {nota.status === "DESCARTADO" && nota.observacao && (
            <p className="text-sm text-muted">Motivo do descarte: {nota.observacao}</p>
          )}

          {editavel && nota.supplierId && (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line p-3">
              <Link2 size={16} className="shrink-0 text-muted" />
              <div className="min-w-[14rem] flex-1">
                <Select
                  aria-label="Pedido de compra"
                  value={nota.purchaseOrderId ?? ""}
                  onFocus={carregarPedidos}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    start(async () => {
                      try {
                        await vincularPedidoAction({ inboundId: nota.id, purchaseOrderId: v });
                        router.refresh();
                      } catch {
                        toast.error("Falha ao vincular o pedido.");
                      }
                    });
                  }}
                >
                  <option value="">Sem pedido de compra</option>
                  {nota.purchaseOrderId && !pedidos && (
                    <option value={nota.purchaseOrderId}>
                      {nota.pedidoNumero ?? "Pedido vinculado"}
                    </option>
                  )}
                  {(pedidos ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.numero} — {fmtMoney(p.valorTotal)}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-xs text-muted">
                Vincular ao pedido deixa a entrada rastreável em Compras.
              </p>
            </div>
          )}

          {faltam > 0 && (
            <p className="text-sm text-warn">
              {faltam} item(ns) sem produto. Relacione todos para receber a mercadoria.
            </p>
          )}

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Item do fornecedor</th>
                  <th className="px-3 py-2 font-medium">Produto no catálogo</th>
                  <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                  <th className="px-3 py-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {nota.itens.map((i) => (
                  <tr key={i.id} className={cn(!i.productId && "bg-warn-soft/40")}>
                    <td className="px-3 py-2">
                      <p className="text-ink">{i.descricao}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {i.codigoFornecedor}
                        {i.gtin ? ` · ${i.gtin}` : ""}
                        {i.cfop ? ` · CFOP ${i.cfop}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      {i.productId ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={14} className="shrink-0 text-ok" />
                          <div>
                            <p className="text-ink">{i.productNome}</p>
                            <p className="font-mono text-[11px] text-faint">
                              {i.productSku}
                              {i.fatorConversao !== 1 ? ` · ×${fmtQtd(i.fatorConversao)}` : ""}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-warn">Não relacionado</span>
                      )}
                      {editavel && podeImportar && (
                        <button
                          type="button"
                          onClick={() => setRelacionando(i)}
                          className="mt-1 text-xs font-medium text-brand underline"
                        >
                          {i.productId ? "Trocar" : "Relacionar"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtQtd(i.quantidade)} {i.unidade}
                      {i.fatorConversao !== 1 && (
                        <span className="block text-[11px] text-faint">
                          = {fmtQtd(i.quantidade * i.fatorConversao)} un
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {i.bonificacao ? (
                        <Badge tone="accent">
                          <Gift size={11} /> bonificação
                        </Badge>
                      ) : (
                        fmtMoney(custoItem(i))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Sheet>

      {relacionando && (
        <RelacionarItem
          item={relacionando}
          onClose={() => setRelacionando(null)}
          onSaved={() => {
            setRelacionando(null);
            router.refresh();
          }}
        />
      )}

      <Modal
        open={descartando}
        onClose={() => setDescartando(false)}
        title="Descartar nota"
        description="A nota some da fila de entrada e não movimenta estoque."
        width="md"
      >
        <Field label="Motivo" htmlFor="motivo" hint="Fica registrado na nota.">
          <Input
            id="motivo"
            value={motivoDescarte}
            onChange={(e) => setMotivoDescarte(e.target.value)}
            placeholder="Ex.: já lancei essa nota à mão"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDescartando(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={descartar} disabled={pending}>
            {pending ? "Descartando…" : "Descartar"}
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

// ── De-para item ↔ produto ──────────────────────────────────

type ProdutoOpt = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  packagings: { id: string; nome: string; fatorConversao: number }[];
};

function RelacionarItem({
  item,
  onClose,
  onSaved,
}: {
  item: ItemNota;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [termo, setTermo] = useState(item.descricao.slice(0, 30));
  const [buscando, setBuscando] = useState(false);
  const [opcoes, setOpcoes] = useState<ProdutoOpt[]>([]);
  const [escolhido, setEscolhido] = useState<ProdutoOpt | null>(null);
  const [packagingId, setPackagingId] = useState<string>("");
  const [fator, setFator] = useState(String(item.fatorConversao));

  async function buscar() {
    setBuscando(true);
    try {
      setOpcoes(await buscarProdutosAction(termo));
    } catch {
      toast.error("Falha ao buscar produtos.");
    } finally {
      setBuscando(false);
    }
  }

  function escolher(p: ProdutoOpt) {
    setEscolhido(p);
    setPackagingId("");
    setFator("1");
  }

  function salvar() {
    if (!escolhido) return toast.error("Escolha um produto.");
    start(async () => {
      try {
        await relacionarItemAction({
          itemId: item.id,
          productId: escolhido.id,
          packagingId: packagingId || null,
          fatorConversao: fator,
        });
        toast.success(
          "Item relacionado.",
          "Nas próximas notas deste fornecedor ele entra sozinho.",
        );
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao relacionar.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Relacionar item"
      description={`${item.codigoFornecedor} — ${item.descricao}`}
      width="md"
    >
      <div className="flex flex-col gap-4">
        <Field label="Buscar no catálogo" htmlFor="busca" hint="Nome, SKU ou código de barras.">
          <div className="flex gap-2">
            <Input
              id="busca"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscar())}
              autoFocus
            />
            <Button variant="outline" onClick={buscar} disabled={buscando}>
              <Search size={16} /> {buscando ? "Buscando…" : "Buscar"}
            </Button>
          </div>
        </Field>

        {opcoes.length > 0 && (
          <div className="max-h-56 divide-y divide-line overflow-y-auto rounded-[var(--radius-md)] border border-line">
            {opcoes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => escolher(p)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2",
                  escolhido?.id === p.id && "bg-brand-soft",
                )}
              >
                <span>
                  <span className="block text-sm text-ink">{p.nome}</span>
                  <span className="block font-mono text-[11px] text-faint">
                    {p.sku}
                    {p.ean ? ` · ${p.ean}` : ""}
                  </span>
                </span>
                {escolhido?.id === p.id && <CheckCircle2 size={16} className="text-brand" />}
              </button>
            ))}
          </div>
        )}

        {escolhido && (
          <div className="grid gap-4 sm:grid-cols-2">
            {escolhido.packagings.length > 0 && (
              <Field
                label="Embalagem de compra"
                htmlFor="pk"
                hint="Preenche o fator automaticamente."
              >
                <Select
                  id="pk"
                  value={packagingId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPackagingId(id);
                    const pk = escolhido.packagings.find((x) => x.id === id);
                    setFator(String(pk?.fatorConversao ?? 1));
                  }}
                >
                  <option value="">Unidade avulsa</option>
                  {escolhido.packagings.map((pk) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.nome} (×{fmtQtd(pk.fatorConversao)})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field
              label="Unidades por item da nota"
              htmlFor="fator"
              hint={`A nota traz ${fmtQtd(item.quantidade)} ${item.unidade}.`}
            >
              <Input
                id="fator"
                value={fator}
                onChange={(e) => setFator(e.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
            </Field>
            <p className="text-sm text-muted sm:col-span-2">
              Entra no estoque:{" "}
              <span className="font-mono text-ink-2">
                {fmtQtd(item.quantidade * (Number(fator.replace(",", ".")) || 0))} un
              </span>
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending || !escolhido}>
            {pending ? "Salvando…" : "Relacionar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
