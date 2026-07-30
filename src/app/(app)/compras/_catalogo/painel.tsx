"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Settings2,
  ArrowRight,
  Store,
  PackageSearch,
  Tag,
  PiggyBank,
  CalendarCheck,
  Loader2,
  AlertTriangle,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { SupplierIntegrationKind } from "@/generated/prisma";
import type { FornecedorCard, ResumoDashboard } from "./types";
import {
  EstadoVazio,
  IntegracaoStatus,
  KIND_LABEL,
  Metrica,
  MetricaGrid,
  SupplierAvatar,
  fmtMoney,
  fmtQuando,
} from "./ui";
import { salvarIntegracaoAction, sincronizarFornecedorAction } from "./actions";

const KINDS: SupplierIntegrationKind[] = [
  "API",
  "PLANILHA",
  "CSV",
  "PDF",
  "IMAGEM",
  "XML",
  "JSON",
  "MANUAL",
];

export function PainelFornecedores({
  resumo,
  fornecedores,
  podeEditar,
}: {
  resumo: ResumoDashboard;
  fornecedores: FornecedorCard[];
  podeEditar: boolean;
}) {
  const [config, setConfig] = useState<FornecedorCard | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <MetricaGrid>
        <Metrica
          label="Fornecedores"
          valor={String(resumo.fornecedoresAtivos)}
          sub={`${resumo.fornecedoresComCatalogo} com tabela`}
          icon={<Store size={12} />}
        />
        <Metrica
          label="Produtos importados"
          valor={resumo.produtosImportados.toLocaleString("pt-BR")}
          sub={`${resumo.produtosComparaveis} comparáveis`}
          icon={<PackageSearch size={12} />}
        />
        <Metrica
          label="Economia encontrada"
          valor={fmtMoney(resumo.economiaPotencial)}
          sub="mais barato × mais caro"
          tom="accent"
          icon={<PiggyBank size={12} />}
        />
        <Metrica
          label="Em promoção"
          valor={resumo.produtosEmPromocao.toLocaleString("pt-BR")}
          sub="ofertas vigentes"
          tom="accent"
          icon={<Tag size={12} />}
        />
        <Metrica
          label="Atualizados hoje"
          valor={String(resumo.catalogosHoje)}
          sub="catálogos"
          icon={<CalendarCheck size={12} />}
        />
        <Metrica
          label="Última sincronização"
          valor={fmtQuando(resumo.ultimaSincronizacao)}
          sub={resumo.itensPendentes > 0 ? `${resumo.itensPendentes} itens a revisar` : "tudo vinculado"}
          tom={resumo.itensPendentes > 0 ? "accent" : "ok"}
          icon={<RefreshCw size={12} />}
        />
      </MetricaGrid>

      {fornecedores.length === 0 ? (
        <EstadoVazio
          icon={<Store size={20} />}
          titulo="Nenhum fornecedor cadastrado"
          descricao="Cadastre os fornecedores em Fornecedores e volte aqui para receber as tabelas de preço deles."
          acao={
            <Link href="/fornecedores">
              <Button size="sm" variant="secondary">
                Abrir fornecedores
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fornecedores.map((f) => (
            <CardFornecedor
              key={f.id}
              fornecedor={f}
              podeEditar={podeEditar}
              onConfigurar={() => setConfig(f)}
            />
          ))}
        </div>
      )}

      {config && (
        <SheetIntegracao
          fornecedor={config}
          onClose={() => setConfig(null)}
        />
      )}
    </div>
  );
}

function CardFornecedor({
  fornecedor: f,
  podeEditar,
  onConfigurar,
}: {
  fornecedor: FornecedorCard;
  podeEditar: boolean;
  onConfigurar: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function sincronizar() {
    startTransition(async () => {
      try {
        const r = await sincronizarFornecedorAction(f.id);
        toast.success(
          `${f.nome} sincronizado`,
          `${r.itensNovos} novos, ${r.itensAtualizados} atualizados.`,
        );
        router.refresh();
      } catch (e) {
        toast.error("Não deu para sincronizar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-[var(--shadow-float)] card-hover">
      <div className="flex items-start gap-3">
        <SupplierAvatar nome={f.nome} logoUrl={f.logoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[15px] font-semibold text-ink">{f.nome}</h3>
          <div className="mt-0.5">
            <IntegracaoStatus status={f.situacaoIntegracao} kind={f.tipoIntegracao} />
          </div>
        </div>
        {f.pendentes > 0 && (
          <Badge tone="warn" className="shrink-0">
            {f.pendentes} a revisar
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 divide-x divide-line rounded-[var(--radius)] bg-surface-2/60 py-2 text-center">
        <div>
          <p className="font-mono text-[15px] font-semibold text-ink">
            {f.totalProdutos.toLocaleString("pt-BR")}
          </p>
          <p className="text-[11px] text-faint">produtos</p>
        </div>
        <div>
          <p className={cn("font-mono text-[15px] font-semibold", f.emPromocao > 0 ? "text-accent" : "text-ink")}>
            {f.emPromocao.toLocaleString("pt-BR")}
          </p>
          <p className="text-[11px] text-faint">em promoção</p>
        </div>
        <div>
          <p className="truncate px-1 text-[12px] font-medium text-ink">
            {fmtQuando(f.ultimaSincronizacao)}
          </p>
          <p className="text-[11px] text-faint">atualizado</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href={`/compras/catalogos/${f.id}`} className="flex-1">
          <Button size="sm" variant="secondary" className="w-full">
            Ver catálogo
            <ArrowRight size={14} />
          </Button>
        </Link>

        {podeEditar && f.tipoIntegracao === "API" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={sincronizar}
            disabled={pending}
            title="Puxar a tabela agora"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sincronizar
          </Button>
        )}

        {podeEditar && (
          <Button size="icon" variant="ghost" onClick={onConfigurar} title="Configurar integração">
            <Settings2 size={15} />
          </Button>
        )}
      </div>
    </article>
  );
}

// ── Configuração da integração ──────────────────────────────

function SheetIntegracao({
  fornecedor,
  onClose,
}: {
  fornecedor: FornecedorCard;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [possui, setPossui] = useState(fornecedor.possuiIntegracao);
  const [kind, setKind] = useState<SupplierIntegrationKind>(fornecedor.tipoIntegracao ?? "PLANILHA");
  const [manual, setManual] = useState(fornecedor.aceitaImportacaoManual);
  const [automatica, setAutomatica] = useState(fornecedor.aceitaImportacaoAutomatica);
  const [endpoint, setEndpoint] = useState("");
  const [authTipo, setAuthTipo] = useState("bearer");
  const [credencial, setCredencial] = useState("");
  const [frequencia, setFrequencia] = useState("24");

  function salvar() {
    startTransition(async () => {
      try {
        await salvarIntegracaoAction({
          supplierId: fornecedor.id,
          possuiIntegracao: possui,
          tipoIntegracao: possui ? kind : null,
          aceitaImportacaoManual: manual,
          aceitaImportacaoAutomatica: automatica,
          endpoint: kind === "API" && endpoint ? endpoint : null,
          authTipo: kind === "API" ? (authTipo as "bearer" | "basic" | "apikey" | "none") : null,
          credencial: credencial || undefined,
          frequenciaHoras: automatica ? Number(frequencia) : null,
        });
        toast.success("Integração salva", `${fornecedor.nome} atualizado.`);
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
      title={`Integração — ${fornecedor.nome}`}
      description="Como a tabela de preços deste fornecedor chega até você."
      width="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending}>
            {pending && <Loader2 size={15} className="animate-spin" />}
            Salvar integração
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <LinhaSwitch
          titulo="Este fornecedor manda tabela"
          descricao="Desligue para tirar o fornecedor do comparador sem apagar o histórico."
          checked={possui}
          onChange={setPossui}
        />

        <Field label="Como a tabela chega" hint="Define qual leitor o sistema usa ao importar.">
          <Select value={kind} onChange={(e) => setKind(e.target.value as SupplierIntegrationKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>

        {kind === "API" && (
          <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface-2/50 p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Plug size={13} /> Acesso à API do fornecedor
            </p>
            <Field label="Endereço (URL)" hint="Endpoint que devolve a lista de produtos em JSON.">
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.fornecedor.com.br/tabela"
                inputMode="url"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Autenticação">
                <Select value={authTipo} onChange={(e) => setAuthTipo(e.target.value)}>
                  <option value="bearer">Token (Bearer)</option>
                  <option value="apikey">Chave de API</option>
                  <option value="basic">Usuário e senha (Basic)</option>
                  <option value="none">Sem autenticação</option>
                </Select>
              </Field>
              <Field
                label="Credencial"
                hint="Guardada cifrada. Deixe em branco para manter a atual."
              >
                <Input
                  type="password"
                  value={credencial}
                  onChange={(e) => setCredencial(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </Field>
            </div>
          </div>
        )}

        <LinhaSwitch
          titulo="Aceita importação manual"
          descricao="Permite subir arquivo deste fornecedor na tela de importações."
          checked={manual}
          onChange={setManual}
        />

        <LinhaSwitch
          titulo="Sincroniza sozinho"
          descricao="Só vale para API. O sistema busca a tabela no intervalo escolhido."
          checked={automatica}
          onChange={setAutomatica}
          disabled={kind !== "API"}
        />

        {automatica && kind === "API" && (
          <Field label="A cada" hint="Distribuidor costuma atualizar tabela uma vez por dia.">
            <Select value={frequencia} onChange={(e) => setFrequencia(e.target.value)}>
              <option value="6">6 horas</option>
              <option value="12">12 horas</option>
              <option value="24">24 horas</option>
              <option value="72">3 dias</option>
              <option value="168">7 dias</option>
            </Select>
          </Field>
        )}

        {kind !== "API" && kind !== "MANUAL" && (
          <p className="flex items-start gap-2 rounded-[var(--radius)] bg-brand-soft/60 p-3 text-[12px] text-ink-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand" />
            Arquivo de {KIND_LABEL[kind]} entra pela tela de importações — o leitor certo já é
            escolhido pelo formato do arquivo.
          </p>
        )}
      </div>
    </Sheet>
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
