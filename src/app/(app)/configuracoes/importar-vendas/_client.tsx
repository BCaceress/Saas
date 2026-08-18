"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  preVisualizarImportacaoVendas,
  confirmarImportacaoVendas,
  type PreVisualizacaoImportacao,
  type ResultadoImportacao,
  type LojaOpcao,
} from "./actions";

const fmtMoney = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: Date) =>
  new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function ImportarVendasClient({
  souAdmin,
  sites,
}: {
  souAdmin: boolean;
  sites: LojaOpcao[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvTexto, setCsvTexto] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreVisualizacaoImportacao | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  if (!souAdmin) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-6 text-sm text-muted">
        Apenas um administrador pode importar histórico de vendas.
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-6 text-sm text-muted">
        Cadastre uma loja em{" "}
        <span className="font-medium text-ink">Configurações → Lojas e pontos</span> antes de
        importar vendas.
      </div>
    );
  }

  function reiniciar() {
    setFileName(null);
    setCsvTexto(null);
    setPreview(null);
    setResultado(null);
  }

  async function onFile(file: File) {
    reiniciar();
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Selecione um arquivo .csv.");
      return;
    }
    const texto = await file.text();
    setFileName(file.name);
    setCsvTexto(texto);
    start(async () => {
      try {
        const r = await preVisualizarImportacaoVendas(texto);
        setPreview(r);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
        setCsvTexto(null);
        setFileName(null);
      }
    });
  }

  function confirmar() {
    if (!csvTexto || !siteId) return;
    start(async () => {
      try {
        const r = await confirmarImportacaoVendas(csvTexto, siteId);
        setResultado(r);
        toast.success(`${r.vendasImportadas} vendas importadas.`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao importar.");
      }
    });
  }

  if (resultado) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-line bg-ok-soft px-5 py-4 text-ok">
          <CheckCircle2 size={20} />
          <div>
            <p className="font-semibold">{resultado.vendasImportadas} vendas importadas.</p>
            <p className="text-sm opacity-90">Total líquido: {fmtMoney(resultado.totalLiquido)}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={reiniciar} className="w-fit gap-1.5">
          <RotateCcw size={15} /> Importar outro arquivo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <p className="mb-3 text-sm font-medium text-ink">Loja de destino</p>
        {sites.length > 1 ? (
          <Select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            containerClassName="max-w-xs"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-sm text-ink-2">{sites[0].nome}</p>
        )}
        <p className="mt-3 text-xs text-muted">
          Todas as vendas do arquivo entram nesta loja. Não dá baixa no estoque atual — é só
          histórico para relatórios e análises.
        </p>
      </div>

      {!fileName && (
        <label className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center hover:border-brand">
          <Upload size={28} className="text-muted" />
          <span className="text-sm text-ink">Selecione um arquivo .csv</span>
          <span className="max-w-md text-xs text-muted">
            Colunas: venda_id, data_hora, produto, quantidade, preco_unitario, total_item,
            total_liquido_item, desconto_item. O nome do produto precisa bater (ou ficar
            parecido) com um produto já cadastrado.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      )}

      {fileName && (
        <div className="flex items-center justify-between rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3">
          <span className="truncate text-sm text-ink-2">{fileName}</span>
          <Button variant="ghost" size="sm" onClick={reiniciar}>
            Trocar arquivo
          </Button>
        </div>
      )}

      {pending && !preview && (
        <p className="text-sm text-muted">Lendo arquivo e casando produtos…</p>
      )}

      {preview && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metrica titulo="Vendas prontas" valor={String(preview.totalVendasProntas)} />
            <Metrica titulo="Total líquido" valor={fmtMoney(preview.totalLiquido)} />
            <Metrica
              titulo="Vendas puladas"
              valor={String(preview.vendasPuladas)}
              tom={preview.vendasPuladas > 0 ? "warn" : undefined}
            />
          </div>

          {(preview.itensPulados > 0 || preview.linhasColapsadas > 0) && (
            <p className="text-xs text-muted">
              {preview.itensPulados > 0 &&
                `${preview.itensPulados} item(ns) pulado(s) (quantidade zero ou produto não casado). `}
              {preview.linhasColapsadas > 0 &&
                `${preview.linhasColapsadas} linha(s) duplicada(s) colapsada(s).`}
            </p>
          )}

          {preview.totalNaoCasados > 0 && (
            <div className="rounded-[var(--radius)] border border-line">
              <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium text-warn">
                <AlertTriangle size={16} /> {preview.totalNaoCasados} produto(s) não casado(s)
                {preview.totalNaoCasados > preview.naoCasados.length &&
                  ` — mostrando os ${preview.naoCasados.length} mais frequentes`}
              </p>
              <ul className="max-h-48 divide-y divide-line overflow-y-auto text-xs">
                {preview.naoCasados.map((n) => (
                  <li key={n.nome} className="flex justify-between px-4 py-1.5 text-ink-2">
                    <span className="truncate">{n.nome}</span>
                    <span className="shrink-0 text-muted">{n.vezes}x</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-4 py-2 text-xs text-muted">
                Esses itens ficam de fora por enquanto — a venda entra do mesmo jeito com os
                itens que casaram. Cadastre o produto (ou ajuste o nome/código no CSV) e importe
                de novo depois; vendas já importadas não duplicam.
              </p>
            </div>
          )}

          {preview.amostra.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Prévia</p>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-2 text-faint">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Data/hora</th>
                      <th className="px-2 py-1.5 font-medium">Itens</th>
                      <th className="px-2 py-1.5 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.amostra.map((v, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5 text-ink-2">{fmtData(v.dataHora)}</td>
                        <td className="px-2 py-1.5 text-ink-2">{v.numItens}</td>
                        <td className="px-2 py-1.5 text-ink-2">{fmtMoney(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-line-strong bg-surface px-4 py-3">
            <span className="text-sm text-muted">
              Nenhuma venda foi gravada ainda — confirme para importar de verdade.
            </span>
            <Button onClick={confirmar} disabled={pending || preview.totalVendasProntas === 0}>
              {pending ? "Importando…" : `Importar ${preview.totalVendasProntas} vendas`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  tom,
}: {
  titulo: string;
  valor: string;
  tom?: "warn";
}) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-surface p-4">
      <p className="text-xs text-muted">{titulo}</p>
      <p className={`mt-1 text-lg font-semibold ${tom === "warn" ? "text-warn" : "text-ink"}`}>
        {valor}
      </p>
    </div>
  );
}
