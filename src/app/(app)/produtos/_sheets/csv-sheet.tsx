"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Upload, Download, CheckCircle2, AlertTriangle, Info, ChevronRight } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import {
  GRUPOS,
  autoMapear,
  camposVisiveis,
  templateCsv,
  type CampoCsv,
  type CsvRow,
} from "./csv-campos";
import { commitImport, type ImportResult } from "../csv-actions";

/** Grupos que já vêm abertos: o resto da planilha raramente traz. */
const ABERTOS = new Set(["identificacao", "preco", "estoque"]);

function baixar(conteudo: string, nome: string) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvSheet({
  open,
  onClose,
  policy = POLICY_PADRAO,
}: {
  open: boolean;
  onClose: () => void;
  policy?: EstoquePolicy;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [criarFaltantes, setCriarFaltantes] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // No mapeamento aparecem todos os campos que a empresa usa — se a planilha
  // trouxe a coluna, ela tem onde encaixar.
  const campos = useMemo(() => camposVisiveis(policy, { completo: true }), [policy]);
  const basicos = useMemo(() => camposVisiveis(policy), [policy]);

  function onFile(file: File) {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const cols = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(cols);
        setRaw(res.data);
        setMapping(autoMapear(cols, campos));
      },
    });
  }

  const mapped: CsvRow[] = useMemo(
    () =>
      raw.map((r) => {
        const row: CsvRow = {};
        for (const c of campos) {
          const h = mapping[c.key];
          if (h) row[c.key] = r[h];
        }
        return row;
      }),
    [raw, campos, mapping],
  );

  const mapeados = campos.filter((c) => mapping[c.key]);
  const validas = mapped.filter((r) => r.nome?.trim() && r.subcategoria?.trim()).length;
  const semSub = mapped.filter((r) => r.nome?.trim() && !r.subcategoria?.trim()).length;

  function importar() {
    start(async () => {
      const r = await commitImport(mapped, { criarFaltantes });
      setResult(r);
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Importar produtos (CSV)"
      description="Mapeie as colunas, confira a prévia e confirme."
      width="xl"
      footer={
        raw.length > 0 && !result ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {validas} de {raw.length} linhas prontas · {mapeados.length} campos mapeados
            </span>
            <Button onClick={importar} disabled={pending || validas === 0}>
              {pending ? "Importando…" : `Importar ${validas} produtos`}
            </Button>
          </div>
        ) : null
      }
    >
      {/* ── Escolha do arquivo ── */}
      {!raw.length && !result && (
        <div className="flex flex-col gap-4 py-6">
          <label className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center hover:border-brand">
            <Upload size={28} className="text-muted" />
            <span className="text-sm text-ink">Selecione um arquivo .csv</span>
            <span className="text-xs text-muted">
              Cabeçalho na primeira linha · separador vírgula ou ponto e vírgula
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>

          <div className="rounded-[var(--radius)] border border-line p-4">
            <p className="text-sm font-medium text-ink">Não tem planilha ainda?</p>
            <p className="mt-1 text-xs text-muted">
              Baixe um modelo já preenchido com três exemplos. O básico cobre o dia a dia; o
              completo traz todos os campos aceitos (fiscal por item, medidas, SKU próprio).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => baixar(templateCsv(basicos), "modelo-produtos-nohub.csv")}
                className="gap-1.5"
              >
                <Download size={15} /> Modelo básico
                <span className="text-xs text-muted">({basicos.length} colunas)</span>
              </Button>
              <Button
                variant="ghost"
                onClick={() => baixar(templateCsv(campos), "modelo-produtos-nohub-completo.csv")}
                className="gap-1.5"
              >
                <Download size={15} /> Modelo completo
                <span className="text-xs text-muted">({campos.length} colunas)</span>
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted">
            Obrigatórios: <span className="font-medium text-ink-2">nome</span> e{" "}
            <span className="font-medium text-ink-2">subcategoria</span>. Números em formato
            brasileiro (7,90). Sim/não aceita sim, não, 1, 0, x.
          </p>
        </div>
      )}

      {/* ── Mapeamento + prévia ── */}
      {raw.length > 0 && !result && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {GRUPOS.map((g) => {
              const doGrupo = campos.filter((c) => c.grupo === g.key);
              if (!doGrupo.length) return null;
              const qtd = doGrupo.filter((c) => mapping[c.key]).length;
              return (
                <details
                  key={g.key}
                  open={ABERTOS.has(g.key) || qtd > 0}
                  className="group rounded-[var(--radius)] border border-line bg-surface"
                >
                  <summary className="flex cursor-pointer select-none list-none items-center gap-2.5 px-4 py-2.5 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-faint transition-transform group-open:rotate-90"
                    />
                    <span className="text-[13.5px] font-medium text-ink">{g.label}</span>
                    <span className="truncate text-xs text-muted">{g.desc}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                      {qtd}/{doGrupo.length}
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
                    {doGrupo.map((c) => (
                      <CampoMap
                        key={c.key}
                        campo={c}
                        headers={headers}
                        valor={mapping[c.key] ?? ""}
                        onChange={(v) => setMapping((m) => ({ ...m, [c.key]: v }))}
                      />
                    ))}
                  </div>
                </details>
              );
            })}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3">
            <input
              type="checkbox"
              checked={criarFaltantes}
              onChange={(e) => setCriarFaltantes(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--brand)]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">
                Criar categorias e subcategorias que não existirem
              </span>
              <span className="block text-xs text-muted">
                A linha precisa trazer também a coluna <code className="font-mono">categoria</code>.
                Sem isso, produto de subcategoria desconhecida é recusado.
              </span>
            </span>
          </label>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Prévia</p>
            <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-faint">
                  <tr>
                    {mapeados.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mapped.slice(0, 6).map((r, i) => {
                    const invalida = !r.nome?.trim() || !r.subcategoria?.trim();
                    return (
                      <tr key={i} className={invalida ? "bg-danger-soft" : undefined}>
                        {mapeados.map((c) => (
                          <td key={c.key} className="whitespace-nowrap px-2 py-1.5 text-ink-2">
                            {r[c.key]?.trim() || "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              {semSub > 0
                ? `${semSub} linha(s) sem subcategoria serão puladas. `
                : "Linhas em vermelho faltam nome ou subcategoria e serão puladas. "}
              Produto com código de barras já cadastrado também é recusado — a importação só cria,
              nunca sobrescreve.
            </p>
          </div>
        </div>
      )}

      {/* ── Resultado ── */}
      {result && (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2 rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-ok">
            <CheckCircle2 size={18} /> {result.criados} produtos importados.
          </div>

          {result.erros.length > 0 && (
            <ListaOcorrencias
              tom="danger"
              icone={<AlertTriangle size={16} />}
              titulo={`${result.erros.length} linhas recusadas`}
              itens={result.erros}
            />
          )}
          {result.avisos.length > 0 && (
            <ListaOcorrencias
              tom="warn"
              icone={<Info size={16} />}
              titulo={`${result.avisos.length} avisos (produto criado assim mesmo)`}
              itens={result.avisos}
            />
          )}

          <Button onClick={onClose} className="self-end">
            Concluir
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function CampoMap({
  campo,
  headers,
  valor,
  onChange,
}: {
  campo: CampoCsv;
  headers: string[];
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-ink-2">
        {campo.label}
        {campo.obrigatorio && <span className="text-danger"> *</span>}
      </span>
      <Select value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">— ignorar —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
      {campo.formato && <span className="text-[11px] text-muted">{campo.formato}</span>}
    </label>
  );
}

function ListaOcorrencias({
  tom,
  icone,
  titulo,
  itens,
}: {
  tom: "danger" | "warn";
  icone: React.ReactNode;
  titulo: string;
  itens: { linha: number; motivo: string }[];
}) {
  return (
    <div className="rounded-[var(--radius)] border border-line">
      <p
        className={`flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium ${
          tom === "danger" ? "text-danger" : "text-warn"
        }`}
      >
        {icone} {titulo}
      </p>
      <ul className="max-h-48 divide-y divide-line overflow-y-auto text-xs">
        {itens.map((e, i) => (
          <li key={i} className="px-4 py-1.5 text-ink-2">
            Linha {e.linha}: {e.motivo}
          </li>
        ))}
      </ul>
    </div>
  );
}
