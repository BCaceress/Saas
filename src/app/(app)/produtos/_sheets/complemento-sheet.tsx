"use client";

import { useEffect, useState, useTransition } from "react";
import { Box, FileText, Loader2, Plus, Trash2, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Field, Eyebrow, Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { atualizarComplementoProduto } from "../actions";
import { opcoesDoLote } from "../list-actions";
import type { LoteOpcoes, ProductRow } from "../_types";

// ============================================================
// Compra e fiscal de um produto — fora do cadastro.
//
// O cadastro de produto simples pergunta só o que o operador sabe. Embalagem,
// fornecedor e classificação fiscal chegam sozinhos no XML da primeira nota. Mas produto que nunca recebeu nota — cadastrado à mão, importado de
// planilha, criado no encarte — ficaria sem nada disso para sempre. Este
// painel é a porta manual, e ele só mexe nesses campos: salvar aqui nunca
// desfaz nome, preço, categoria ou estoque.
// ============================================================

type PkLinha = { nome: string; ean: string; fator: string };

const num = (v: string) => {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) && v.trim() !== "" ? x : null;
};

export function ComplementoSheet({
  product,
  onClose,
  onSalvo,
}: {
  product: ProductRow;
  onClose: () => void;
  /** A listagem precisa recarregar: embalagem e fornecedor aparecem na linha. */
  onSalvo?: () => void;
}) {
  const [pending, start] = useTransition();
  const [opcoes, setOpcoes] = useState<LoteOpcoes | null>(null);

  const [fiscalProfileId, setFiscal] = useState(product.fiscalProfileId ?? "");
  const [gtinTrib, setGtinTrib] = useState(product.gtinTributavel ?? "");
  const [uTrib, setUTrib] = useState(product.unidadeTributavel ?? "");
  const [fatorTrib, setFatorTrib] = useState(
    product.fatorConversaoTrib != null ? String(product.fatorConversaoTrib) : "",
  );
  const [codigoAnp, setCodigoAnp] = useState(product.codigoAnp ?? "");

  const [packagings, setPackagings] = useState<PkLinha[]>(
    product.packagings.map((pk) => ({
      nome: pk.nome ?? "",
      ean: pk.ean ?? "",
      fator: pk.fatorConversao != null ? String(pk.fatorConversao) : "",
    })),
  );
  const [fornecedores, setFornecedores] = useState<string[]>(
    [...product.fornecedores]
      .sort((a, b) => Number(b.isPrincipal) - Number(a.isPrincipal))
      .map((f) => f.id),
  );

  useEffect(() => {
    let vivo = true;
    opcoesDoLote()
      .then((o) => vivo && setOpcoes(o))
      .catch(() => vivo && setOpcoes({ suppliers: [], fiscais: [], locais: [] }));
    return () => {
      vivo = false;
    };
  }, []);

  const perfil = opcoes?.fiscais.find((f) => f.id === fiscalProfileId) ?? null;
  const disponiveis = (opcoes?.suppliers ?? []).filter((s) => !fornecedores.includes(s.id));
  const nomeFornecedor = (id: string) => {
    const s = opcoes?.suppliers.find((x) => x.id === id);
    if (s) return s.nomeFantasia || s.razaoSocial;
    return product.fornecedores.find((f) => f.id === id)?.nome ?? "Fornecedor";
  };

  function salvar() {
    const pks = packagings
      .filter((p) => p.nome.trim() && (num(p.fator) ?? 0) > 0)
      .map((p) => ({
        nome: p.nome.trim(),
        ean: p.ean.trim() || undefined,
        fatorConversao: num(p.fator)!,
      }));
    start(async () => {
      try {
        await atualizarComplementoProduto(product.id, {
          fiscalProfileId: fiscalProfileId || undefined,
          gtinTributavel: gtinTrib.trim() || undefined,
          unidadeTributavel: uTrib.trim() || undefined,
          fatorConversaoTrib: num(fatorTrib) ?? undefined,
          codigoAnp: codigoAnp.trim() || undefined,
          fornecedoresIds: fornecedores,
          packagings: pks,
        });
        toast.success("Complemento salvo", `${product.nome} atualizado.`);
        onSalvo?.();
        onClose();
      } catch (e) {
        toast.error(
          "Não deu para salvar",
          e instanceof Error ? e.message : "Tente de novo.",
        );
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Compra e fiscal"
      description={product.nome}
      width="md"
      footer={
        <div className="flex items-center gap-2">
          <p className="mr-auto hidden text-xs text-muted sm:block">
            Só estes campos são alterados — nome, preço e estoque ficam como estão.
          </p>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={pending}>
            {pending && <Loader2 size={14} className="animate-spin" />}
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* ── Embalagem de compra ── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Box size={14} className="text-muted" />
            <Eyebrow>Embalagem de compra</Eyebrow>
          </div>
          <p className="text-xs text-muted">
            Quantas unidades de prateleira vêm em cada volume que o fornecedor fatura. É o
            que converte “3 caixas” em “36 garrafas” na entrada da nota.
          </p>

          {packagings.map((p, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_2fr_auto] items-end gap-2">
              <Field label={i === 0 ? "Embalagem" : ""} htmlFor={`pk-nome-${i}`}>
                <Input
                  id={`pk-nome-${i}`}
                  value={p.nome}
                  onChange={(e) =>
                    setPackagings((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, nome: e.target.value } : x)),
                    )
                  }
                  placeholder="Caixa"
                />
              </Field>
              <Field label={i === 0 ? "Unidades" : ""} htmlFor={`pk-fator-${i}`}>
                <Input
                  id={`pk-fator-${i}`}
                  value={p.fator}
                  onChange={(e) =>
                    setPackagings((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, fator: e.target.value } : x)),
                    )
                  }
                  placeholder="12"
                  inputMode="numeric"
                  className="font-mono"
                />
              </Field>
              <Field label={i === 0 ? "Código de barras" : ""} htmlFor={`pk-ean-${i}`}>
                <Input
                  id={`pk-ean-${i}`}
                  value={p.ean}
                  onChange={(e) =>
                    setPackagings((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, ean: e.target.value } : x)),
                    )
                  }
                  placeholder="789…"
                  inputMode="numeric"
                  className="font-mono placeholder:font-sans"
                />
              </Field>
              <button
                type="button"
                onClick={() => setPackagings((prev) => prev.filter((_, idx) => idx !== i))}
                className="mb-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line text-faint transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                aria-label="Remover embalagem"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setPackagings((prev) => [...prev, { nome: "", ean: "", fator: "" }])}
            className="flex w-fit items-center gap-1 text-xs font-medium text-brand-strong hover:text-brand"
          >
            <Plus size={13} /> Adicionar embalagem
          </button>
        </section>

        {/* ── Fornecedores ── */}
        <section className="flex flex-col gap-3 border-t border-line pt-5">
          <div className="flex items-center gap-2">
            <Truck size={14} className="text-muted" />
            <Eyebrow>Fornecedores</Eyebrow>
          </div>

          {fornecedores.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {fornecedores.map((id, i) => (
                <span
                  key={id}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2"
                >
                  {i === 0 && (
                    <span className="rounded-full bg-brand-soft px-1.5 py-0.5 font-mono text-[9px] font-semibold text-brand-strong">
                      principal
                    </span>
                  )}
                  {nomeFornecedor(id)}
                  <button
                    type="button"
                    onClick={() => setFornecedores((prev) => prev.filter((x) => x !== id))}
                    className="text-faint hover:text-danger"
                    aria-label={`Remover ${nomeFornecedor(id)}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">
              Nenhum. O primeiro da lista vira o principal — é dele que a reposição sugere
              comprar.
            </p>
          )}

          <Select
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) setFornecedores((prev) => [...prev, id]);
            }}
            disabled={!opcoes || disponiveis.length === 0}
          >
            <option value="">
              {!opcoes
                ? "Carregando…"
                : disponiveis.length === 0
                  ? "Todos já vinculados"
                  : "Adicionar fornecedor…"}
            </option>
            {disponiveis.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nomeFantasia || s.razaoSocial}
              </option>
            ))}
          </Select>
        </section>

        {/* ── Fiscal ── */}
        <section className="flex flex-col gap-3 border-t border-line pt-5">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-muted" />
            <Eyebrow>Fiscal</Eyebrow>
          </div>

          <Field
            label="Perfil fiscal"
            htmlFor="fiscal"
            hint="Vazio = usa a configuração da categoria. Valide com seu contador antes de emitir nota."
          >
            <Select
              id="fiscal"
              value={fiscalProfileId}
              onChange={(e) => setFiscal(e.target.value)}
              disabled={!opcoes}
            >
              <option value="">
                {opcoes ? "Usar configuração da categoria" : "Carregando…"}
              </option>
              {(opcoes?.fiscais ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} (NCM {f.ncm})
                </option>
              ))}
            </Select>
          </Field>

          {perfil && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">NCM {perfil.ncm}</Badge>
              {perfil.precisaRevisao && <Badge tone="warn">Precisa de revisão</Badge>}
            </div>
          )}

          <details className="group">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2 text-sm text-muted transition-colors",
                "hover:text-ink-2 [&::-webkit-details-marker]:hidden",
              )}
            >
              <Plus
                size={13}
                className="shrink-0 transition-transform duration-200 group-open:rotate-45"
              />
              Unidade tributável e combustíveis
            </summary>

            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Unidade tributável"
                htmlFor="utrib"
                hint="uTrib — só quando difere da unidade de venda."
              >
                <Input
                  id="utrib"
                  value={uTrib}
                  onChange={(e) => setUTrib(e.target.value.toUpperCase())}
                  placeholder="KG"
                  className="font-mono placeholder:font-sans"
                />
              </Field>
              <Field
                label="Fator de conversão"
                htmlFor="fator-trib"
                hint="qTrib = quantidade × fator."
              >
                <Input
                  id="fator-trib"
                  value={fatorTrib}
                  onChange={(e) => setFatorTrib(e.target.value)}
                  placeholder="1"
                  inputMode="decimal"
                  className="font-mono"
                />
              </Field>
              <Field
                label="GTIN tributável"
                htmlFor="gtin-trib"
                hint="cEANTrib — difere do EAN quando se vende fração."
              >
                <Input
                  id="gtin-trib"
                  value={gtinTrib}
                  onChange={(e) => setGtinTrib(e.target.value)}
                  placeholder="789…"
                  inputMode="numeric"
                  className="font-mono placeholder:font-sans"
                />
              </Field>
              <Field label="Código ANP" htmlFor="anp" hint="Só para combustíveis.">
                <Input
                  id="anp"
                  value={codigoAnp}
                  onChange={(e) => setCodigoAnp(e.target.value)}
                  placeholder="320102001"
                  inputMode="numeric"
                  className="font-mono placeholder:font-sans"
                />
              </Field>
            </div>
          </details>
        </section>
      </div>
    </Sheet>
  );
}
