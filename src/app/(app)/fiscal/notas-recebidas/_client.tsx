"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  Gift,
  Link2,
  PackageCheck,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Copy,
  Receipt,
  Undo2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Badge, Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj } from "@/lib/masks";
import { fatorDaNota } from "@/lib/fiscal/fator";
import { termoDeBuscaDoItem } from "@/lib/compras/conciliacao-regras";
import { cn } from "@/lib/utils";
import { CardSincronizacao } from "@/components/fornecedor/sincronizacao";
import type { ResumoSincronizacao } from "@/lib/fornecedores/sincronizacao-xml";
import { fmtMoney, fmtQtd, relDia } from "../../cotacoes/_ui";
import {
  estornarEntradaAction,
  desvincularNotaAction,
  entradaDaNotaAction,
} from "../../estoque/estorno-actions";
import {
  buscarProdutosAction,
  descartarNotaAction,
  importarXmlAction,
  manifestarNotaAction,
  notasAguardandoManifestacaoAction,
  pedidosDoFornecedorAction,
  receberNotaAction,
  candidatasEntradaManualAction,
  vincularEntradaManualAction,
  relacionarItemAction,
  sincronizarSefazAction,
  vincularPedidoAction,
} from "./actions";

type Status = "PENDENTE" | "CONCILIADO" | "RECEBIDO" | "DESCARTADO" | "SEM_ESTOQUE" | "VINCULADO";

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
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
  valorUnitario: number;
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorFcpSt: number;
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
  /** Por que este documento não virou estoque — serviço, frete ou já lançado. */
  semEstoqueMotivo: string | null;
  itens: ItemNota[];
};

const STATUS_UI: Record<Status, { label: string; tone: "warn" | "brand" | "ok" | "neutral" }> = {
  PENDENTE: { label: "Falta relacionar", tone: "warn" },
  CONCILIADO: { label: "Pronta para receber", tone: "brand" },
  RECEBIDO: { label: "Recebida", tone: "ok" },
  DESCARTADO: { label: "Descartada", tone: "neutral" },
  // Documento guardado que não movimenta saldo: CT-e, nota de serviço, ou nota
  // que apenas documentou uma entrada já lançada à mão.
  SEM_ESTOQUE: { label: "Despesa (sem estoque)", tone: "neutral" },
  VINCULADO: { label: "Documenta entrada manual", tone: "ok" },
};

/** Custo real do item: mercadoria + ST + IPI + frete − desconto. */
/**
 * Fator salvo × fator que a nota declara. Divergência é erro de estoque
 * esperando acontecer: ou o fornecedor mudou o fardo, ou o de-para nasceu
 * errado. Quem decide é o operador — a tela só não deixa passar calado.
 */
function fatorDivergente(i: ItemNota): number | null {
  const daNota = fatorDaNota(i);
  return daNota != null && daNota !== i.fatorConversao ? daNota : null;
}

function custoItem(i: ItemNota): number {
  if (i.bonificacao) return 0;
  return Math.max(
    0,
    i.valorTotal - i.valorDesconto + i.valorIcmsSt + i.valorFcpSt + i.valorIpi + i.valorFrete,
  );
}

export function NotasRecebidasClient({
  notas,
  podeImportar,
  podeEditarFornecedor,
  distribuicaoAtiva,
}: {
  notas: NotaRecebida[];
  podeImportar: boolean;
  /** Pode decidir as sugestões que o XML fez ao cadastro do fornecedor. */
  podeEditarFornecedor: boolean;
  /** Provedor com distribuição DF-e configurado nesta loja. */
  distribuicaoAtiva: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [aberta, setAberta] = useState<NotaRecebida | null>(null);
  const [filtro, setFiltro] = useState<"TODAS" | Status>("TODAS");
  // O que o XML fez pelo cadastro dos fornecedores desta leva de arquivos.
  const [sincronizacoes, setSincronizacoes] = useState<ResumoSincronizacao[] | null>(null);
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

      // Painel de sincronização: só abre quando há o que mostrar. Nota de
      // fornecedor conhecido que não mudou nada no cadastro não merece um
      // modal — o toast da importação já disse tudo.
      const sync = r
        .map((x) => x.sincronizacao)
        .filter((s): s is ResumoSincronizacao => !!s)
        .filter((s) => s.criado || s.automaticas.length > 0 || s.sugestoes.length > 0);
      if (sync.length > 0) setSincronizacoes(sync);

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

      {distribuicaoAtiva && <PainelSefaz podeImportar={podeImportar} />}

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
        {(["TODAS", "PENDENTE", "CONCILIADO", "RECEBIDO", "SEM_ESTOQUE", "VINCULADO", "DESCARTADO"] as const).map((f) => (
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

      {sincronizacoes && (
        <PainelSincronizacao
          resumos={sincronizacoes}
          podeDecidir={podeEditarFornecedor}
          onClose={() => {
            setSincronizacoes(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * O que a importação fez pelo cadastro dos fornecedores. Aparece uma vez, logo
 * depois do upload, porque é o único momento em que o operador tem o contexto
 * na cabeça ("acabei de subir a nota da AMBEV"). Quem fechar sem decidir não
 * perde nada: a sugestão continua na ficha do fornecedor.
 */
function PainelSincronizacao({
  resumos,
  podeDecidir,
  onClose,
}: {
  resumos: ResumoSincronizacao[];
  podeDecidir: boolean;
  onClose: () => void;
}) {
  const pendentes = podeDecidir ? resumos.reduce((s, r) => s + r.sugestoes.length, 0) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Fornecedores sincronizados"
      description={
        pendentes > 0
          ? "O que o XML atualizou sozinho e o que precisa da sua decisão."
          : "O que o XML atualizou no cadastro destes fornecedores."
      }
      width="lg"
      footer={
        <div className="flex justify-end">
          <Button variant={pendentes > 0 ? "secondary" : "primary"} onClick={onClose}>
            {pendentes > 0 ? "Decidir depois" : "Concluir"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {resumos.map((r) => (
          <CardSincronizacao
            key={r.supplierId + r.historico.notaNumero}
            resumo={podeDecidir ? r : { ...r, sugestoes: [] }}
          />
        ))}
        {pendentes > 0 && (
          <p className="text-[12px] text-muted">
            O que ficar sem decisão continua esperando na ficha do fornecedor, em Histórico.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ── Distribuição DF-e (notas direto da SEFAZ) ───────────────

type NotaSefaz = Awaited<ReturnType<typeof notasAguardandoManifestacaoAction>>[number];

const MANIFESTACOES = [
  {
    tipo: "CIENCIA",
    label: "Dar ciência",
    ajuda: "Só avisa a SEFAZ que você viu a nota. Libera o XML completo e não assume nada.",
  },
  {
    tipo: "CONFIRMACAO",
    label: "Confirmar operação",
    ajuda: "A mercadoria chegou e a nota está correta. É definitivo.",
  },
  {
    tipo: "DESCONHECIMENTO",
    label: "Desconhecer",
    ajuda: "Você não reconhece essa compra. Exige justificativa.",
  },
  {
    tipo: "NAO_REALIZADA",
    label: "Operação não realizada",
    ajuda: "A nota existe mas a entrega não aconteceu (recusa, devolução). Exige justificativa.",
  },
] as const;

type TipoManifestacao = (typeof MANIFESTACOES)[number]["tipo"];

/**
 * A SEFAZ entrega primeiro só um resumo da nota do fornecedor; o XML com itens
 * depende de manifestação. Por isso este painel é separado da lista: são notas
 * que ainda não existem como entrada, só como aviso.
 */
function PainelSefaz({ podeImportar }: { podeImportar: boolean }) {
  const router = useRouter();
  const [buscando, setBuscando] = useState(false);
  const [notas, setNotas] = useState<NotaSefaz[] | null>(null);
  const [alvo, setAlvo] = useState<NotaSefaz | null>(null);

  async function sincronizar() {
    setBuscando(true);
    try {
      const r = await sincronizarSefazAction();
      const pendentes = await notasAguardandoManifestacaoAction();
      setNotas(pendentes);

      if (r.importadas > 0) {
        toast.success(
          `${r.importadas} nota(s) baixada(s) da SEFAZ.`,
          "Já entraram na fila de conciliação.",
        );
      } else if (pendentes.length > 0) {
        toast.info(
          `${pendentes.length} nota(s) esperando manifestação.`,
          "Dê ciência para liberar o XML completo.",
        );
      } else {
        toast.info("Nada novo na SEFAZ.", `${r.consultadas} documento(s) já conhecidos.`);
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar a SEFAZ.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">Notas direto da SEFAZ</p>
          <p className="text-xs text-muted">
            O que os fornecedores emitiram contra o seu CNPJ — sem depender de o fornecedor
            mandar o arquivo.
          </p>
        </div>
        {podeImportar && (
          <Button variant="outline" onClick={sincronizar} disabled={buscando}>
            <RefreshCw size={16} className={buscando ? "animate-spin" : undefined} />
            {buscando ? "Consultando…" : "Buscar na SEFAZ"}
          </Button>
        )}
      </div>

      {notas && notas.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {notas.map((n) => (
            <li key={n.chave} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{n.emitRazaoSocial}</p>
                <p className="font-mono text-[11px] text-faint">
                  {maskCnpj(n.emitCnpj)} · NF-e {n.numero}/{n.serie}
                  {n.dataEmissao ? ` · ${relDia(n.dataEmissao)}` : ""}
                </p>
              </div>
              <span className="font-mono text-sm text-ink-2">
                {n.valorTotal == null ? "—" : fmtMoney(n.valorTotal)}
              </span>
              {podeImportar && (
                <Button variant="outline" onClick={() => setAlvo(n)}>
                  Manifestar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {notas && notas.length === 0 && (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">
          Nenhuma nota esperando manifestação.
        </p>
      )}

      {alvo && (
        <ModalManifestacao
          nota={alvo}
          onClose={() => setAlvo(null)}
          onFeito={() => {
            setNotas((atual) => atual?.filter((n) => n.chave !== alvo.chave) ?? null);
            setAlvo(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ModalManifestacao({
  nota,
  onClose,
  onFeito,
}: {
  nota: NotaSefaz;
  onClose: () => void;
  onFeito: () => void;
}) {
  const [tipo, setTipo] = useState<TipoManifestacao>("CIENCIA");
  const [justificativa, setJustificativa] = useState("");
  const [pending, start] = useTransition();

  const escolha = MANIFESTACOES.find((m) => m.tipo === tipo)!;
  const precisaJustificativa = tipo === "DESCONHECIMENTO" || tipo === "NAO_REALIZADA";

  function confirmar() {
    start(async () => {
      try {
        const r = await manifestarNotaAction({
          chave: nota.chave,
          tipo,
          justificativa: precisaJustificativa ? justificativa : undefined,
        });
        if (r.ok) toast.success(r.mensagem);
        else toast.error(r.mensagem);
        onFeito();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao manifestar.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Manifestar nota"
      description={`${nota.emitRazaoSocial} — NF-e ${nota.numero}/${nota.serie}`}
      width="md"
    >
      <div className="flex flex-col gap-4">
        <Field label="O que você quer registrar" htmlFor="tipo" hint={escolha.ajuda}>
          <Select
            id="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoManifestacao)}
          >
            {MANIFESTACOES.map((m) => (
              <option key={m.tipo} value={m.tipo}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        {precisaJustificativa && (
          <Field
            label="Justificativa"
            htmlFor="justificativa"
            hint="Mínimo de 15 caracteres — a SEFAZ recusa textos curtos."
          >
            <Input
              id="justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: mercadoria recusada na portaria por avaria"
            />
          </Field>
        )}

        <p className="text-xs text-muted">
          Manifestação não tem desfazer na SEFAZ. A chave fica registrada no histórico fiscal.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={confirmar} disabled={pending}>
          {pending ? "Enviando…" : escolha.label}
        </Button>
      </div>
    </Modal>
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
  // Entradas lançadas à mão que esta nota pode estar documentando. Sem esta
  // pergunta, receber a nota somaria a mesma mercadoria pela segunda vez.
  type Candidata = Awaited<ReturnType<typeof candidatasEntradaManualAction>>[number];
  const [candidatas, setCandidatas] = useState<Candidata[] | null>(null);

  useEffect(() => {
    if (nota.status !== "PENDENTE" && nota.status !== "CONCILIADO") return;
    if (!nota.supplierId) return;
    let vivo = true;
    candidatasEntradaManualAction(nota.id)
      .then((r) => vivo && setCandidatas(r))
      .catch(() => vivo && setCandidatas([]));
    return () => {
      vivo = false;
    };
  }, [nota.id, nota.status, nota.supplierId]);

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
        // O operador viu a lista de candidatas nesta tela; se mandou receber
        // mesmo assim, a decisão é dele e o servidor não barra de novo.
        await receberNotaAction(nota.id, (candidatas?.length ?? 0) > 0);
        toast.success("Entrada gerada.", "Estoque e custo médio atualizados.");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao gerar a entrada.");
      }
    });
  }

  function estornar() {
    const motivo = window.prompt(
      "Por que esta entrada está sendo estornada? O saldo volta e os títulos em aberto são cancelados.",
    );
    if (!motivo?.trim()) return;
    start(async () => {
      try {
        const entrada = await entradaDaNotaAction(nota.id);
        if (!entrada) {
          toast.error("Não foi possível localizar a entrada desta nota.");
          return;
        }
        const r = await estornarEntradaAction({ purchaseId: entrada.id, motivo });
        toast.success(
          "Entrada estornada.",
          r.titulosCancelados > 0
            ? `${r.itens} item(ns) saíram do estoque e ${r.titulosCancelados} título(s) foram cancelados.`
            : `${r.itens} item(ns) saíram do estoque.`,
        );
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao estornar.");
      }
    });
  }

  function desvincular() {
    const motivo = window.prompt("Por que este vínculo está errado?");
    if (!motivo?.trim()) return;
    start(async () => {
      try {
        await desvincularNotaAction({ inboundId: nota.id, motivo });
        toast.success("Vínculo desfeito.", "A entrada voltou a aguardar documento.");
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao desfazer o vínculo.");
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
        // A nota é uma tabela larga (item do fornecedor, produto do catálogo,
        // quantidade, fator, custo). Em 672px ela rolava na horizontal e o
        // de-para — a coluna que o operador precisa ler — ficava fora da tela.
        width="5xl"
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
              {/* Desfazer é operação de verdade, não “registre um ajuste”:
                  volta o saldo, cancela os títulos e libera a nota. */}
              {nota.status === "RECEBIDO" && podeImportar && (
                <Button variant="ghost" onClick={estornar} disabled={pending}>
                  <Undo2 size={16} /> Estornar entrada
                </Button>
              )}
              {nota.status === "VINCULADO" && podeImportar && (
                <Button variant="ghost" onClick={desvincular} disabled={pending}>
                  <Unlink size={16} /> Desfazer vínculo
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

          {nota.semEstoqueMotivo && (
            <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-line bg-surface-2 px-3.5 py-3 text-sm text-muted">
              <Receipt size={15} className="mt-0.5 shrink-0 text-faint" />
              <span>
                {nota.semEstoqueMotivo}
                {nota.status === "SEM_ESTOQUE" &&
                  " O valor entrou em Contas a pagar — nada foi somado ao saldo."}
              </span>
            </p>
          )}

          {editavel && candidatas && candidatas.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-accent/40 bg-accent-soft p-3.5">
              <p className="flex items-start gap-2 text-sm font-medium text-accent">
                <Copy size={15} className="mt-0.5 shrink-0" />
                Esta mercadoria já pode ter entrado à mão
              </p>
              <p className="text-xs text-accent/90">
                Se uma destas entradas é esta mesma nota, vincule as duas: o documento fica
                registrado e o estoque não sobe de novo. Se são compras diferentes, é só receber
                normalmente.
              </p>
              <ul className="flex flex-col gap-1.5">
                {candidatas.map((c) => (
                  <li
                    key={c.purchaseId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        Entrada de {new Date(c.data).toLocaleDateString("pt-BR")} ·{" "}
                        <span className="font-mono">{fmtMoney(c.valorTotal)}</span>
                        <span className="ml-2 text-[11px] text-muted">
                          {c.itens} {c.itens === 1 ? "item" : "itens"}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted">{c.motivos.join(" · ")}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          try {
                            await vincularEntradaManualAction({
                              inboundId: nota.id,
                              purchaseId: c.purchaseId,
                            });
                            toast.success(
                              "Nota vinculada à entrada.",
                              "O estoque não foi movimentado de novo.",
                            );
                            onClose();
                            router.refresh();
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : "Falha ao vincular.",
                            );
                          }
                        })
                      }
                    >
                      É esta entrada
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
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

          {editavel && nota.purchaseOrderId && (
            // Com pedido vinculado, o caminho bom não é esta tabela: é a
            // conferência que compara pedido × nota × mercadoria e cuida do
            // recebido de cada item do pedido.
            <Link
              href={`/pedidos/recebimento/${nota.id}`}
              className="flex items-center gap-2 rounded-[var(--radius-md)] border border-brand/30 bg-brand-soft px-3 py-2.5 text-[13px] font-medium text-brand-strong hover:bg-brand-softer"
            >
              <ClipboardCheck size={16} className="shrink-0" />
              Conferir no recebimento inteligente — pedido {nota.pedidoNumero ?? "vinculado"}
            </Link>
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
                      {fatorDivergente(i) && (
                        <span className="block text-[11px] text-warn">
                          nota: {fmtQtd(i.quantidadeTributavel ?? 0)} {i.unidadeTributavel}
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
  imagemUrl: string | null;
  custoMedio: number;
  packagings: { id: string; nome: string; ean: string | null; fatorConversao: number }[];
};

/** "a, b e c" — lista curta em português, sem vírgula antes do "e". */
const listarEmPortugues = (itens: string[]) =>
  itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;

/** O GTIN da nota bate com algum código deste produto (unidade ou embalagem)? */
function casaPorCodigo(p: ProdutoOpt, gtin: string | null): boolean {
  if (!gtin) return false;
  return p.ean === gtin || p.packagings.some((pk) => pk.ean === gtin);
}


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
  const [termo, setTermo] = useState(termoDeBuscaDoItem(item.descricao));
  const [buscando, setBuscando] = useState(false);
  const [opcoes, setOpcoes] = useState<ProdutoOpt[]>([]);
  const [escolhido, setEscolhido] = useState<ProdutoOpt | null>(null);
  const [packagingId, setPackagingId] = useState<string>("");
  const [fator, setFator] = useState(String(item.fatorConversao));

  // Busca enquanto digita: apertar um botão para ver resultado é um clique a
  // mais em cima do trabalho que esta tela existe para eliminar.
  useEffect(() => {
    const alvo = termo.trim();
    let vivo = true;
    // Tudo dentro do timeout, inclusive limpar a lista: mexer no estado no
    // corpo do efeito dispara render em cascata a cada tecla.
    const t = setTimeout(async () => {
      if (alvo.length < 2) {
        setOpcoes([]);
        return;
      }
      setBuscando(true);
      try {
        // A ordem vem pronta do servidor: relevância ao que foi digitado, com
        // o código de barras do item como desempate. Reordenar aqui só
        // brigaria com ela.
        const r = await buscarProdutosAction(alvo, item.gtin);
        if (!vivo) return;
        setOpcoes(r);
      } catch {
        if (vivo) toast.error("Falha ao buscar produtos.");
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [termo, item.gtin]);

  /** O que a nota declara em qTrib/qCom — usado como padrão e como aviso. */
  const sugerido = fatorDaNota(item);

  function escolher(p: ProdutoOpt) {
    setEscolhido(p);
    // Embalagem cujo código de barras é o da nota: o fornecedor bipou o fardo,
    // então o fator do fardo é o certo — melhor palpite que existe.
    const pelaEmbalagem = item.gtin ? p.packagings.find((pk) => pk.ean === item.gtin) : null;
    setPackagingId(pelaEmbalagem?.id ?? "");
    // Voltar para 1 aqui era o que fazia a caixa de long neck entrar como 5
    // garrafas: o operador escolhia o produto e perdia o fator da nota.
    setFator(String(pelaEmbalagem?.fatorConversao ?? sugerido ?? 1));
  }

  function salvar() {
    if (!escolhido) return toast.error("Escolha um produto.");
    start(async () => {
      try {
        const r = await relacionarItemAction({
          itemId: item.id,
          productId: escolhido.id,
          packagingId: packagingId || null,
          fatorConversao: fator,
        });
        toast.success(
          "Item relacionado.",
          // O XML completa o cadastro (embalagem de compra, código de barras,
          // custo, fornecedor) — dizer o que entrou evita o operador refazer.
          r?.preenchidos.length
            ? `Do XML veio ${listarEmPortugues(r.preenchidos)}. Nas próximas notas deste fornecedor ele entra sozinho.`
            : "Nas próximas notas deste fornecedor ele entra sozinho.",
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
      width="2xl"
    >
      <div className="flex flex-col gap-4">
        {/* O que a nota diz sobre este item fica visível o tempo todo: é a
            referência que o operador usa para escolher o produto certo. */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-line bg-surface-2 px-4 py-3 text-[13px]">
          <span className="text-muted">
            Na nota:{" "}
            <span className="text-ink-2">
              {fmtQtd(item.quantidade)} {item.unidade}
            </span>
          </span>
          {item.gtin && (
            <span className="text-muted">
              Código de barras: <span className="font-mono text-ink-2">{item.gtin}</span>
            </span>
          )}
          <span className="text-muted">
            Custo do item: <span className="font-mono text-ink-2">{fmtMoney(custoItem(item))}</span>
          </span>
        </div>

        <Field
          label="Buscar no catálogo"
          htmlFor="busca"
          hint="Nome, SKU ou código de barras — a lista responde enquanto você digita."
        >
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <Input
              id="busca"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
        </Field>

        {opcoes.length > 0 && (
          <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-[var(--radius-md)] border border-line">
            {opcoes.map((p) => {
              const casa = casaPorCodigo(p, item.gtin);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => escolher(p)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2",
                    escolhido?.id === p.id && "bg-brand-soft",
                  )}
                >
                  {p.imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imagemUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-line bg-surface object-contain"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
                      <PackageCheck size={15} />
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink">{p.nome}</span>
                      {casa && (
                        <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-medium text-ok">
                          mesmo código
                        </span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-faint">
                      {p.sku}
                      {p.ean ? ` · ${p.ean}` : ""}
                      {p.packagings.length > 0 &&
                        ` · ${p.packagings.map((pk) => `${pk.nome} ×${fmtQtd(pk.fatorConversao)}`).join(", ")}`}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[11px] text-muted">
                      {p.custoMedio > 0 ? fmtMoney(p.custoMedio) : "sem custo"}
                    </span>
                    <span className="block text-[10px] text-faint">custo médio</span>
                  </span>

                  {escolhido?.id === p.id && (
                    <CheckCircle2 size={16} className="shrink-0 text-brand" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!buscando && termo.trim().length >= 2 && opcoes.length === 0 && (
          <p className="rounded-[var(--radius-md)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
            Nenhum produto com “{termo.trim()}”. Tente outro termo — ou cadastre o produto e
            volte aqui, a nota continua esperando.
          </p>
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
              hint={
                sugerido
                  ? `A nota traz ${fmtQtd(item.quantidade)} ${item.unidade} e tributa ${fmtQtd(
                      item.quantidadeTributavel ?? 0,
                    )} ${item.unidadeTributavel} — ${fmtQtd(sugerido)} por ${item.unidade}.`
                  : `A nota traz ${fmtQtd(item.quantidade)} ${item.unidade}.`
              }
            >
              <Input
                id="fator"
                value={fator}
                onChange={(e) => setFator(e.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
              {sugerido != null && (Number(fator.replace(",", ".")) || 0) !== sugerido && (
                <button
                  type="button"
                  onClick={() => setFator(String(sugerido))}
                  className="mt-1 text-xs font-medium text-brand underline"
                >
                  Usar {fmtQtd(sugerido)}, como o fornecedor declarou
                </button>
              )}
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
