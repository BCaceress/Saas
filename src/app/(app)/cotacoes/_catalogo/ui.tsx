"use client";

import * as React from "react";
import {
  Plug,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Braces,
  Code2,
  PencilLine,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";
import type { SupplierIntegrationKind, SupplierIntegrationStatus } from "@/generated/prisma";

// Formatadores vivem em ./format (módulo não-client) para que RSC também possa
// chamá-los; re-exportados aqui pela conveniência dos clients.
import { fmtPreco } from "./format";
export {
  fmtMoney,
  fmtPreco,
  fmtQtd,
  fmtQuando,
  unidadeDaQtd,
  fmtQtdEmbalagem,
  rotuloEmbalagemPedida,
} from "./format";

// ── Fornecedor ──────────────────────────────────────────────

export function SupplierAvatar({
  nome,
  logoUrl,
  size = 40,
  className,
}: {
  nome: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {logoUrl ? (
        // Logo do fornecedor é URL de terceiro colada pelo operador — host
        // arbitrário não passa pelo next/image (mesmo padrão do resto do app).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-full w-full object-contain" />
      ) : (
        <span className="font-mono text-[11px] font-semibold tracking-tight text-muted">{iniciais}</span>
      )}
    </div>
  );
}

export const KIND_ICON: Record<SupplierIntegrationKind, LucideIcon> = {
  API: Plug,
  PLANILHA: FileSpreadsheet,
  CSV: Table2,
  PDF: FileText,
  IMAGEM: ImageIcon,
  XML: Code2,
  JSON: Braces,
  MANUAL: PencilLine,
};

export const KIND_LABEL: Record<SupplierIntegrationKind, string> = {
  API: "API",
  PLANILHA: "Planilha",
  CSV: "CSV",
  PDF: "PDF",
  IMAGEM: "Imagem",
  XML: "XML",
  JSON: "JSON",
  MANUAL: "Manual",
};

const STATUS_META: Record<
  SupplierIntegrationStatus,
  { label: string; dot: string; text: string }
> = {
  ONLINE: { label: "Ativa", dot: "bg-ok", text: "text-ok" },
  OFFLINE: { label: "Parada", dot: "bg-faint", text: "text-muted" },
  ERRO: { label: "Com erro", dot: "bg-danger", text: "text-danger" },
  NAO_CONFIGURADA: { label: "Sem integração", dot: "bg-faint", text: "text-faint" },
};

export function IntegracaoStatus({
  status,
  kind,
}: {
  status: SupplierIntegrationStatus;
  kind: SupplierIntegrationKind | null;
}) {
  const meta = STATUS_META[status];
  const Icone = kind ? KIND_ICON[kind] : Plug;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden />
      <Icone size={13} className="text-muted" />
      <span className={meta.text}>{kind ? KIND_LABEL[kind] : "—"}</span>
      <span className="text-faint">·</span>
      <span className={meta.text}>{meta.label}</span>
    </span>
  );
}

// ── Métricas ────────────────────────────────────────────────
// Um grid único com divisores — não seis cartões soltos boiando na tela.

export function MetricaGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Metrica({
  label,
  valor,
  sub,
  tom = "ink",
  icon,
}: {
  label: string;
  valor: string;
  sub?: string;
  tom?: "ink" | "accent" | "ok" | "brand";
  icon?: React.ReactNode;
}) {
  const cor =
    tom === "accent" ? "text-accent" : tom === "ok" ? "text-ok" : tom === "brand" ? "text-brand" : "text-ink";
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 truncate font-display text-[19px] font-semibold leading-tight", cor)}>
        {valor}
      </div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

// ── Régua de preço — elemento-assinatura do módulo ──────────
// A comparação não é uma tabela de números: é uma prateleira. Cada fornecedor
// é uma marca na régua entre o menor e o maior preço; o mais barato ganha a
// etiqueta âmbar. Quem olha entende a distância antes de ler o valor.

export type MarcaRegua = {
  id: string;
  nome: string;
  preco: number;
  destaque?: boolean;
};

export function ReguaPreco({ marcas, className }: { marcas: MarcaRegua[]; className?: string }) {
  if (marcas.length === 0) return null;

  const precos = marcas.map((m) => m.preco);
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const faixa = max - min;

  if (faixa <= 0) {
    return (
      <div className={cn("text-[12px] text-muted", className)}>
        Mesmo preço em {marcas.length} fornecedor{marcas.length > 1 ? "es" : ""}.
      </div>
    );
  }

  return (
    <div className={cn("select-none", className)}>
      <div className="relative h-9">
        {/* Trilho: do mais barato (cyan) ao mais caro (linha fria) */}
        <div className="absolute inset-x-0 top-5 h-1 rounded-full bg-gradient-to-r from-brand/60 via-line to-danger/40" />
        {marcas.map((m) => {
          const pct = ((m.preco - min) / faixa) * 100;
          const barato = m.preco === min;
          return (
            <div
              key={m.id}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${Math.min(96, Math.max(4, pct))}%` }}
              title={`${m.nome} — ${fmtPreco(m.preco)}`}
            >
              <span
                className={cn(
                  "block whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                  barato ? "bg-accent-soft text-accent" : "text-muted",
                )}
              >
                {fmtPreco(m.preco)}
              </span>
              <span
                className={cn(
                  "mx-auto mt-0.5 block h-3 w-3 rounded-full border-2 border-surface",
                  barato ? "bg-accent" : m.destaque ? "bg-brand" : "bg-line-strong",
                )}
                aria-hidden
              />
            </div>
          );
        })}
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px] text-faint">
        <span className="truncate">{marcas.find((m) => m.preco === min)?.nome}</span>
        <span className="font-mono text-accent">economia {fmtPreco(faixa)}</span>
      </div>
    </div>
  );
}

// ── Diversos ────────────────────────────────────────────────

export function PromoBadge({ desconto }: { desconto: number }) {
  return (
    <Badge tone="accent" className="font-mono">
      −{desconto.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </Badge>
  );
}

export function EstadoVazio({
  icon,
  titulo,
  descricao,
  acao,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-line bg-surface px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-brand-soft text-brand">
        {icon}
      </div>
      <div>
        <p className="font-display text-[15px] font-semibold text-ink">{titulo}</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{descricao}</p>
      </div>
      {acao}
    </div>
  );
}
