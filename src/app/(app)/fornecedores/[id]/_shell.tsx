"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Truck, Phone, Mail, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { maskCnpj, maskPhone } from "@/lib/masks";
import type { FornecedorHeader } from "./_data";

// ============================================================
// Centro de Gestão do Fornecedor — a moldura que vale para todas as abas.
//
// A identidade (quem é, como falo com ele) fica sempre visível; cada aba
// responde uma pergunta diferente sobre o MESMO parceiro. É o que acaba com a
// ida e volta entre Fornecedores e Compras.
//
// Ativar/inativar mora no card "Dados gerais" do Resumo — chave repetida em
// dois lugares vira duas verdades.
// ============================================================

const ABAS = [
  { slug: "", label: "Resumo" },
  { slug: "catalogo", label: "Catálogo" },
  { slug: "precos", label: "Histórico de preços" },
  { slug: "financeiro", label: "Financeiro" },
  { slug: "historico", label: "Relacionamento" },
] as const;

export function FornecedorShell({
  header,
  children,
}: {
  header: FornecedorHeader;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const base = `/fornecedores/${header.id}`;
  const resto = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : "";
  const ativa = ABAS.find((a) => a.slug === resto)?.slug ?? "";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-line bg-surface px-4 py-3.5">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/fornecedores"
            aria-label="Voltar para fornecedores"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft size={16} />
          </Link>

          {header.logoUrl ? (
            // Logo é URL de terceiro colada pelo operador — host arbitrário
            // não passa pelo next/image (mesmo padrão do resto do app).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={header.logoUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-[var(--radius)] border border-line bg-surface-2 object-contain p-1"
            />
          ) : (
            <span
              className={cn(
                "grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius)]",
                header.ativo ? "bg-brand-soft text-brand" : "bg-surface-2 text-faint",
              )}
            >
              <Truck size={22} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className={cn(
                  "truncate font-display text-[18px] font-semibold text-ink",
                  !header.ativo && "text-faint line-through",
                )}
              >
                {header.nome}
              </h1>
              {!header.ativo && <Badge>Inativo</Badge>}
              {header.pendentes > 0 && (
                <Badge tone="warn">{header.pendentes} itens a revisar</Badge>
              )}
              {header.sugestoesPendentes > 0 && (
                <Badge tone="accent">
                  {header.sugestoesPendentes} sugestão(ões) do XML
                </Badge>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              {header.cnpj && <span className="font-mono">{maskCnpj(header.cnpj)}</span>}
              {header.telefone && (
                <a
                  href={`https://wa.me/${
                    header.telefone.replace(/\D/g, "").length <= 11
                      ? `55${header.telefone.replace(/\D/g, "")}`
                      : header.telefone.replace(/\D/g, "")
                  }`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-brand hover:underline"
                >
                  <Phone size={11} /> {maskPhone(header.telefone)}
                </a>
              )}
              {header.email && (
                <a
                  href={`mailto:${header.email}`}
                  className="flex items-center gap-1 truncate hover:text-brand hover:underline"
                >
                  <Mail size={11} /> {header.email}
                </a>
              )}
<span className="text-faint">
                {header.totalCatalogo.toLocaleString("pt-BR")} itens no catálogo
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/pedidos?q=${encodeURIComponent(header.nome)}`}>
              <Button size="sm" variant="secondary">
                <ShoppingCart size={14} />
                <span className="hidden sm:inline">Comprar</span>
              </Button>
            </Link>
          </div>
        </div>

        <nav
          aria-label="Seções do fornecedor"
          className="-mb-3.5 flex items-center gap-1 overflow-x-auto border-t border-line pt-1"
        >
          {ABAS.map((aba) => {
            const href = aba.slug ? `${base}/${aba.slug}` : base;
            const atual = aba.slug === ativa;
            return (
              <Link
                key={aba.slug || "resumo"}
                href={href}
                aria-current={atual ? "page" : undefined}
                className={cn(
                  "shrink-0 px-3 py-2.5 text-sm font-medium transition-colors",
                  atual ? "border-b-2 border-brand text-brand" : "text-muted hover:text-ink",
                )}
              >
                {aba.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {children}
    </div>
  );
}
