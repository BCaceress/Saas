"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Trash2,
  Image as ImageIcon,
  MapPin,
  Loader2,
  Check,
  Boxes,
  Building2,
  Landmark,
  Link2,
  StickyNote,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { maskCep, maskCnpj, maskPhone } from "@/lib/masks";
import { resizeLogo } from "@/lib/imagem";
import { ContatosFornecedor } from "./_contatos";
import { setSupplierActive, updateSupplier } from "../../produtos/actions";
import { salvarObservacoesAction } from "../actions";
import type { FornecedorCadastro } from "./_data";
import type { IndicadorIE } from "@/generated/prisma";

// Aba Resumo — TODA a edição do fornecedor acontece aqui. Não há mais modal:
// o cadastro é a página, e o rodapé só acorda quando algo muda.
//
// Ordem dos cards: Dados gerais (identidade + como falar + o que está
// negociado) → Endereço → Contatos → Dados fiscais → Observações. É a ordem em
// que o operador precisa das coisas, da mais usada para a mais rara.

const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

type Form = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  logoUrl: string;
  email: string;
  telefone: string;
  contato: string;
  website: string;
  pedidoMinimo: string;
  prazoPagamento: string;
  observacoes: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  ie: string;
  indicadorIE: "" | IndicadorIE;
  codigoMunicipio: string;
};

function formDe(f: FornecedorCadastro): Form {
  return {
    cnpj: f.cnpj ? maskCnpj(f.cnpj) : "",
    razaoSocial: f.razaoSocial,
    nomeFantasia: f.nomeFantasia ?? "",
    logoUrl: f.logoUrl ?? "",
    email: f.email ?? "",
    telefone: f.telefone ? maskPhone(f.telefone) : "",
    contato: f.nomeContatoPrincipal ?? "",
    website: f.website ?? "",
    pedidoMinimo: f.pedidoMinimo != null ? moneyToMask(f.pedidoMinimo) : "",
    prazoPagamento:
      f.prazoPagamentoDias != null ? String(f.prazoPagamentoDias) : "",
    observacoes: f.observacoes ?? "",
    cep: f.cep ? maskCep(f.cep) : "",
    logradouro: f.logradouro ?? "",
    numero: f.numero ?? "",
    complemento: f.complemento ?? "",
    bairro: f.bairro ?? "",
    municipio: f.municipio ?? "",
    uf: f.uf ?? "",
    ie: f.ie ?? "",
    indicadorIE: f.indicadorIE ?? "",
    codigoMunicipio: f.codigoMunicipio ?? "",
  };
}

function Secao({
  icon,
  titulo,
  descricao,
  acaoTitulo,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao?: string;
  /** Encostado à direita do título — estado do card, não campo do formulário. */
  acaoTitulo?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-brand-soft text-brand">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-ink">{titulo}</h2>
          {descricao && <p className="text-[11px] text-muted">{descricao}</p>}
        </div>
        {acaoTitulo && <div className="shrink-0">{acaoTitulo}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ResumoFornecedor({
  fornecedor,
  podeEditar,
}: {
  fornecedor: FornecedorCadastro;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const inicial = useMemo(() => formDe(fornecedor), [fornecedor]);
  const [form, setForm] = useState<Form>(inicial);
  const [pending, start] = useTransition();
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [buscandoIbge, setBuscandoIbge] = useState(false);
  const [alterandoSituacao, setAlterandoSituacao] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const sujo = useMemo(
    () =>
      (Object.keys(inicial) as Array<keyof Form>).some(
        (k) => form[k] !== inicial[k],
      ),
    [form, inicial],
  );

  const somenteLeitura = !podeEditar;

  function upd<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /**
   * Situação salva NA HORA, fora do rodapé: ativar/inativar é decisão de uma
   * chave só, e deixá-la presa a "Salvar fornecedor" faria o operador achar
   * que já valeu quando ainda não valeu.
   */
  function alternarSituacao(ativo: boolean) {
    setAlterandoSituacao(true);
    start(async () => {
      try {
        await setSupplierActive(fornecedor.id, ativo);
        toast.success(
          ativo ? "Fornecedor reativado" : "Fornecedor inativado",
          ativo
            ? "Ele volta a aparecer nas sugestões de compra."
            : "Ele sai das sugestões de compra e do comparador.",
        );
        router.refresh();
      } catch (e) {
        toast.error(
          "Não deu para mudar a situação",
          e instanceof Error ? e.message : undefined,
        );
      } finally {
        setAlterandoSituacao(false);
      }
    });
  }

  async function enviarLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite reenviar o mesmo arquivo
    if (!arquivo) return;
    try {
      // Redimensionada no navegador: a logo cabe na própria coluna do banco,
      // sem storage externo.
      upd("logoUrl", await resizeLogo(arquivo));
      toast.success("Logo carregada", "Salve o fornecedor para aplicar.");
    } catch {
      toast.error("Não foi possível ler a imagem", "Tente um PNG ou JPG.");
    }
  }

  async function buscarCnpj() {
    const digitos = form.cnpj.replace(/\D/g, "");
    if (digitos.length !== 14) {
      toast.error(
        "CNPJ incompleto",
        "Informe os 14 dígitos para consultar a Receita.",
      );
      return;
    }
    setBuscandoCnpj(true);
    try {
      const res = await fetch(`/api/fornecedores/cnpj/${digitos}`);
      const d = await res.json();
      if (res.ok) {
        setForm((f) => ({
          ...f,
          razaoSocial: d.razaoSocial || f.razaoSocial,
          nomeFantasia: d.nomeFantasia || f.nomeFantasia,
          email: d.email || f.email,
          telefone: d.telefone ? maskPhone(d.telefone) : f.telefone,
          cep: d.cep ? maskCep(d.cep) : f.cep,
          logradouro: d.logradouro || f.logradouro,
          numero: d.numero || f.numero,
          complemento: d.complemento || f.complemento,
          bairro: d.bairro || f.bairro,
          municipio: d.municipio || f.municipio,
          uf: d.uf || f.uf,
        }));
        toast.success(
          "Dados da Receita carregados",
          "Confira e salve para gravar.",
        );
      } else if (res.status === 404) {
        toast.error("CNPJ não encontrado na Receita", "Preencha manualmente.");
      } else {
        toast.error(
          "Consulta indisponível",
          d.error ?? "Tente de novo em instantes.",
        );
      }
    } catch {
      toast.error(
        "Falha ao consultar o CNPJ",
        "Verifique a conexão e tente de novo.",
      );
    } finally {
      setBuscandoCnpj(false);
    }
  }

  /**
   * Código IBGE do município — a NF-e exige os 7 dígitos, não o nome. Roda
   * sozinho depois do CEP e também sob demanda, para quem digitou o endereço
   * à mão. `silencioso` = não reclama quando é o efeito colateral do CEP.
   */
  async function buscarIbge(uf: string, municipio: string, silencioso = false) {
    if (uf.length !== 2 || !municipio.trim()) {
      if (!silencioso)
        toast.error(
          "Faltam dados",
          "Preencha município e UF antes de buscar o código.",
        );
      return;
    }
    setBuscandoIbge(true);
    try {
      const res = await fetch(
        `/api/ibge/municipio?uf=${uf}&municipio=${encodeURIComponent(municipio)}`,
      );
      const d = await res.json();
      if (res.ok && d.codigoMunicipio) {
        setForm((f) => ({ ...f, codigoMunicipio: d.codigoMunicipio }));
        if (!silencioso)
          toast.success("Código IBGE encontrado", d.codigoMunicipio);
      } else if (!silencioso) {
        toast.error(
          "Município não encontrado",
          d.error ?? "Confira o nome e a UF.",
        );
      }
    } catch {
      if (!silencioso)
        toast.error("Falha ao buscar o código IBGE", "Verifique a conexão.");
    } finally {
      setBuscandoIbge(false);
    }
  }

  async function buscarCep() {
    const digitos = form.cep.replace(/\D/g, "");
    if (digitos.length !== 8) {
      toast.error("CEP incompleto", "Informe os 8 dígitos.");
      return;
    }
    setBuscandoCep(true);
    try {
      const res = await fetch(`/api/cep/${digitos}`);
      const d = await res.json();
      if (!res.ok) {
        toast.error(
          "CEP não encontrado",
          d.error ?? "Preencha o endereço manualmente.",
        );
        return;
      }
      setForm((f) => ({
        ...f,
        cep: maskCep(digitos),
        logradouro: d.rua || f.logradouro,
        bairro: d.bairro || f.bairro,
        municipio: d.cidade || f.municipio,
        uf: d.estado || f.uf,
      }));
      toast.success("Endereço carregado", "Confira o número e o complemento.");
      // Município e UF acabaram de chegar: já resolve o código fiscal.
      if (d.estado && d.cidade) void buscarIbge(d.estado, d.cidade, true);
    } catch {
      toast.error(
        "Falha ao consultar o CEP",
        "Verifique a conexão e tente de novo.",
      );
    } finally {
      setBuscandoCep(false);
    }
  }

  function salvar() {
    start(async () => {
      try {
        await updateSupplier(fornecedor.id, {
          cnpj: form.cnpj,
          razaoSocial: form.razaoSocial,
          nomeFantasia: form.nomeFantasia,
          logoUrl: form.logoUrl,
          email: form.email,
          telefone: form.telefone,
          nomeContatoPrincipal: form.contato,
          website: form.website,
          pedidoMinimo: parseMoney(form.pedidoMinimo),
          cep: form.cep,
          logradouro: form.logradouro,
          numero: form.numero,
          complemento: form.complemento,
          bairro: form.bairro,
          municipio: form.municipio,
          uf: form.uf,
          ie: form.ie,
          indicadorIE: form.indicadorIE || null,
          codigoMunicipio: form.codigoMunicipio,
        });
        // Prazo e anotações vivem fora do schema de cadastro — mesma ação de
        // antes, para não haver duas verdades.
        await salvarObservacoesAction({
          supplierId: fornecedor.id,
          observacoes: form.observacoes,
          prazoPagamentoDias: form.prazoPagamento
            ? Number(form.prazoPagamento)
            : null,
        });
        toast.success(
          "Fornecedor salvo",
          form.nomeFantasia || form.razaoSocial,
        );
        router.refresh();
      } catch (e) {
        toast.error(
          "Não deu para salvar",
          e instanceof Error ? e.message : undefined,
        );
      }
    });
  }

  const enderecoUrl = (() => {
    const partes = [
      form.logradouro && form.numero
        ? `${form.logradouro}, ${form.numero}`
        : form.logradouro,
      form.bairro,
      form.municipio,
      form.uf,
      form.cep,
    ].filter(Boolean);
    return partes.length > 0
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes.join(", "))}`
      : null;
  })();

  return (
    <div className="flex flex-col gap-4 pb-2">
      <fieldset disabled={somenteLeitura} className="flex flex-col gap-4">
        <Secao
          icon={<Building2 size={14} />}
          titulo="Dados gerais"
          descricao="Quem é este parceiro e como falar com ele."
          acaoTitulo={
            <label className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[12px] font-medium",
                  fornecedor.ativo ? "text-ok" : "text-faint",
                )}
              >
                {fornecedor.ativo ? "Ativo" : "Inativo"}
              </span>
              <Switch
                checked={fornecedor.ativo}
                busy={alterandoSituacao}
                disabled={somenteLeitura}
                onCheckedChange={alternarSituacao}
                // Verde = "está comprando dele". Marca de saúde, não de marca.
                className={fornecedor.ativo ? "bg-ok" : undefined}
                aria-label={
                  fornecedor.ativo ? "Inativar fornecedor" : "Reativar fornecedor"
                }
              />
            </label>
          }
        >
          <div className="grid grid-cols-24 gap-x-3 gap-y-3">
            {/* CNPJ, razão social e fantasia na MESMA linha: é como o
                documento chega ao operador, e é a leitura que identifica o
                fornecedor sem rolar a tela. */}
            <Field
              className="col-span-24 sm:col-span-6"
              label="CNPJ"
              htmlFor="f-cnpj"
            >
              <div className="flex gap-1.5">
                <Input
                  id="f-cnpj"
                  value={form.cnpj}
                  onChange={(e) => upd("cnpj", maskCnpj(e.target.value))}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  maxLength={18}
                  className="font-mono"
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.preventDefault(), buscarCnpj())
                  }
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={buscarCnpj}
                  disabled={buscandoCnpj || somenteLeitura}
                  className="h-10 w-10 shrink-0 rounded-full p-0"
                  title="Consultar na Receita"
                  aria-label="Consultar CNPJ na Receita"
                >
                  {buscandoCnpj ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Search size={15} />
                  )}
                </Button>
              </div>
            </Field>
            <Field
              className="col-span-24 sm:col-span-10"
              label="Razão social"
              htmlFor="f-razao"
              required
            >
              <Input
                id="f-razao"
                value={form.razaoSocial}
                onChange={(e) => upd("razaoSocial", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-24 sm:col-span-8"
              label="Nome fantasia"
              htmlFor="f-fant"
            >
              <Input
                id="f-fant"
                value={form.nomeFantasia}
                onChange={(e) => upd("nomeFantasia", e.target.value)}
              />
            </Field>

            {/* Como falar com a empresa e o que já está negociado: uma linha
                só. Pedido mínimo e prazo são números curtos e ocupam menos. */}
            <Field
              className="col-span-24 sm:col-span-4"
              label="Telefone da empresa"
              htmlFor="f-tel"
            >
              <Input
                id="f-tel"
                value={form.telefone}
                onChange={(e) => upd("telefone", maskPhone(e.target.value))}
                inputMode="numeric"
                maxLength={15}
                placeholder="(11) 99999-9999"
              />
            </Field>
            <Field
              className="col-span-24 sm:col-span-6"
              label="E-mail da empresa"
              htmlFor="f-mail"
            >
              <Input
                id="f-mail"
                type="email"
                value={form.email}
                onChange={(e) => upd("email", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-24 sm:col-span-8"
              label="Website"
              htmlFor="f-site"
            >
              <Input
                id="f-site"
                value={form.website}
                onChange={(e) => upd("website", e.target.value)}
                placeholder="https://"
              />
            </Field>

            <Field
              className="col-span-12 sm:col-span-3"
              label="Pedido mín. (R$)"
              htmlFor="f-min"
            >
              <Input
                id="f-min"
                value={form.pedidoMinimo}
                onChange={(e) => upd("pedidoMinimo", maskMoney(e.target.value))}
                inputMode="numeric"
                placeholder="Sem mínimo"
              />
            </Field>
            <Field
              className="col-span-12 sm:col-span-3"
              label="Prazo (dias)"
              htmlFor="f-prazo"
            >
              <Input
                id="f-prazo"
                value={form.prazoPagamento}
                onChange={(e) =>
                  upd(
                    "prazoPagamento",
                    e.target.value.replace(/\D/g, "").slice(0, 3),
                  )
                }
                inputMode="numeric"
                placeholder="30"
                className="font-mono"
              />
            </Field>
            {fornecedor.produtosVinculados > 0 && (
              <div className="col-span-24 flex items-end">
                <Link
                  href={`/produtos?fornecedorId=${fornecedor.id}&fornecedorNome=${encodeURIComponent(
                    fornecedor.nomeFantasia || fornecedor.razaoSocial,
                  )}`}
                  className="flex items-center gap-1 text-[12px] text-muted hover:text-brand hover:underline"
                >
                  <Boxes size={12} /> {fornecedor.produtosVinculados} produtos
                  vinculados
                </Link>
              </div>
            )}
          </div>

          {/* A logo fecha o card: identifica, mas não é o que se lê primeiro
              — nome e telefone vêm antes. Cola o link ou envia o arquivo. */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {form.logoUrl ? (
              // Logo é URL de terceiro ou data URL colada pelo operador — host
              // arbitrário não passa pelo next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logoUrl}
                alt="Logo do fornecedor"
                className="h-14 w-14 shrink-0 rounded-[var(--radius)] border border-line bg-surface-2 object-contain p-1"
              />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius)] border border-dashed border-line bg-surface-2 text-faint">
                <ImageIcon size={20} />
              </span>
            )}

            <div className="flex min-w-52 flex-1 items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-line bg-surface-2 text-faint">
                <Link2 size={14} />
              </span>
              <Input
                type="url"
                value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl}
                onChange={(e) => upd("logoUrl", e.target.value)}
                placeholder={
                  form.logoUrl.startsWith("data:")
                    ? "Imagem enviada do computador"
                    : "https://exemplo.com/logo.png"
                }
                aria-label="Link da logo do fornecedor"
                className="flex-1"
              />
            </div>

            <input
              ref={arquivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={enviarLogo}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => arquivoRef.current?.click()}
            >
              <Upload size={15} />
              Enviar imagem
            </Button>
            {form.logoUrl && (
              <Button
                type="button"
                variant="ghost"
                className="shrink-0"
                onClick={() => upd("logoUrl", "")}
                aria-label="Remover logo"
              >
                <Trash2 size={15} />
              </Button>
            )}
          </div>
        </Secao>

        <Secao
          icon={<MapPin size={14} />}
          titulo="Endereço"
          descricao={
            enderecoUrl
              ? "Confira no mapa antes de agendar retirada."
              : "Onde a mercadoria sai."
          }
        >
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field
              className="col-span-12 sm:col-span-4"
              label="CEP"
              htmlFor="f-cep"
            >
              <div className="flex gap-1.5">
                <Input
                  id="f-cep"
                  value={form.cep}
                  onChange={(e) => upd("cep", maskCep(e.target.value))}
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="00000-000"
                  className="font-mono"
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.preventDefault(), buscarCep())
                  }
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={buscarCep}
                  disabled={buscandoCep || somenteLeitura}
                  className="h-10 w-10 shrink-0 rounded-full p-0"
                  title="Buscar endereço pelo CEP"
                  aria-label="Buscar endereço pelo CEP"
                >
                  {buscandoCep ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Search size={15} />
                  )}
                </Button>
              </div>
            </Field>
            <Field
              className="col-span-12 sm:col-span-6"
              label="Logradouro"
              htmlFor="f-log"
            >
              <Input
                id="f-log"
                value={form.logradouro}
                onChange={(e) => upd("logradouro", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-6 sm:col-span-2"
              label="Número"
              htmlFor="f-num"
            >
              <Input
                id="f-num"
                value={form.numero}
                onChange={(e) => upd("numero", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-12 sm:col-span-4"
              label="Complemento"
              htmlFor="f-comp"
            >
              <Input
                id="f-comp"
                value={form.complemento}
                onChange={(e) => upd("complemento", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-12 sm:col-span-3"
              label="Bairro"
              htmlFor="f-bairro"
            >
              <Input
                id="f-bairro"
                value={form.bairro}
                onChange={(e) => upd("bairro", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-8 sm:col-span-3"
              label="Município"
              htmlFor="f-mun"
            >
              <Input
                id="f-mun"
                value={form.municipio}
                onChange={(e) => upd("municipio", e.target.value)}
              />
            </Field>
            <Field
              className="col-span-4 sm:col-span-2"
              label="UF"
              htmlFor="f-uf"
            >
              <Select
                id="f-uf"
                value={form.uf}
                onChange={(e) => upd("uf", e.target.value)}
              >
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {enderecoUrl && (
            <a
              href={enderecoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-brand hover:underline"
            >
              <MapPin size={12} /> Ver no Google Maps
            </a>
          )}
        </Secao>

        {/* Cada contato é salvo na hora, por ação própria — não entra no
            "Salvar fornecedor" do rodapé nem no controle de sujo do formulário. */}
        <ContatosFornecedor
          supplierId={fornecedor.id}
          contatos={fornecedor.contatos}
          podeEditar={podeEditar}
        />

        <Secao
          icon={<Landmark size={14} />}
          titulo="Dados fiscais"
          descricao="Usados na entrada por XML e na devolução ao fornecedor."
        >
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            <Field
              className="col-span-12 sm:col-span-4"
              label="Inscrição estadual"
              htmlFor="f-ie"
            >
              <Input
                id="f-ie"
                value={form.ie}
                onChange={(e) => upd("ie", e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field
              className="col-span-12 sm:col-span-4"
              label="Indicador de IE"
              htmlFor="f-indie"
            >
              <Select
                id="f-indie"
                value={form.indicadorIE}
                onChange={(e) =>
                  upd("indicadorIE", e.target.value as Form["indicadorIE"])
                }
              >
                <option value="">—</option>
                <option value="CONTRIBUINTE">Contribuinte</option>
                <option value="ISENTO">Isento</option>
                <option value="NAO_CONTRIBUINTE">Não contribuinte</option>
              </Select>
            </Field>
            <Field
              className="col-span-12 sm:col-span-4"
              label="Código IBGE do município"
              htmlFor="f-ibge"
              hint="7 dígitos — busca por município + UF."
            >
              <div className="flex gap-1.5">
                <Input
                  id="f-ibge"
                  value={form.codigoMunicipio}
                  onChange={(e) =>
                    upd(
                      "codigoMunicipio",
                      e.target.value.replace(/\D/g, "").slice(0, 7),
                    )
                  }
                  inputMode="numeric"
                  className="font-mono"
                  placeholder="4314902"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => buscarIbge(form.uf, form.municipio)}
                  disabled={buscandoIbge || somenteLeitura}
                  className="h-10 w-10 shrink-0 rounded-full p-0"
                  title="Buscar código IBGE"
                  aria-label="Buscar código IBGE do município"
                >
                  {buscandoIbge ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Search size={15} />
                  )}
                </Button>
              </div>
            </Field>
          </div>
        </Secao>

        <Secao
          icon={<StickyNote size={14} />}
          titulo="Observações"
          descricao="O combinado que não cabe em campo."
        >
          <Textarea
            value={form.observacoes}
            onChange={(e) => upd("observacoes", e.target.value)}
            rows={4}
            placeholder="Entrega apenas às quartas-feiras. Aceita negociação acima de R$ 5.000."
            aria-label="Observações internas sobre o fornecedor"
          />
        </Secao>
      </fieldset>

      {podeEditar && (
        <div
          className={cn(
            "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border px-4 py-3 transition-colors",
            sujo
              ? "border-brand bg-surface shadow-[var(--shadow-float)]"
              : "border-line bg-surface-2/70",
          )}
        >
          <p className="text-[12px] text-muted">
            {sujo ? "Há alterações não salvas." : "Tudo salvo."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setForm(inicial)}
              disabled={!sujo || pending}
            >
              Descartar
            </Button>
            <Button onClick={salvar} disabled={!sujo || pending}>
              {pending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              Salvar fornecedor
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
