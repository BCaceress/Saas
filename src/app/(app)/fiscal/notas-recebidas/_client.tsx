"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileDown, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/sheet";
import { Badge, Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj } from "@/lib/masks";
import { cn } from "@/lib/utils";
import { CardSincronizacao } from "@/components/fornecedor/sincronizacao";
import type { ResumoSincronizacao } from "@/lib/fornecedores/sincronizacao-xml";
import { fmtMoney, relDia } from "../../cotacoes/_ui";
import {
  importarXmlAction,
  manifestarNotaAction,
  notasAguardandoManifestacaoAction,
  sincronizarSefazAction,
} from "./actions";

type Status = "PENDENTE" | "CONCILIADO" | "RECEBIDO" | "DESCARTADO" | "SEM_ESTOQUE" | "VINCULADO";

/**
 * Uma linha da FILA. Só o que a lista mostra — trabalhar a nota é em
 * `/recebimento/[id]`, e carregar os itens de 200 notas para uma tabela que
 * mostra cinco colunas era pagar a leitura inteira do mês para nada.
 */
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
                // A fila é fila: clicar numa nota LEVA ao trilho de
                // recebimento, não abre um segundo lugar para trabalhar a
                // mesma nota. Era esse painel paralelo que fazia o de-para
                // existir em duas telas com regras diferentes.
                <tr
                  key={n.id}
                  onClick={() => router.push(`/recebimento/${n.id}`)}
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
