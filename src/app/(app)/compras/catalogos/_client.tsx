"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, Library, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { FornecedorCard } from "../_catalogo/types";
import { EstadoVazio, IntegracaoStatus, SupplierAvatar, fmtQuando } from "../_catalogo/ui";

/**
 * Catálogos = a lista de tabelas que o mercado já recebeu. Ordena por quem tem
 * mais produto, porque é lá que a comparação tem peso; fornecedor sem tabela
 * cai para o fim com o convite para importar.
 */
export function ListaCatalogos({ fornecedores }: { fornecedores: FornecedorCard[] }) {
  const [busca, setBusca] = useState("");

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return fornecedores
      .filter((f) => !t || f.nome.toLowerCase().includes(t))
      .sort((a, b) => b.totalProdutos - a.totalProdutos || a.nome.localeCompare(b.nome));
  }, [fornecedores, busca]);

  const comTabela = lista.filter((f) => f.totalProdutos > 0);
  const semTabela = lista.filter((f) => f.totalProdutos === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-72">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar fornecedor"
            className="pl-9"
            aria-label="Buscar fornecedor"
          />
        </div>
        <Link href="/compras/importacoes">
          <Button size="sm" variant="secondary">
            <Upload size={14} />
            Importar tabela
          </Button>
        </Link>
      </div>

      {lista.length === 0 ? (
        <EstadoVazio
          icon={<Library size={20} />}
          titulo="Nenhum fornecedor encontrado"
          descricao="Ajuste a busca ou cadastre o fornecedor antes de importar a tabela dele."
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {[...comTabela, ...semTabela].map((f, i) => (
            <LinhaCatalogo key={f.id} fornecedor={f} primeira={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaCatalogo({ fornecedor: f, primeira }: { fornecedor: FornecedorCard; primeira: boolean }) {
  const vazio = f.totalProdutos === 0;

  return (
    <Link
      href={
        vazio
          ? `/compras/importacoes?fornecedor=${f.id}`
          : `/compras/catalogos/${f.id}`
      }
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
        !primeira && "border-t border-line",
      )}
    >
      <SupplierAvatar nome={f.nome} logoUrl={f.logoUrl} size={38} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{f.nome}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <IntegracaoStatus status={f.situacaoIntegracao} kind={f.tipoIntegracao} />
          <span className="text-[11px] text-faint">Atualizado {fmtQuando(f.ultimaSincronizacao).toLowerCase()}</span>
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        {f.emPromocao > 0 && <Badge tone="accent">{f.emPromocao} em promoção</Badge>}
        {f.pendentes > 0 && <Badge tone="warn">{f.pendentes} a revisar</Badge>}
      </div>

      <div className="w-20 shrink-0 text-right">
        <p className="font-mono text-sm font-semibold text-ink">
          {vazio ? "—" : f.totalProdutos.toLocaleString("pt-BR")}
        </p>
        <p className="text-[11px] text-faint">{vazio ? "sem tabela" : "produtos"}</p>
      </div>

      <ChevronRight size={16} className="shrink-0 text-faint" />
    </Link>
  );
}
