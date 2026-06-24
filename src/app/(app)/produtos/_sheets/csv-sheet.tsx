"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Upload, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { commitImport, type CsvRow, type ImportResult } from "../csv-actions";

const FIELDS: { key: keyof CsvRow; label: string }[] = [
  { key: "nome", label: "Nome *" },
  { key: "subcategoria", label: "Subcategoria (prefixo/nome) *" },
  { key: "marca", label: "Marca" },
  { key: "ean", label: "Código de barras" },
  { key: "precoVenda", label: "Preço de venda" },
  { key: "custo", label: "Custo" },
  { key: "estoqueInicial", label: "Estoque inicial" },
  { key: "estoqueMinimo", label: "Estoque mínimo" },
  { key: "estoqueIdeal", label: "Estoque ideal" },
];

const TEMPLATE =
  "nome,subcategoria,marca,ean,precoVenda,custo,estoqueInicial,estoqueMinimo,estoqueIdeal\n" +
  "Heineken Long Neck 330ml,CER,Heineken,7896045506873,7.90,5.20,48,24,60\n";

function guess(header: string, key: string): boolean {
  const h = header.toLowerCase();
  const map: Record<string, string[]> = {
    nome: ["nome", "produto", "descri"],
    subcategoria: ["subcategoria", "categoria", "tipo"],
    marca: ["marca", "fabricante"],
    ean: ["ean", "barra", "gtin", "codigo"],
    precoVenda: ["preco", "venda", "valor"],
    custo: ["custo", "compra"],
    estoqueInicial: ["inicial", "saldo", "quant"],
    estoqueMinimo: ["minimo", "mín"],
    estoqueIdeal: ["ideal", "max"],
  };
  return (map[key] ?? []).some((t) => h.includes(t));
}

export function CsvSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  function onFile(file: File) {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const cols = res.meta.fields ?? [];
        setHeaders(cols);
        setRaw(res.data);
        const m: Record<string, string> = {};
        for (const f of FIELDS) {
          const hit = cols.find((c) => guess(c, f.key));
          if (hit) m[f.key] = hit;
        }
        setMapping(m);
      },
    });
  }

  const mapped: CsvRow[] = raw.map((r) => {
    const row: CsvRow = {};
    for (const f of FIELDS) {
      const h = mapping[f.key];
      if (h) row[f.key] = r[h];
    }
    return row;
  });

  const validas = mapped.filter((r) => r.nome?.trim() && r.subcategoria?.trim()).length;

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-produtos-nohub.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importar() {
    start(async () => {
      const r = await commitImport(mapped);
      setResult(r);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Importar produtos (CSV)" description="Mapeie as colunas, confira a prévia e confirme." width="xl"
      footer={
        raw.length > 0 && !result ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{validas} de {raw.length} linhas prontas</span>
            <Button onClick={importar} disabled={pending || validas === 0}>
              {pending ? "Importando…" : `Importar ${validas} produtos`}
            </Button>
          </div>
        ) : null
      }
    >
      {!raw.length && !result && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <label className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2 px-6 py-12 hover:border-brand">
            <Upload size={28} className="text-muted" />
            <span className="text-sm text-ink">Selecione um arquivo .csv</span>
            <span className="text-xs text-muted">Cabeçalho na primeira linha</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <Button variant="ghost" onClick={downloadTemplate} className="gap-1.5"><Download size={15} /> Baixar modelo</Button>
        </div>
      )}

      {raw.length > 0 && !result && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-[13px]">
                <span className="font-medium text-ink-2">{f.label}</span>
                <Select value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                  <option value="">— ignorar —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </label>
            ))}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Prévia</p>
            <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-faint">
                  <tr>{FIELDS.filter((f) => mapping[f.key]).map((f) => <th key={f.key} className="px-2 py-1.5 font-medium">{f.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mapped.slice(0, 6).map((r, i) => {
                    const invalida = !r.nome?.trim() || !r.subcategoria?.trim();
                    return (
                      <tr key={i} className={invalida ? "bg-danger-soft" : undefined}>
                        {FIELDS.filter((f) => mapping[f.key]).map((f) => <td key={f.key} className="px-2 py-1.5 text-ink-2">{r[f.key] ?? "—"}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Linhas em vermelho faltam nome ou subcategoria e serão puladas.</p>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2 rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-ok">
            <CheckCircle2 size={18} /> {result.criados} produtos importados.
          </div>
          {result.erros.length > 0 && (
            <div className="rounded-[var(--radius)] border border-line">
              <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium text-warn">
                <AlertTriangle size={16} /> {result.erros.length} linhas com problema
              </p>
              <ul className="max-h-48 divide-y divide-line overflow-y-auto text-xs">
                {result.erros.map((e, i) => (
                  <li key={i} className="px-4 py-1.5 text-ink-2">Linha {e.linha}: {e.motivo}</li>
                ))}
              </ul>
            </div>
          )}
          <Button onClick={onClose} className="self-end">Concluir</Button>
        </div>
      )}
    </Sheet>
  );
}
