"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  FileSignature,
  Hash,
  Plug,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj, maskCep, maskPhone } from "@/lib/masks";
import { Switch } from "../_ui";
import {
  enviarCertificadoAction,
  salvarEmitenteAction,
  salvarProvedorFiscalAction,
  salvarSerieAction,
  testarProvedorFiscalAction,
} from "./actions";

type Provider = "NUVEM_FISCAL" | "PLUGNOTAS" | "FOCUS" | "TECNOSPEED" | "SIMULADO";
type Ambiente = "PRODUCAO" | "HOMOLOGACAO";
type Regime = "SIMPLES_NACIONAL" | "SIMPLES_EXCESSO" | "REGIME_NORMAL";
type Modelo = "NFCE" | "NFE";

export type EmitenteView = {
  siteId: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  ie: string;
  im: string | null;
  cnae: string | null;
  regime: Regime;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  telefone: string | null;
  cscId: string | null;
  temCsc: boolean;
  naturezaOperacaoPadrao: string;
  certificadoTitular: string | null;
  certificadoValidade: string | null;
};

export type SerieView = {
  siteId: string;
  modelo: Modelo;
  serie: number;
  proximoNumero: number;
  ativa: boolean;
};

type ConfigView = {
  provider: Provider;
  ambiente: Ambiente;
  ativo: boolean;
  emissaoAutomaticaNfce: boolean;
  prazoCancelamentoMin: number;
  temToken: boolean;
  temWebhookSecret: boolean;
};

const PROVIDERS: { value: Provider; label: string; nota: string }[] = [
  { value: "SIMULADO", label: "Simulado (sem SEFAZ)", nota: "Para testar o fluxo sem certificado nem contrato." },
  { value: "NUVEM_FISCAL", label: "Nuvem Fiscal", nota: "Cobrança por nota emitida." },
  { value: "PLUGNOTAS", label: "PlugNotas", nota: "Cobrança por nota emitida." },
  { value: "FOCUS", label: "Focus NFe", nota: "Cobrança por nota emitida." },
  { value: "TECNOSPEED", label: "Tecnospeed", nota: "Exige contrato direto." },
];

const REGIMES: { value: Regime; label: string }[] = [
  { value: "SIMPLES_NACIONAL", label: "Simples Nacional (CRT 1)" },
  { value: "SIMPLES_EXCESSO", label: "Simples Nacional — excesso de sublimite (CRT 2)" },
  { value: "REGIME_NORMAL", label: "Regime Normal (CRT 3)" },
];

function Bloco({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          {icon}
        </span>
        <div>
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Dias até vencer — negativo = já venceu. */
function diasAte(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

const emitenteVazio = (siteId: string): EmitenteView => ({
  siteId,
  cnpj: "",
  razaoSocial: "",
  nomeFantasia: "",
  ie: "",
  im: "",
  cnae: "",
  regime: "SIMPLES_NACIONAL",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  municipio: "",
  codigoMunicipio: "",
  uf: "",
  telefone: "",
  cscId: "",
  temCsc: false,
  naturezaOperacaoPadrao: "Venda de mercadoria",
  certificadoTitular: null,
  certificadoValidade: null,
});

export function FiscalConfigClient({
  moduloLigado,
  sites,
  config,
  emitentes,
  series,
}: {
  moduloLigado: boolean;
  sites: { id: string; nome: string }[];
  config: ConfigView | null;
  emitentes: EmitenteView[];
  series: SerieView[];
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-4">
      {!moduloLigado && (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-warn/40 bg-warn-soft p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-sm text-ink-2">
            O módulo fiscal está desligado — nada será emitido, mesmo com tudo preenchido aqui.{" "}
            <Link href="/configuracoes/modulos" className="font-medium text-brand underline">
              Ligar em Módulos
            </Link>
            .
          </p>
        </div>
      )}

      <ProvedorBloco config={config} onSaved={() => router.refresh()} />

      {sites.length === 0 ? (
        <p className="text-sm text-muted">Cadastre uma loja antes de configurar a emissão.</p>
      ) : (
        <>
          <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
            <Field
              label="Loja"
              htmlFor="site"
              hint="Cada loja emite com o próprio CNPJ, certificado e numeração."
            >
              <Select id="site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <EmitenteBloco
            key={siteId}
            emitente={emitentes.find((e) => e.siteId === siteId) ?? emitenteVazio(siteId)}
            onSaved={() => router.refresh()}
          />

          <CertificadoBloco
            key={`cert-${siteId}`}
            siteId={siteId}
            emitente={emitentes.find((e) => e.siteId === siteId) ?? null}
            onSaved={() => router.refresh()}
          />

          <SeriesBloco
            key={`serie-${siteId}`}
            siteId={siteId}
            series={series.filter((s) => s.siteId === siteId)}
            onSaved={() => router.refresh()}
          />
        </>
      )}
    </div>
  );
}

// ── Provedor ────────────────────────────────────────────────

function ProvedorBloco({
  config,
  onSaved,
}: {
  config: ConfigView | null;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [testando, setTestando] = useState(false);
  const [form, setForm] = useState({
    provider: config?.provider ?? ("SIMULADO" as Provider),
    ambiente: config?.ambiente ?? ("HOMOLOGACAO" as Ambiente),
    apiToken: "",
    webhookSecret: "",
    ativo: config?.ativo ?? false,
    emissaoAutomaticaNfce: config?.emissaoAutomaticaNfce ?? false,
    prazoCancelamentoMin: String(config?.prazoCancelamentoMin ?? 30),
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const nota = PROVIDERS.find((p) => p.value === form.provider)?.nota ?? "";
  const precisaToken = form.provider !== "SIMULADO";

  function salvar() {
    start(async () => {
      try {
        await salvarProvedorFiscalAction(form);
        toast.success("Provedor fiscal salvo.");
        set({ apiToken: "", webhookSecret: "" });
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  async function testar() {
    setTestando(true);
    try {
      await testarProvedorFiscalAction();
      toast.success("Credencial válida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar a credencial.");
    } finally {
      setTestando(false);
    }
  }

  return (
    <Bloco
      icon={<Plug size={18} />}
      title="Provedor de emissão"
      description="Quem assina e transmite a nota para a SEFAZ. Trocar de provedor não muda nada no resto do sistema."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provedor" htmlFor="provider" hint={nota}>
          <Select
            id="provider"
            value={form.provider}
            onChange={(e) => set({ provider: e.target.value as Provider })}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Ambiente"
          htmlFor="ambiente"
          hint="Homologação emite notas sem valor fiscal — use para testar."
        >
          <Select
            id="ambiente"
            value={form.ambiente}
            onChange={(e) => set({ ambiente: e.target.value as Ambiente })}
          >
            <option value="HOMOLOGACAO">Homologação (teste)</option>
            <option value="PRODUCAO">Produção (valor fiscal)</option>
          </Select>
        </Field>

        {precisaToken && (
          <>
            <Field
              label="Token de API"
              htmlFor="token"
              hint={config?.temToken ? "Já salvo. Preencha só para substituir." : "Copie do painel do provedor."}
            >
              <Input
                id="token"
                type="password"
                value={form.apiToken}
                onChange={(e) => set({ apiToken: e.target.value })}
                placeholder={config?.temToken ? "••••••••" : "Cole o token"}
                autoComplete="off"
              />
            </Field>

            <Field
              label="Segredo do webhook"
              htmlFor="webhook"
              hint={
                config?.temWebhookSecret
                  ? "Já salvo. Preencha só para substituir."
                  : "Valida o aviso de autorização enviado pelo provedor."
              }
            >
              <Input
                id="webhook"
                type="password"
                value={form.webhookSecret}
                onChange={(e) => set({ webhookSecret: e.target.value })}
                placeholder={config?.temWebhookSecret ? "••••••••" : "Opcional"}
                autoComplete="off"
              />
            </Field>
          </>
        )}

        <Field
          label="Prazo de cancelamento (minutos)"
          htmlFor="prazo"
          hint="Janela em que a SEFAZ da sua UF ainda aceita cancelar uma NFC-e. Fora dela, só devolução."
        >
          <Input
            id="prazo"
            value={form.prazoCancelamentoMin}
            onChange={(e) => set({ prazoCancelamentoMin: e.target.value.replace(/\D/g, "") })}
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
        <label className="flex items-start justify-between gap-4">
          <span className="text-sm">
            <span className="font-medium text-ink">Emissão ligada</span>
            <span className="mt-0.5 block text-muted">
              Com isso desligado nada é transmitido — útil enquanto o contador revisa.
            </span>
          </span>
          <Switch
            checked={form.ativo}
            onChange={(v) => set({ ativo: v })}
            label="Emissão ligada"
          />
        </label>

        <label className="flex items-start justify-between gap-4 border-t border-line pt-3">
          <span className="text-sm">
            <span className="font-medium text-ink">Emitir NFC-e automaticamente no PDV</span>
            <span className="mt-0.5 block text-muted">
              A venda não espera a SEFAZ: fecha na hora e a nota é transmitida em seguida.
            </span>
          </span>
          <Switch
            checked={form.emissaoAutomaticaNfce}
            onChange={(v) => set({ emissaoAutomaticaNfce: v })}
            label="Emitir NFC-e automaticamente"
          />
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        {config && precisaToken && (
          <Button variant="outline" onClick={testar} disabled={testando || pending}>
            <BadgeCheck size={16} /> {testando ? "Testando…" : "Testar credencial"}
          </Button>
        )}
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar provedor"}
        </Button>
      </div>
    </Bloco>
  );
}

// ── Emitente ────────────────────────────────────────────────

function EmitenteBloco({
  emitente,
  onSaved,
}: {
  emitente: EmitenteView;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [buscando, setBuscando] = useState<"cnpj" | "cep" | "ibge" | null>(null);
  const [form, setForm] = useState({
    ...emitente,
    cnpj: emitente.cnpj ? maskCnpj(emitente.cnpj) : "",
    cep: emitente.cep ? maskCep(emitente.cep) : "",
    telefone: emitente.telefone ? maskPhone(emitente.telefone) : "",
    nomeFantasia: emitente.nomeFantasia ?? "",
    im: emitente.im ?? "",
    cnae: emitente.cnae ?? "",
    complemento: emitente.complemento ?? "",
    cscId: emitente.cscId ?? "",
    csc: "",
  });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  async function buscarCnpj() {
    const digits = form.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) return toast.error("Informe os 14 dígitos do CNPJ.");
    setBuscando("cnpj");
    try {
      const res = await fetch(`/api/fornecedores/cnpj/${digits}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao consultar o CNPJ.");
      set({
        razaoSocial: d.razaoSocial || form.razaoSocial,
        nomeFantasia: d.nomeFantasia || form.nomeFantasia,
        telefone: d.telefone ? maskPhone(d.telefone) : form.telefone,
        cep: d.cep ? maskCep(d.cep) : form.cep,
        logradouro: d.logradouro || form.logradouro,
        numero: d.numero || form.numero,
        bairro: d.bairro || form.bairro,
        municipio: d.municipio || form.municipio,
        uf: d.uf || form.uf,
      });
      toast.success("Dados da Receita preenchidos — falta IE e código do município.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar o CNPJ.");
    } finally {
      setBuscando(null);
    }
  }

  async function buscarCep() {
    const digits = form.cep.replace(/\D/g, "");
    if (digits.length !== 8) return toast.error("Informe os 8 dígitos do CEP.");
    setBuscando("cep");
    try {
      const res = await fetch(`/api/cep/${digits}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao consultar o CEP.");
      set({
        logradouro: d.rua || form.logradouro,
        bairro: d.bairro || form.bairro,
        municipio: d.cidade || form.municipio,
        uf: d.estado || form.uf,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar o CEP.");
    } finally {
      setBuscando(null);
    }
  }

  async function buscarCodigoMunicipio() {
    if (!form.municipio || form.uf.length !== 2) {
      return toast.error("Preencha município e UF primeiro.");
    }
    setBuscando("ibge");
    try {
      const res = await fetch(
        `/api/ibge/municipio?uf=${form.uf}&municipio=${encodeURIComponent(form.municipio)}`,
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Falha ao consultar o município.");
      set({ codigoMunicipio: d.codigoMunicipio });
      toast.success(`Código IBGE de ${d.municipio}: ${d.codigoMunicipio}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar o município.");
    } finally {
      setBuscando(null);
    }
  }

  function salvar() {
    start(async () => {
      try {
        await salvarEmitenteAction(form);
        toast.success("Dados fiscais da loja salvos.");
        set({ csc: "" });
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <Bloco
      icon={<Building2 size={18} />}
      title="Emitente desta loja"
      description="É o que sai impresso na nota. Precisa bater exatamente com o cadastro na SEFAZ."
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="CNPJ" htmlFor="e-cnpj" className="sm:col-span-3">
          <div className="flex gap-2">
            <Input
              id="e-cnpj"
              value={form.cnpj}
              onChange={(e) => set({ cnpj: maskCnpj(e.target.value) })}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              className="font-mono"
            />
            <Button variant="outline" onClick={buscarCnpj} disabled={buscando === "cnpj"}>
              <Search size={16} /> {buscando === "cnpj" ? "Buscando…" : "Buscar"}
            </Button>
          </div>
        </Field>

        <Field label="Regime tributário" htmlFor="e-regime" className="sm:col-span-3">
          <Select
            id="e-regime"
            value={form.regime}
            onChange={(e) => set({ regime: e.target.value as Regime })}
          >
            {REGIMES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Razão social" htmlFor="e-razao" className="sm:col-span-3">
          <Input
            id="e-razao"
            value={form.razaoSocial}
            onChange={(e) => set({ razaoSocial: e.target.value })}
          />
        </Field>

        <Field label="Nome fantasia" htmlFor="e-fantasia" className="sm:col-span-3">
          <Input
            id="e-fantasia"
            value={form.nomeFantasia}
            onChange={(e) => set({ nomeFantasia: e.target.value })}
          />
        </Field>

        <Field
          label="Inscrição estadual"
          htmlFor="e-ie"
          hint="Sem IE, escreva ISENTO."
          className="sm:col-span-2"
        >
          <Input
            id="e-ie"
            value={form.ie}
            onChange={(e) => set({ ie: e.target.value })}
            className="font-mono"
          />
        </Field>

        <Field label="Inscrição municipal" htmlFor="e-im" className="sm:col-span-2">
          <Input
            id="e-im"
            value={form.im}
            onChange={(e) => set({ im: e.target.value })}
            className="font-mono"
          />
        </Field>

        <Field label="CNAE principal" htmlFor="e-cnae" className="sm:col-span-2">
          <Input
            id="e-cnae"
            value={form.cnae}
            onChange={(e) => set({ cnae: e.target.value })}
            placeholder="4711302"
            className="font-mono"
          />
        </Field>

        <Field label="CEP" htmlFor="e-cep" className="sm:col-span-2">
          <div className="flex gap-2">
            <Input
              id="e-cep"
              value={form.cep}
              onChange={(e) => set({ cep: maskCep(e.target.value) })}
              placeholder="00000-000"
              inputMode="numeric"
              className="font-mono"
            />
            <Button variant="outline" onClick={buscarCep} disabled={buscando === "cep"}>
              <Search size={16} />
            </Button>
          </div>
        </Field>

        <Field label="Logradouro" htmlFor="e-log" className="sm:col-span-3">
          <Input
            id="e-log"
            value={form.logradouro}
            onChange={(e) => set({ logradouro: e.target.value })}
          />
        </Field>

        <Field label="Número" htmlFor="e-num" className="sm:col-span-1">
          <Input id="e-num" value={form.numero} onChange={(e) => set({ numero: e.target.value })} />
        </Field>

        <Field label="Complemento" htmlFor="e-comp" className="sm:col-span-2">
          <Input
            id="e-comp"
            value={form.complemento}
            onChange={(e) => set({ complemento: e.target.value })}
          />
        </Field>

        <Field label="Bairro" htmlFor="e-bairro" className="sm:col-span-2">
          <Input id="e-bairro" value={form.bairro} onChange={(e) => set({ bairro: e.target.value })} />
        </Field>

        <Field label="Município" htmlFor="e-mun" className="sm:col-span-2">
          <Input
            id="e-mun"
            value={form.municipio}
            onChange={(e) => set({ municipio: e.target.value })}
          />
        </Field>

        <Field label="UF" htmlFor="e-uf" className="sm:col-span-1">
          <Input
            id="e-uf"
            value={form.uf}
            onChange={(e) => set({ uf: e.target.value.toUpperCase().slice(0, 2) })}
            maxLength={2}
          />
        </Field>

        <Field
          label="Código IBGE do município"
          htmlFor="e-ibge"
          hint="A nota exige o código, não o nome."
          className="sm:col-span-3"
        >
          <div className="flex gap-2">
            <Input
              id="e-ibge"
              value={form.codigoMunicipio}
              onChange={(e) => set({ codigoMunicipio: e.target.value.replace(/\D/g, "").slice(0, 7) })}
              placeholder="4314902"
              inputMode="numeric"
              className="font-mono"
            />
            <Button variant="outline" onClick={buscarCodigoMunicipio} disabled={buscando === "ibge"}>
              <Search size={16} /> {buscando === "ibge" ? "Buscando…" : "Buscar"}
            </Button>
          </div>
        </Field>

        <Field label="Telefone" htmlFor="e-tel" className="sm:col-span-2">
          <Input
            id="e-tel"
            value={form.telefone}
            onChange={(e) => set({ telefone: maskPhone(e.target.value) })}
            inputMode="tel"
          />
        </Field>

        <Field
          label="Natureza da operação padrão"
          htmlFor="e-nat"
          className="sm:col-span-4"
        >
          <Input
            id="e-nat"
            value={form.naturezaOperacaoPadrao}
            onChange={(e) => set({ naturezaOperacaoPadrao: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink">NFC-e — CSC</p>
        <p className="mt-0.5 mb-4 text-sm text-muted">
          Código de segurança emitido no portal da SEFAZ da sua UF. Sem ele o QR Code do cupom
          não fecha.
        </p>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Identificador do CSC" htmlFor="e-cscid" className="sm:col-span-2">
            <Input
              id="e-cscid"
              value={form.cscId}
              onChange={(e) => set({ cscId: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              placeholder="000001"
              inputMode="numeric"
              className="font-mono"
            />
          </Field>
          <Field
            label="CSC"
            htmlFor="e-csc"
            hint={emitente.temCsc ? "Já salvo. Preencha só para substituir." : undefined}
            className="sm:col-span-4"
          >
            <Input
              id="e-csc"
              type="password"
              value={form.csc}
              onChange={(e) => set({ csc: e.target.value })}
              placeholder={emitente.temCsc ? "••••••••" : "Cole o código"}
              autoComplete="off"
            />
          </Field>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar emitente"}
        </Button>
      </div>
    </Bloco>
  );
}

// ── Certificado ─────────────────────────────────────────────

function CertificadoBloco({
  siteId,
  emitente,
  onSaved,
}: {
  siteId: string;
  emitente: EmitenteView | null;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [senha, setSenha] = useState("");
  const [arquivo, setArquivo] = useState<{ nome: string; base64: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const validade = emitente?.certificadoValidade ?? null;
  const dias = useMemo(() => (validade ? diasAte(validade) : null), [validade]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("Arquivo grande demais para um certificado A1. Confira se é o .pfx correto.");
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    setArquivo({ nome: file.name, base64: btoa(bin) });
  }

  function enviar() {
    if (!arquivo) return toast.error("Escolha o arquivo .pfx do certificado.");
    if (!senha) return toast.error("Informe a senha do certificado.");
    start(async () => {
      try {
        const r = await enviarCertificadoAction({
          siteId,
          arquivoBase64: arquivo.base64,
          senha,
        });
        toast.success(`Certificado de ${r.titular} enviado.`);
        setArquivo(null);
        setSenha("");
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao enviar o certificado.");
      }
    });
  }

  return (
    <Bloco
      icon={<FileSignature size={18} />}
      title="Certificado digital A1"
      description="O arquivo vai direto para o provedor, que assina as notas. Nem o .pfx nem a senha ficam guardados aqui."
    >
      {!emitente ? (
        <p className="text-sm text-muted">Salve os dados do emitente antes de enviar o certificado.</p>
      ) : (
        <>
          {emitente.certificadoTitular && dias !== null && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface-2 p-3">
              <span className="text-sm text-ink-2">{emitente.certificadoTitular}</span>
              <Badge tone={dias < 0 ? "danger" : dias <= 30 ? "warn" : "ok"}>
                {dias < 0
                  ? `Vencido há ${Math.abs(dias)} dia(s)`
                  : dias === 0
                    ? "Vence hoje"
                    : `Vence em ${dias} dia(s)`}
              </Badge>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Arquivo (.pfx ou .p12)" htmlFor="cert">
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  id="cert"
                  type="file"
                  accept=".pfx,.p12,application/x-pkcs12"
                  className="hidden"
                  onChange={onFile}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} /> {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
                </Button>
                {arquivo && <span className="truncate text-sm text-muted">{arquivo.nome}</span>}
              </div>
            </Field>

            <Field label="Senha do certificado" htmlFor="cert-senha">
              <Input
                id="cert-senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={enviar} disabled={pending}>
              {pending ? "Enviando…" : "Enviar certificado"}
            </Button>
          </div>
        </>
      )}
    </Bloco>
  );
}

// ── Séries ──────────────────────────────────────────────────

function SeriesBloco({
  siteId,
  series,
  onSaved,
}: {
  siteId: string;
  series: SerieView[];
  onSaved: () => void;
}) {
  return (
    <Bloco
      icon={<Hash size={18} />}
      title="Numeração"
      description="Série e próximo número de cada modelo. Se você já emitia em outro sistema, comece do número seguinte ao último usado."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SerieForm
          siteId={siteId}
          modelo="NFCE"
          titulo="NFC-e (modelo 65)"
          atual={series.find((s) => s.modelo === "NFCE") ?? null}
          onSaved={onSaved}
        />
        <SerieForm
          siteId={siteId}
          modelo="NFE"
          titulo="NF-e (modelo 55)"
          atual={series.find((s) => s.modelo === "NFE") ?? null}
          onSaved={onSaved}
        />
      </div>
    </Bloco>
  );
}

function SerieForm({
  siteId,
  modelo,
  titulo,
  atual,
  onSaved,
}: {
  siteId: string;
  modelo: Modelo;
  titulo: string;
  atual: SerieView | null;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [serie, setSerie] = useState(String(atual?.serie ?? 1));
  const [numero, setNumero] = useState(String(atual?.proximoNumero ?? 1));

  function salvar() {
    start(async () => {
      try {
        await salvarSerieAction({
          siteId,
          modelo,
          serie,
          proximoNumero: numero,
          ativa: atual?.ativa ?? true,
        });
        toast.success(`Numeração de ${titulo} salva.`);
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar a numeração.");
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-line p-4">
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Série" htmlFor={`serie-${modelo}`}>
          <Input
            id={`serie-${modelo}`}
            value={serie}
            onChange={(e) => setSerie(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
        <Field label="Próximo número" htmlFor={`num-${modelo}`}>
          <Input
            id={`num-${modelo}`}
            value={numero}
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, "").slice(0, 9))}
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
