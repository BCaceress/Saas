"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock3,
  PencilLine,
  Trash2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Field } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn, maskMoney, parseMoney } from "@/lib/utils";
import type { SupplierImportStatus } from "@/generated/prisma";
import type { ImportacaoRow } from "../_catalogo/types";
import { EstadoVazio, KIND_LABEL, fmtQuando } from "../_catalogo/ui";
import { importarManualAction } from "../_catalogo/actions";

type FornecedorOpcao = {
  id: string;
  nome: string;
  aceitaImportacaoManual: boolean;
};

const ACEITOS = ".xlsx,.xlsm,.csv,.txt,.pdf,.xml,.json,.jpg,.jpeg,.png,.webp";

const STATUS_META: Record<
  SupplierImportStatus,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral"; icon: React.ElementType }
> = {
  CONCLUIDA: { label: "Concluída", tone: "ok", icon: CheckCircle2 },
  CONCLUIDA_COM_ERROS: { label: "Concluída com avisos", tone: "warn", icon: AlertCircle },
  FALHOU: { label: "Falhou", tone: "danger", icon: AlertCircle },
  PROCESSANDO: { label: "Processando", tone: "neutral", icon: Clock3 },
  PENDENTE: { label: "Na fila", tone: "neutral", icon: Clock3 },
};

/**
 * Importações — a porta de entrada de tudo que não vem por API. O leitor certo
 * é escolhido pelo formato do arquivo; quem sobe a tabela não precisa saber
 * qual conector roda por baixo.
 */
export function Importacoes({
  importacoes,
  fornecedores,
  fornecedorInicial,
  podeImportar,
}: {
  importacoes: ImportacaoRow[];
  fornecedores: FornecedorOpcao[];
  fornecedorInicial: string;
  podeImportar: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(fornecedorInicial || fornecedores[0]?.id || "");
  const [substituir, setSubstituir] = useState(true);
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [digitar, setDigitar] = useState(false);

  async function enviar(arquivo: File) {
    if (!supplierId) {
      toast.error("Escolha o fornecedor", "A tabela precisa saber de quem ela é.");
      return;
    }
    setEnviando(true);
    try {
      const form = new FormData();
      form.set("arquivo", arquivo);
      form.set("supplierId", supplierId);
      form.set("substituir", substituir ? "1" : "0");

      const resposta = await fetch("/api/compras/importar", {
        method: "POST",
        body: form,
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error("Importação falhou", dados?.erro ?? "Tente outro formato de arquivo.");
      } else {
        toast.success(
          "Tabela importada",
          `${dados.itensLidos} itens lidos · ${dados.itensNovos} novos · ${dados.itensSemVinculo} sem vínculo.`,
        );
        router.refresh();
      }
    } catch {
      toast.error("Importação falhou", "Não consegui enviar o arquivo. Verifique a conexão.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {podeImportar && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Fornecedor" className="min-w-52 flex-1 sm:max-w-72">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Escolha o fornecedor</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id} disabled={!f.aceitaImportacaoManual}>
                    {f.nome}
                    {f.aceitaImportacaoManual ? "" : " (importação manual desligada)"}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex h-10 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={substituir}
                onChange={(e) => setSubstituir(e.target.checked)}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              Substituir a tabela anterior
            </label>

            <Button variant="ghost" size="sm" onClick={() => setDigitar(true)}>
              <PencilLine size={14} />
              Digitar ofertas
            </Button>
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastando(false);
              const arquivo = e.dataTransfer.files?.[0];
              if (arquivo) void enviar(arquivo);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed px-6 py-10 text-center transition-colors",
              arrastando ? "border-brand bg-brand-soft/40" : "border-line hover:border-brand/60",
              enviando && "pointer-events-none opacity-60",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACEITOS}
              className="sr-only"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                if (arquivo) void enviar(arquivo);
              }}
            />
            {enviando ? (
              <>
                <Loader2 size={22} className="animate-spin text-brand" />
                <p className="text-[13px] font-medium text-ink">Lendo a tabela…</p>
                <p className="text-[12px] text-muted">
                  PDF e imagem levam alguns segundos — a leitura é feita item a item.
                </p>
              </>
            ) : (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-brand-soft text-brand">
                  <FileUp size={20} />
                </div>
                <p className="text-[13px] font-medium text-ink">
                  Arraste a tabela aqui ou clique para escolher
                </p>
                <p className="text-[12px] text-muted">
                  Planilha, CSV, PDF, XML, JSON ou foto do encarte — até 25 MB.
                </p>
              </>
            )}
          </label>
        </div>
      )}

      {importacoes.length === 0 ? (
        <EstadoVazio
          icon={<Upload size={20} />}
          titulo="Nenhuma importação ainda"
          descricao="Suba a primeira tabela de preços. Cada importação fica registrada com o que foi lido e o que ficou sem vínculo."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Fornecedor</th>
                <th className="px-3 py-2.5 font-medium">Arquivo</th>
                <th className="px-3 py-2.5 font-medium">Origem</th>
                <th className="px-3 py-2.5 text-right font-medium">Itens</th>
                <th className="px-3 py-2.5 text-right font-medium">Sem vínculo</th>
                <th className="px-3 py-2.5 font-medium">Quem</th>
                <th className="px-3 py-2.5 font-medium">Quando</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {importacoes.map((imp) => {
                const meta = STATUS_META[imp.status];
                const Icone = meta.icon;
                return (
                  <tr key={imp.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-2.5 font-medium text-ink">{imp.supplierNome}</td>
                    <td className="max-w-56 px-3 py-2.5">
                      <p className="truncate text-[13px] text-ink-2">{imp.arquivoNome ?? "—"}</p>
                      {imp.mensagem && (
                        <p className="truncate text-[11px] text-muted" title={imp.mensagem}>
                          {imp.mensagem}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">
                      {KIND_LABEL[imp.tipo]}
                      <span className="text-faint"> · {imp.origem}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-ink">
                      {imp.itensLidos.toLocaleString("pt-BR")}
                      <span className="text-faint"> / {imp.totalLinhas.toLocaleString("pt-BR")}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px]">
                      {imp.itensSemVinculo > 0 ? (
                        <span className="text-warn">{imp.itensSemVinculo}</span>
                      ) : (
                        <span className="text-faint">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{imp.usuario ?? "Sistema"}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{fmtQuando(imp.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={meta.tone}>
                        <Icone size={11} />
                        {meta.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {digitar && (
        <SheetDigitar
          fornecedores={fornecedores}
          supplierIdInicial={supplierId}
          onClose={() => setDigitar(false)}
        />
      )}
    </div>
  );
}

// ── Digitação manual ────────────────────────────────────────

type LinhaManual = {
  descricao: string;
  codigoFornecedor: string;
  ean: string;
  preco: string;
  precoPromocional: string;
};

const LINHA_VAZIA: LinhaManual = {
  descricao: "",
  codigoFornecedor: "",
  ean: "",
  preco: "",
  precoPromocional: "",
};

function SheetDigitar({
  fornecedores,
  supplierIdInicial,
  onClose,
}: {
  fornecedores: FornecedorOpcao[];
  supplierIdInicial: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(supplierIdInicial);
  const [linhas, setLinhas] = useState<LinhaManual[]>([{ ...LINHA_VAZIA }]);
  const [pending, startTransition] = useTransition();

  function mudar(indice: number, campo: keyof LinhaManual, valor: string) {
    setLinhas((atual) => atual.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l)));
  }

  function salvar() {
    const itens = linhas
      .filter((l) => l.descricao.trim() && parseMoney(l.preco))
      .map((l) => ({
        descricao: l.descricao.trim(),
        codigoFornecedor: l.codigoFornecedor.trim() || null,
        ean: l.ean.replace(/\D/g, "") || null,
        preco: parseMoney(l.preco) as number,
        precoPromocional: parseMoney(l.precoPromocional),
      }));

    if (itens.length === 0) {
      toast.error("Nada para salvar", "Preencha ao menos a descrição e o preço de um item.");
      return;
    }

    startTransition(async () => {
      try {
        const r = await importarManualAction({ supplierId, itens });
        toast.success(
          "Ofertas registradas",
          `${r.itensNovos} novas · ${r.itensAtualizados} atualizadas.`,
        );
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Não deu para salvar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Digitar ofertas"
      description="Para o preço que chegou por telefone ou no balcão — sem arquivo nenhum."
      width="2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending || !supplierId}>
            {pending && <Loader2 size={15} className="animate-spin" />}
            Salvar ofertas
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <Field label="Fornecedor" required>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Escolha o fornecedor</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          {linhas.map((linha, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-12 sm:col-span-3">
                <Input
                  value={linha.descricao}
                  onChange={(e) => mudar(i, "descricao", e.target.value)}
                  placeholder="Produto"
                  aria-label={`Produto da linha ${i + 1}`}
                />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <Input
                  value={linha.codigoFornecedor}
                  onChange={(e) => mudar(i, "codigoFornecedor", e.target.value)}
                  placeholder="Código"
                  aria-label={`Código da linha ${i + 1}`}
                />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <Input
                  value={linha.ean}
                  onChange={(e) => mudar(i, "ean", e.target.value)}
                  placeholder="EAN"
                  inputMode="numeric"
                  aria-label={`EAN da linha ${i + 1}`}
                />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <Input
                  value={linha.preco}
                  onChange={(e) => mudar(i, "preco", maskMoney(e.target.value))}
                  placeholder="Preço"
                  inputMode="decimal"
                  aria-label={`Preço da linha ${i + 1}`}
                />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <Input
                  value={linha.precoPromocional}
                  onChange={(e) => mudar(i, "precoPromocional", maskMoney(e.target.value))}
                  placeholder="Promo"
                  inputMode="decimal"
                  aria-label={`Preço promocional da linha ${i + 1}`}
                />
              </div>
              <div className="col-span-2 flex justify-end sm:col-span-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setLinhas((atual) => atual.filter((_, j) => j !== i))}
                  disabled={linhas.length === 1}
                  title="Remover linha"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setLinhas((atual) => [...atual, { ...LINHA_VAZIA }])}
        >
          <Plus size={14} />
          Mais uma linha
        </Button>

        <p className="text-[12px] text-muted">
          O que for digitado aqui soma ao catálogo do fornecedor: nada do que já existe é apagado.
        </p>
      </div>
    </Sheet>
  );
}
