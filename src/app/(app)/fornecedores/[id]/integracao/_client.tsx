"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plug,
  RefreshCw,
  Loader2,
  Check,
  Plus,
  Trash2,
  FileUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  PackageSearch,
  CalendarClock,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { SupplierIntegrationKind } from "@/generated/prisma";
import { KIND_LABEL, Metrica, MetricaGrid, fmtQuando } from "../../../compras/_catalogo/ui";
import {
  salvarIntegracaoAction,
  sincronizarFornecedorAction,
  testarConexaoAction,
} from "../../actions";
import type { IntegracaoFornecedor } from "../_data";

// ============================================================
// Aba Integração — toda a comunicação entre o fornecedor e o NoHub.
//
// Antes isso morava em Compras, longe do fornecedor a que pertencia. Aqui a
// tela se adapta ao formato escolhido: API pede endereço e credencial;
// planilha, PDF e XML pedem o arquivo. Ninguém precisa saber qual conector
// roda por baixo.
// ============================================================

const KINDS: SupplierIntegrationKind[] = [
  "API",
  "PLANILHA",
  "CSV",
  "XML",
  "PDF",
  "IMAGEM",
  "JSON",
  "MANUAL",
];

/** Formatos que entram por arquivo — a tela troca a caixa de envio conforme o tipo. */
const ACEITE_POR_KIND: Partial<Record<SupplierIntegrationKind, string>> = {
  PLANILHA: ".xlsx,.xlsm",
  CSV: ".csv,.txt",
  XML: ".xml",
  PDF: ".pdf",
  IMAGEM: ".jpg,.jpeg,.png,.webp",
  JSON: ".json",
};

const DICA_POR_KIND: Partial<Record<SupplierIntegrationKind, string>> = {
  PLANILHA: "Colunas esperadas: código, EAN, descrição, unidade, preço, preço promocional, quantidade mínima, validade da oferta. A ordem não importa — o cabeçalho é reconhecido pelo nome.",
  CSV: "Mesmas colunas da planilha, separadas por ponto e vírgula ou vírgula. A primeira linha precisa ser o cabeçalho.",
  XML: "Aceita NF-e de entrada e XML de tabela de preço. Os itens são casados pelo código do fornecedor e pelo GTIN.",
  PDF: "A leitura é feita item a item — encarte e tabela impressa levam alguns segundos.",
  IMAGEM: "Foto do encarte ou print da tabela. Quanto mais nítido o preço, melhor a leitura.",
  JSON: "Lista de objetos com descrição e preço. Os demais campos são opcionais.",
};

type Par = { nome: string; valor: string };

export function IntegracaoCliente({
  integracao,
  nome,
  podeEditar,
}: {
  integracao: IntegracaoFornecedor;
  nome: string;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sincronizando, setSincronizando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; mensagem: string } | null>(null);

  const [possui, setPossui] = useState(integracao.possuiIntegracao);
  const [kind, setKind] = useState<SupplierIntegrationKind>(integracao.tipoIntegracao ?? "PLANILHA");
  const [manual, setManual] = useState(integracao.aceitaImportacaoManual);
  const [automatica, setAutomatica] = useState(integracao.aceitaImportacaoAutomatica);
  const [endpoint, setEndpoint] = useState(integracao.endpoint ?? "");
  const [authTipo, setAuthTipo] = useState(integracao.authTipo ?? "bearer");
  const [usuario, setUsuario] = useState(integracao.usuario ?? "");
  const [credencial, setCredencial] = useState("");
  const [headers, setHeaders] = useState<Par[]>(integracao.headers);
  const [frequencia, setFrequencia] = useState(String(integracao.frequenciaHoras ?? 24));

  const porArquivo = kind !== "API" && kind !== "MANUAL";

  function salvar() {
    start(async () => {
      try {
        await salvarIntegracaoAction({
          supplierId: integracao.supplierId,
          possuiIntegracao: possui,
          tipoIntegracao: possui ? kind : null,
          aceitaImportacaoManual: manual,
          aceitaImportacaoAutomatica: automatica,
          endpoint: kind === "API" && endpoint ? endpoint : null,
          authTipo: kind === "API" ? (authTipo as "bearer" | "basic" | "apikey" | "none") : null,
          usuario: kind === "API" && authTipo === "basic" ? usuario : null,
          credencial: credencial || undefined,
          headers: kind === "API" ? headers.filter((h) => h.nome.trim()) : [],
          frequenciaHoras: automatica ? Number(frequencia) : null,
        });
        setCredencial("");
        toast.success("Integração salva", `${nome} atualizado.`);
        router.refresh();
      } catch (e) {
        toast.error("Não deu para salvar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    try {
      const r = await testarConexaoAction(integracao.supplierId);
      setTeste(r);
      router.refresh();
    } catch (e) {
      setTeste({ ok: false, mensagem: e instanceof Error ? e.message : "Falha no teste." });
    } finally {
      setTestando(false);
    }
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await sincronizarFornecedorAction(integracao.supplierId);
      toast.success(
        "Tabela sincronizada",
        `${r.itensLidos} lidos · ${r.itensNovos} novos · ${r.itensAtualizados} atualizados.`,
      );
      router.refresh();
    } catch (e) {
      toast.error("Não deu para sincronizar", e instanceof Error ? e.message : undefined);
    } finally {
      setSincronizando(false);
    }
  }

  const situacaoLabel = useMemo(() => {
    switch (integracao.situacaoIntegracao) {
      case "ONLINE":
        return "Ativa";
      case "OFFLINE":
        return "Parada";
      case "ERRO":
        return "Com erro";
      default:
        return "Sem integração";
    }
  }, [integracao.situacaoIntegracao]);

  return (
    <div className="flex flex-col gap-4 pb-2">
      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Situação"
          valor={situacaoLabel}
          sub={integracao.tipoIntegracao ? KIND_LABEL[integracao.tipoIntegracao] : "nenhum formato"}
          tom={
            integracao.situacaoIntegracao === "ONLINE"
              ? "ok"
              : integracao.situacaoIntegracao === "ERRO"
                ? "accent"
                : "ink"
          }
          icon={<Activity size={12} />}
        />
        <Metrica
          label="Produtos importados"
          valor={integracao.totalProdutos.toLocaleString("pt-BR")}
          sub="no catálogo ativo"
          icon={<PackageSearch size={12} />}
        />
        <Metrica
          label="Última sincronização"
          valor={fmtQuando(integracao.ultimaImportacao?.createdAt ?? integracao.ultimaSync)}
          sub={integracao.ultimaImportacao ? `${integracao.ultimaImportacao.itensLidos} itens lidos` : "nunca rodou"}
          icon={<RefreshCw size={12} />}
        />
        <Metrica
          label="Próxima automática"
          valor={automatica ? fmtQuando(integracao.proximaSync) : "Desligada"}
          sub={automatica ? `a cada ${frequencia}h` : "sincroniza sob demanda"}
          icon={<CalendarClock size={12} />}
        />
      </MetricaGrid>

      {integracao.ultimoErro && (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/40 bg-danger-soft/40 p-3 text-[12px] text-ink-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
          Último erro do fornecedor: {integracao.ultimoErro}
        </p>
      )}

      <fieldset disabled={!podeEditar} className="flex flex-col gap-4">
        <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] bg-brand-soft text-brand">
              <Plug size={14} />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Como a tabela chega</h2>
              <p className="text-[11px] text-muted">Define qual leitor o sistema usa ao importar.</p>
            </div>
          </div>

          <div className="flex flex-col gap-5 p-4">
            <LinhaSwitch
              titulo="Este fornecedor manda tabela"
              descricao="Desligue para tirá-lo do comparador sem apagar o histórico de preços."
              checked={possui}
              onChange={setPossui}
            />

            <Field label="Tipo da integração">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as SupplierIntegrationKind)}
                disabled={!possui}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>

            {kind === "API" && possui && (
              <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface-2/50 p-4">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                  <Plug size={13} /> Acesso à API do fornecedor
                </p>

                <Field label="URL" hint="Endpoint que devolve a lista de produtos em JSON.">
                  <Input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://api.fornecedor.com.br/tabela"
                    inputMode="url"
                  />
                </Field>

                <Field label="Método de autenticação">
                  <Select value={authTipo} onChange={(e) => setAuthTipo(e.target.value)}>
                    <option value="bearer">Token (Bearer)</option>
                    <option value="apikey">Chave de API</option>
                    <option value="basic">Usuário e senha (Basic)</option>
                    <option value="none">Sem autenticação</option>
                  </Select>
                </Field>

                {authTipo === "basic" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Usuário">
                      <Input
                        value={usuario}
                        onChange={(e) => setUsuario(e.target.value)}
                        autoComplete="off"
                        placeholder="usuario.integracao"
                      />
                    </Field>
                    <Field
                      label="Senha"
                      hint={
                        integracao.temCredencial
                          ? "Guardada cifrada. Deixe em branco para manter a atual."
                          : "Guardada cifrada — nunca volta para a tela."
                      }
                    >
                      <Input
                        type="password"
                        value={credencial}
                        onChange={(e) => setCredencial(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                    </Field>
                  </div>
                ) : authTipo !== "none" ? (
                  <Field
                    label={authTipo === "apikey" ? "Chave de API" : "Token"}
                    hint={
                      integracao.temCredencial
                        ? "Guardada cifrada. Deixe em branco para manter a atual."
                        : "Guardada cifrada — nunca volta para a tela."
                    }
                  >
                    <Input
                      type="password"
                      value={credencial}
                      onChange={(e) => setCredencial(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="off"
                    />
                  </Field>
                ) : null}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-medium text-ink">Headers</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setHeaders((h) => [...h, { nome: "", valor: "" }])}
                    >
                      <Plus size={14} /> Header
                    </Button>
                  </div>
                  {headers.length === 0 ? (
                    <p className="text-[12px] text-muted">
                      Nenhum cabeçalho extra. Adicione só se o fornecedor exigir.
                    </p>
                  ) : (
                    headers.map((h, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={h.nome}
                          onChange={(e) =>
                            setHeaders((atual) =>
                              atual.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)),
                            )
                          }
                          placeholder="X-Cliente"
                          aria-label={`Nome do header ${i + 1}`}
                          className="font-mono"
                        />
                        <Input
                          value={h.valor}
                          onChange={(e) =>
                            setHeaders((atual) =>
                              atual.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)),
                            )
                          }
                          placeholder="valor"
                          aria-label={`Valor do header ${i + 1}`}
                          className="font-mono"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Remover header"
                          onClick={() => setHeaders((atual) => atual.filter((_, j) => j !== i))}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {teste && (
                  <p
                    className={cn(
                      "flex items-start gap-2 rounded-[var(--radius)] p-3 text-[12px]",
                      teste.ok ? "bg-ok-soft/50 text-ink-2" : "bg-danger-soft/40 text-ink-2",
                    )}
                  >
                    {teste.ok ? (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                    ) : (
                      <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
                    )}
                    {teste.mensagem}
                  </p>
                )}
              </div>
            )}

            {porArquivo && possui && (
              <EnvioArquivo
                supplierId={integracao.supplierId}
                kind={kind}
                ultimoArquivo={integracao.ultimaImportacao}
              />
            )}

            {kind === "MANUAL" && possui && (
              <p className="flex items-start gap-2 rounded-[var(--radius)] bg-brand-soft/60 p-3 text-[12px] text-ink-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand" />
                Sem arquivo nem API: as ofertas deste fornecedor são digitadas em Compras ›
                Importações › Digitar ofertas.
              </p>
            )}

            <LinhaSwitch
              titulo="Importação manual"
              descricao="Permite subir arquivo deste fornecedor na tela global de importações."
              checked={manual}
              onChange={setManual}
            />

            <LinhaSwitch
              titulo="Sincronização automática"
              descricao="Só vale para API. O sistema busca a tabela sozinho no intervalo escolhido."
              checked={automatica}
              onChange={setAutomatica}
              disabled={kind !== "API"}
            />

            {automatica && kind === "API" && (
              <Field
                label="Intervalo da sincronização"
                hint="Distribuidor costuma atualizar tabela uma vez por dia."
              >
                <Select value={frequencia} onChange={(e) => setFrequencia(e.target.value)}>
                  <option value="6">A cada 6 horas</option>
                  <option value="12">A cada 12 horas</option>
                  <option value="24">A cada 24 horas</option>
                  <option value="72">A cada 3 dias</option>
                  <option value="168">A cada 7 dias</option>
                </Select>
              </Field>
            )}
          </div>
        </section>
      </fieldset>

      {integracao.importacoes.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Últimas importações deste fornecedor</h2>
            <p className="text-[11px] text-muted">
              O extrato completo, de todos os fornecedores, fica em Compras › Importações.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-3 py-2.5 font-medium">Origem</th>
                  <th className="px-3 py-2.5 text-right font-medium">Lidos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Novos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Atualizados</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sem vínculo</th>
                </tr>
              </thead>
              <tbody>
                {integracao.importacoes.map((imp) => (
                  <tr key={imp.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-[12px] text-muted">{fmtQuando(imp.createdAt)}</td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">
                      {KIND_LABEL[imp.tipo]} <span className="text-faint">· {imp.origem}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-ink">{imp.itensLidos}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-ink">{imp.itensNovos}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-ink">
                      {imp.itensAtualizados}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px]">
                      {imp.itensSemVinculo > 0 ? (
                        <span className="text-warn">{imp.itensSemVinculo}</span>
                      ) : (
                        <span className="text-faint">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {podeEditar && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-float)]">
          <p className="text-[12px] text-muted">
            Salve antes de testar — o teste usa o que já está gravado.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {kind === "API" && (
              <>
                <Button variant="ghost" onClick={testar} disabled={testando || pending}>
                  {testando ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
                  Testar conexão
                </Button>
                <Button variant="secondary" onClick={sincronizar} disabled={sincronizando || pending}>
                  {sincronizando ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Sincronizar agora
                </Button>
              </>
            )}
            <Button onClick={salvar} disabled={pending}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Salvar configuração
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Envio de arquivo (planilha, CSV, XML, PDF, imagem, JSON) ─

function EnvioArquivo({
  supplierId,
  kind,
  ultimoArquivo,
}: {
  supplierId: string;
  kind: SupplierIntegrationKind;
  ultimoArquivo: IntegracaoFornecedor["ultimaImportacao"];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [substituir, setSubstituir] = useState(true);

  async function enviar(arquivo: File) {
    setEnviando(true);
    try {
      const form = new FormData();
      form.set("arquivo", arquivo);
      form.set("supplierId", supplierId);
      form.set("substituir", substituir ? "1" : "0");
      form.set("tipo", kind);

      const resposta = await fetch("/api/compras/importar", { method: "POST", body: form });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error("Importação falhou", dados?.erro ?? "Tente outro formato de arquivo.");
      } else {
        toast.success(
          "Tabela lida",
          `${dados.itensLidos} itens · ${dados.itensNovos} novos · ${dados.itensSemVinculo} sem vínculo.`,
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

  const rotulo =
    kind === "PDF"
      ? "Enviar PDF"
      : kind === "XML"
        ? "Importar XML"
        : kind === "IMAGEM"
          ? "Enviar foto do encarte"
          : "Importar nova planilha";

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface-2/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted">{rotulo}</p>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={substituir}
            onChange={(e) => setSubstituir(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand)]"
          />
          Substituir a tabela anterior
        </label>
      </div>

      {DICA_POR_KIND[kind] && (
        <p className="flex items-start gap-2 text-[12px] text-muted">
          <Download size={13} className="mt-0.5 shrink-0 text-faint" />
          <span>
            <span className="font-medium text-ink-2">Modelo esperado: </span>
            {DICA_POR_KIND[kind]}
          </span>
        </p>
      )}

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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed px-6 py-8 text-center transition-colors",
          arrastando ? "border-brand bg-brand-soft/40" : "border-line hover:border-brand/60",
          enviando && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACEITE_POR_KIND[kind]}
          className="sr-only"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void enviar(arquivo);
          }}
        />
        {enviando ? (
          <>
            <Loader2 size={20} className="animate-spin text-brand" />
            <p className="text-[13px] font-medium text-ink">Lendo a tabela…</p>
          </>
        ) : (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] bg-brand-soft text-brand">
              <FileUp size={18} />
            </div>
            <p className="text-[13px] font-medium text-ink">Arraste aqui ou clique para escolher</p>
            <p className="text-[12px] text-muted">Até 25 MB.</p>
          </>
        )}
      </label>

      {ultimoArquivo && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] text-muted">
          <span className="font-medium text-ink-2">
            {kind === "PDF" || kind === "IMAGEM" ? "Última leitura" : "Último arquivo"}:
          </span>
          <span className="truncate">{ultimoArquivo.arquivoNome ?? "sem nome"}</span>
          <span className="text-faint">·</span>
          <span>{fmtQuando(ultimoArquivo.createdAt)}</span>
          <span className="text-faint">·</span>
          <Badge tone={ultimoArquivo.status === "CONCLUIDA" ? "ok" : "warn"}>
            {ultimoArquivo.itensLidos} produtos encontrados
          </Badge>
          {ultimoArquivo.mensagem && (
            <span className="w-full truncate text-faint" title={ultimoArquivo.mensagem}>
              {ultimoArquivo.mensagem}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LinhaSwitch({
  titulo,
  descricao,
  checked,
  onChange,
  disabled,
}: {
  titulo: string;
  descricao: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-50")}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{titulo}</p>
        <p className="mt-0.5 text-[12px] text-muted">{descricao}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
