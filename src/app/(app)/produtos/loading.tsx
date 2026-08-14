import { Plus, ChevronDown, Star, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { CorpoProdutosSkeleton } from "./_skeleton";

/**
 * Primeira abertura de /produtos.
 *
 * O chrome é REAL, não placeholder: título, ações, busca, filtros e o cabeçalho
 * das colunas aparecem na hora — a página já abriu, só faltam os dados. Apenas
 * as linhas ficam em esqueleto, no mesmo espaço que vão ocupar depois.
 * Sem spinner central.
 */
export default function ProdutosLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <PageHeader
        title="Produtos"
        icon={navIcon("/produtos")}
        innerClassName="max-w-none"
        actions={
          <>
            <BotaoInerte variant="ghost">
              <Star size={15} /> Visões <ChevronDown size={14} className="-mr-0.5 text-muted" />
            </BotaoInerte>
            <BotaoInerte variant="secondary">
              <Settings2 size={15} /> Gerenciar <ChevronDown size={14} className="-mr-0.5 text-muted" />
            </BotaoInerte>
            <BotaoInerte variant="brand">
              <Plus size={15} /> Novo produto
            </BotaoInerte>
          </>
        }
      />

      <CorpoProdutosSkeleton linhas={8} />
    </div>
  );
}

/**
 * Botão desenhado, não clicável — o `loading.tsx` não tem handler para dar.
 * Some do fluxo de teclado (`aria-hidden`) para não virar parada morta no tab.
 */
function BotaoInerte({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "ghost" | "secondary" | "brand";
}) {
  const cor =
    variant === "brand"
      ? "bg-brand text-on-brand shadow-[var(--shadow-1)]"
      : variant === "secondary"
        ? "bg-surface-2 text-ink"
        : "text-muted";
  return (
    <span
      aria-hidden
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ${cor}`}
    >
      {children}
    </span>
  );
}
