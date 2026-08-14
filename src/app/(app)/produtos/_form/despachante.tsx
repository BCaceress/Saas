"use client";

import dynamic from "next/dynamic";
import { CadastroProdutoSkeleton } from "./_skeleton";
import type { ProductPrefill } from "./product-form";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";
import type {
  BrandOpt,
  CategoryOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierPickerOpt,
  FiscalOpt,
  ProductRow,
  ComboData,
  ReceitaData,
  RecipeType,
  ComponentCandidate,
} from "../_types";

/**
 * Escolhe o formulário pelo tipo do produto — e é o que faz cada um viajar no
 * seu próprio pedaço de JavaScript.
 *
 * Por que um componente CLIENT e não o `switch` direto na página: quando um
 * Server Component importa três formulários, o bundler junta os três no mesmo
 * grupo de chunks e o browser baixa todos, mesmo renderizando um. Cadastrar
 * uma água mineral carregava a receita de drink e o montador de combo — cem
 * quilobytes de código que nunca rodam. `next/dynamic` só divide de verdade a
 * partir de uma fronteira client (é o que a doc do Next chama de "automatic
 * code splitting is not supported" quando o import dinâmico nasce no servidor).
 *
 * Sem `ssr: false`: o formulário continua vindo renderizado do servidor, o que
 * mantém o campo na tela antes da hidratação. O `loading` só aparece se o
 * pedaço demorar a chegar depois da navegação.
 */

function CarregandoProduto() {
  return <CadastroProdutoSkeleton titulo="Produto" />;
}
function CarregandoCombo() {
  return <CadastroProdutoSkeleton titulo="Combo" />;
}
function CarregandoReceita() {
  return <CadastroProdutoSkeleton titulo="Receita" />;
}

const ProductForm = dynamic(
  () => import("./product-form").then((m) => m.ProductForm),
  { loading: CarregandoProduto },
);

const ComboForm = dynamic(
  () => import("./combo-form").then((m) => m.ComboForm),
  { loading: CarregandoCombo },
);

const ReceitaForm = dynamic(
  () => import("./receita-form").then((m) => m.ReceitaForm),
  { loading: CarregandoReceita },
);

export type FormProdutoProps =
  | {
      kind: "product";
      mode: "new" | "edit";
      tipo: "SIMPLES" | "INSUMO";
      product?: ProductRow | null;
      brands: BrandOpt[];
      categories: CategoryOpt[];
      subcategories: SubcategoryOpt[];
      storage: StorageOpt[];
      suppliers: SupplierPickerOpt[];
      fiscalProfiles: FiscalOpt[];
      defaultEstoqueMinimo?: number;
      policy?: EstoquePolicy;
      prefill?: ProductPrefill;
    }
  | {
      kind: "combo";
      mode: "new" | "edit";
      combo?: ComboData | null;
      candidates: ComponentCandidate[];
    }
  | {
      kind: "receita";
      mode: "new" | "edit";
      receita?: ReceitaData | null;
      tipoInicial?: RecipeType;
      subcategories: SubcategoryOpt[];
      candidates: ComponentCandidate[];
    };

export function FormProduto(props: FormProdutoProps) {
  if (props.kind === "combo") {
    return (
      <ComboForm mode={props.mode} combo={props.combo} candidates={props.candidates} />
    );
  }

  if (props.kind === "receita") {
    return (
      <ReceitaForm
        mode={props.mode}
        receita={props.receita}
        tipoInicial={props.tipoInicial}
        subcategories={props.subcategories}
        candidates={props.candidates}
      />
    );
  }

  return (
    <ProductForm
      mode={props.mode}
      tipo={props.tipo}
      product={props.product}
      brands={props.brands}
      categories={props.categories}
      subcategories={props.subcategories}
      storage={props.storage}
      suppliers={props.suppliers}
      fiscalProfiles={props.fiscalProfiles}
      defaultEstoqueMinimo={props.defaultEstoqueMinimo}
      policy={props.policy}
      prefill={props.prefill}
    />
  );
}
