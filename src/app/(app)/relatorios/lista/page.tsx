import Link from "next/link";
import {
  TrendingUp,
  Percent,
  CreditCard,
  ChartColumnBig,
  TriangleAlert,
  FlaskConical,
  Boxes,
  Truck,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type RelatorioItem = {
  id: string;
  nome: string;
  descricao: string;
  icon: React.ElementType;
};

type Grupo = {
  id: string;
  nome: string;
  descricao: string;
  itens: RelatorioItem[];
};

const CATALOGO: Grupo[] = [
  {
    id: "financeiro",
    nome: "Financeiro",
    descricao: "Receita, margem e rentabilidade",
    itens: [
      { id: "vendas", nome: "Receita", descricao: "Faturamento, ticket médio e tendência de vendas por período.", icon: TrendingUp },
      { id: "margem", nome: "Margem", descricao: "Margem bruta, CMV e rentabilidade de cada produto.", icon: Percent },
      { id: "pagamentos", nome: "Pagamentos e caixa", descricao: "Mix de formas de pagamento e fechamentos de caixa.", icon: CreditCard },
      { id: "abc", nome: "Curva ABC", descricao: "Classificação A/B/C dos produtos por participação no faturamento.", icon: ChartColumnBig },
    ],
  },
  {
    id: "operacao",
    nome: "Operação",
    descricao: "Perdas, produção e operação diária",
    itens: [
      { id: "perdas", nome: "Perdas e quebras", descricao: "Produtos baixados como perda no período, com custo total.", icon: TriangleAlert },
      { id: "producao", nome: "Produção e drinks", descricao: "Rentabilidade de bebidas personalizadas e consumo de insumos.", icon: FlaskConical },
    ],
  },
  {
    id: "estoque",
    nome: "Estoque",
    descricao: "Posição, ruptura e giro de estoque",
    itens: [
      { id: "estoque", nome: "Inventário", descricao: "Posição atual do estoque, ruptura e valor parado por produto.", icon: Boxes },
    ],
  },
  {
    id: "compras",
    nome: "Compras",
    descricao: "Entradas e fornecedores",
    itens: [
      { id: "compras", nome: "Compras do período", descricao: "Entradas de mercadoria por produto e total por fornecedor.", icon: Truck },
    ],
  },
];

export default function ListaRelatoriosPage() {
  return (
    <div className="space-y-10">
      {CATALOGO.map((grupo) => (
        <section key={grupo.id}>
          <div className="mb-4">
            <h2 className="font-display text-base font-bold text-ink">{grupo.nome}</h2>
            <p className="mt-0.5 text-sm text-muted">{grupo.descricao}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {grupo.itens.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={`/relatorios/${item.id}`}
                  className={cn(
                    "group flex flex-col gap-4 rounded-lg border border-line bg-surface p-5",
                    "transition-all hover:border-brand/40 hover:shadow-(--shadow-1)",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-sm bg-brand-softer text-brand">
                      <Icon size={18} aria-hidden />
                    </span>
                    <ArrowRight
                      size={15}
                      className="mt-1 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </div>

                  <div>
                    <h3 className="font-display text-sm font-bold text-ink group-hover:text-brand">
                      {item.nome}
                    </h3>
                    <p className="mt-1 text-[13px] leading-snug text-muted">{item.descricao}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
