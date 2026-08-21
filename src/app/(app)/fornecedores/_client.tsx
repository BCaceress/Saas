"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Truck,
  ChevronRight,
  Loader2,
  MapPin,
  Tag,
  Plug,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { maskCnpj, maskPhone } from "@/lib/masks";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ViewToggle, useViewMode } from "@/components/app/view-toggle";
import { fmtQuando } from "../cotacoes/_catalogo/ui";
import { fmtMoney } from "../cotacoes/_ui";
import { createSupplier } from "../produtos/actions";
import type { FornecedorListaRow } from "./_data";

// ============================================================
// Lista de fornecedores — só o índice. Clicar abre o Centro de Gestão do
// Fornecedor (/fornecedores/[id]), onde mora TUDO daquele parceiro: cadastro,
// integração, catálogo, preço, pedido e financeiro.
//
// Não há mais modal de edição: um fornecedor não cabe numa gaveta.
// ============================================================

function Logo({
  logoUrl,
  nome,
  ativo,
  size = 38,
}: {
  logoUrl?: string | null;
  nome: string;
  ativo: boolean;
  size?: number;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`Logo de ${nome}`}
        className="shrink-0 rounded-xl border border-line bg-surface object-contain p-1"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl",
        ativo ? "bg-brand-soft text-brand" : "bg-surface-2 text-faint",
      )}
      style={{ width: size, height: size }}
    >
      <Truck size={Math.round(size * 0.45)} />
    </span>
  );
}

type Filtro = "todos" | "ativos" | "integrados" | "revisar";

const FILTROS: Array<{ valor: Filtro; label: string }> = [
  { valor: "todos", label: "Todos" },
  { valor: "ativos", label: "Ativos" },
  { valor: "integrados", label: "Com tabela" },
  { valor: "revisar", label: "A revisar" },
];

export function FornecedoresManager({
  suppliers,
  podeEditar,
}: {
  suppliers: FornecedorListaRow[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [view, setView] = useViewMode("nohub:fornecedores:view");
  const [criando, setCriando] = useState(false);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (t && !`${s.razaoSocial} ${s.nomeFantasia ?? ""} ${s.cnpj ?? ""}`.toLowerCase().includes(t)) {
          return false;
        }
        if (filtro === "ativos") return s.ativo;
        if (filtro === "integrados") return s.totalCatalogo > 0;
        if (filtro === "revisar") return s.pendentes > 0;
        return true;
      })
      .sort((a, b) =>
        (a.nomeFantasia || a.razaoSocial).localeCompare(b.nomeFantasia || b.razaoSocial, "pt-BR"),
      );
  }, [suppliers, q, filtro]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Fornecedores"
        icon={navIcon("/fornecedores")}
        description="Cada fornecedor tem página própria: cadastro, integração, catálogo, preços, pedidos e financeiro."
        innerClassName="max-w-none"
        actions={
          podeEditar && (
            <button
              onClick={() => setCriando(true)}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <Plus size={16} /> Adicionar
            </button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar fornecedor cadastrado"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setFiltro(f.valor)}
              aria-pressed={filtro === f.valor}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                filtro === f.valor
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-12 text-center">
          <Truck size={32} className="text-faint" />
          <p className="text-sm text-muted">
            {suppliers.length === 0
              ? "Nenhum fornecedor cadastrado. Adicione o primeiro."
              : "Nenhum fornecedor com esse filtro."}
          </p>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <CardFornecedor key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {list.map((s, idx) => (
            <LinhaFornecedor key={s.id} s={s} primeira={idx === 0} />
          ))}
        </div>
      )}

      {criando && (
        <SheetNovoFornecedor
          onClose={() => setCriando(false)}
          onCriado={(id) => router.push(`/fornecedores/${id}`)}
        />
      )}
    </div>
  );
}

function SinaisCatalogo({ s }: { s: FornecedorListaRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {s.totalCatalogo > 0 && (
        <span className="text-[11px] text-faint">
          {s.totalCatalogo.toLocaleString("pt-BR")} itens · {fmtQuando(s.ultimaSincronizacao).toLowerCase()}
        </span>
      )}
    </div>
  );
}

function CardFornecedor({ s }: { s: FornecedorListaRow }) {
  return (
    <Link
      href={`/fornecedores/${s.id}`}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2",
        !s.ativo && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <Logo logoUrl={s.logoUrl} nome={s.nomeFantasia || s.razaoSocial} ativo={s.ativo} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium text-ink", !s.ativo && "text-faint line-through")}>
            {s.nomeFantasia || s.razaoSocial}
          </p>
          <p className="truncate text-xs text-faint">{s.cnpj ? maskCnpj(s.cnpj) : "sem CNPJ"}</p>
        </div>
        {!s.ativo && <Badge>Inativo</Badge>}
        <ChevronRight size={16} className="shrink-0 text-faint" />
      </div>

      <SinaisCatalogo s={s} />

      <div className="grid grid-cols-3 divide-x divide-line rounded-[var(--radius)] bg-surface-2/60 py-2 text-center">
        <div>
          <p className="font-mono text-[14px] font-semibold text-ink">{s.totalProdutos}</p>
          <p className="text-[11px] text-faint">produtos</p>
        </div>
        <div>
          <p
            className={cn(
              "font-mono text-[14px] font-semibold",
              s.emPromocao > 0 ? "text-accent" : "text-ink",
            )}
          >
            {s.emPromocao}
          </p>
          <p className="text-[11px] text-faint">em promoção</p>
        </div>
        <div>
          <p className="font-mono text-[14px] font-semibold text-ink tnum">
            {fmtMoney(s.totalComprado30d)}
          </p>
          <p className="text-[11px] text-faint">comprado 30d</p>
        </div>
      </div>

      {(s.municipio || s.telefone) && (
        <div className="flex items-center gap-x-2 border-t border-line pt-3 text-xs text-faint">
          {s.municipio && (
            <span className="flex items-center gap-1 truncate">
              <MapPin size={11} /> {s.municipio}
              {s.uf ? `/${s.uf}` : ""}
            </span>
          )}
          {s.municipio && s.telefone && <span>·</span>}
          {s.telefone && <span className="shrink-0">{maskPhone(s.telefone)}</span>}
        </div>
      )}
    </Link>
  );
}

function LinhaFornecedor({ s, primeira }: { s: FornecedorListaRow; primeira: boolean }) {
  return (
    <Link
      href={`/fornecedores/${s.id}`}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
        !primeira && "border-t border-line",
        !s.ativo && "opacity-60",
      )}
    >
      <Logo logoUrl={s.logoUrl} nome={s.nomeFantasia || s.razaoSocial} ativo={s.ativo} />

      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium text-ink", !s.ativo && "text-faint line-through")}>
          {s.nomeFantasia || s.razaoSocial}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-faint">
          <span className="font-mono">{s.cnpj ? maskCnpj(s.cnpj) : "sem CNPJ"}</span>
          {s.telefone && <span>· {maskPhone(s.telefone)}</span>}
          {s.municipio && (
            <span>
              · {s.municipio}
              {s.uf ? `/${s.uf}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 sm:block">
        <SinaisCatalogo s={s} />
      </div>

      <div className="hidden shrink-0 items-center gap-2 lg:flex">
        {s.emPromocao > 0 && (
          <Badge tone="accent">
            <Tag size={11} />
            {s.emPromocao}
          </Badge>
        )}
        {s.pendentes > 0 && <Badge tone="warn">{s.pendentes} a revisar</Badge>}
        {!s.ativo && <Badge>Inativo</Badge>}
      </div>

      <div className="hidden w-24 shrink-0 text-right sm:block">
        <p className="font-mono text-[13px] font-semibold text-ink tnum">
          {fmtMoney(s.totalComprado30d)}
        </p>
        <p className="text-[11px] text-faint">últimos 30d</p>
      </div>

      <ChevronRight size={16} className="shrink-0 text-faint" />
    </Link>
  );
}

// ── Cadastro rápido ─────────────────────────────────────────
// Só o mínimo para o fornecedor existir. O resto se completa na página dele.

function SheetNovoFornecedor({
  onClose,
  onCriado,
}: {
  onClose: () => void;
  onCriado: (id: string) => void;
}) {
  const [cnpj, setCnpj] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [nota, setNota] = useState<string>();
  const [pending, start] = useTransition();

  async function buscarCnpj() {
    const digitos = cnpj.replace(/\D/g, "");
    if (digitos.length !== 14) {
      toast.error("CNPJ incompleto", "Informe os 14 dígitos.");
      return;
    }
    setBuscando(true);
    setNota(undefined);
    try {
      const res = await fetch(`/api/fornecedores/cnpj/${digitos}`);
      const d = await res.json();
      if (res.ok) {
        setRazaoSocial(d.razaoSocial || "");
        setNomeFantasia(d.nomeFantasia || "");
        setEmail(d.email || "");
        setTelefone(d.telefone ? maskPhone(d.telefone) : "");
        setNota("Dados da Receita carregados. Confira antes de salvar.");
      } else if (res.status === 404) {
        setNota("CNPJ não encontrado na Receita — preencha manualmente.");
      } else {
        toast.error("Consulta indisponível", d.error ?? "Tente de novo em instantes.");
      }
    } catch {
      toast.error("Falha ao consultar o CNPJ", "Verifique a conexão e tente de novo.");
    } finally {
      setBuscando(false);
    }
  }

  function salvar() {
    start(async () => {
      try {
        const id = await createSupplier({
          cnpj,
          razaoSocial,
          nomeFantasia,
          telefone,
          email,
        });
        toast.success("Fornecedor criado", "Complete o cadastro e configure a integração.");
        onCriado(id);
      } catch (e) {
        toast.error("Não deu para criar", e instanceof Error ? e.message : "Informe a razão social.");
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Novo fornecedor"
      description="Pesquise pelo CNPJ para preencher automaticamente. O resto se completa na página dele."
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending || razaoSocial.trim().length < 2}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Criar e abrir
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <Field label="CNPJ" htmlFor="novo-cnpj">
          <div className="flex gap-2">
            <Input
              id="novo-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              maxLength={18}
              className="font-mono"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarCnpj())}
            />
            <Button type="button" variant="secondary" onClick={buscarCnpj} disabled={buscando} className="shrink-0">
              {buscando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              Pesquisar
            </Button>
          </div>
        </Field>

        {nota && (
          <p className="rounded-[var(--radius-sm)] bg-brand-soft px-3 py-2 text-xs text-brand-strong">{nota}</p>
        )}

        <Field label="Razão social" htmlFor="novo-razao" required>
          <Input id="novo-razao" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} autoFocus />
        </Field>

        <Field label="Nome fantasia" htmlFor="novo-fant">
          <Input id="novo-fant" value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telefone / WhatsApp" htmlFor="novo-tel">
            <Input
              id="novo-tel"
              value={telefone}
              onChange={(e) => setTelefone(maskPhone(e.target.value))}
              inputMode="numeric"
              maxLength={15}
              placeholder="(11) 99999-9999"
            />
          </Field>
          <Field label="E-mail" htmlFor="novo-mail">
            <Input id="novo-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>

        <p className="flex items-start gap-2 rounded-[var(--radius)] bg-surface-2 p-3 text-[12px] text-muted">
          <Plug size={14} className="mt-0.5 shrink-0 text-brand" />
          Depois de criar, o próximo passo é a aba Integração — é lá que a tabela de preços deste
          fornecedor passa a chegar sozinha.
        </p>
      </div>
    </Sheet>
  );
}
