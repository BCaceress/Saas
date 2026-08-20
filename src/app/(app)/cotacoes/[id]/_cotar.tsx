"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, fmtPreco, ReguaPreco, type MarcaRegua } from "../_catalogo/ui";
import type { CotacaoDetalhe } from "../_compra-types";
import { carregarOfertasCotacaoAction, cotarComCatalogoAction } from "../_compra-actions";

// ── Cotar pelo catálogo ──────────────────────────────────────
// Aposenta o Comparador/Cesta como tela própria: em vez de esperar resposta
// de RFQ, o operador escolhe direto na tabela de preço já importada do
// fornecedor. A régua de preço é a mesma peça visual do módulo — só que
// clicável aqui, porque a decisão é "de quem eu compro este item".

type Oferta = { supplierId: string; supplierNome: string; precoEfetivo: number };

export function CotarCatalogo({
  cotacao,
  editavel,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
}) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);
  const [ofertas, setOfertas] = useState<Record<string, Oferta[]>>({});
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    carregarOfertasCotacaoAction(cotacao.id)
      .then((r) => {
        if (vivo) setOfertas(r);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [cotacao.id]);

  const itensComOferta = cotacao.itens.filter((i) => (ofertas[i.id]?.length ?? 0) > 0);
  const totalEscolhidos = Object.keys(escolhas).length;

  function escolher(itemId: string, supplierId: string) {
    setEscolhas((s) => {
      const novo = { ...s };
      if (novo[itemId] === supplierId) delete novo[itemId];
      else novo[itemId] = supplierId;
      return novo;
    });
  }

  function registrar() {
    setErro(null);
    const entradas = Object.entries(escolhas);
    if (entradas.length === 0) return;
    startTransition(async () => {
      try {
        await cotarComCatalogoAction({
          quotationId: cotacao.id,
          escolhas: entradas.map(([quotationItemId, supplierId]) => {
            const preco = ofertas[quotationItemId]?.find((o) => o.supplierId === supplierId)?.precoEfetivo ?? 0;
            return { quotationItemId, supplierId, precoUnitario: preco };
          }),
        });
        setEscolhas({});
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível registrar a cotação.");
      }
    });
  }

  if (carregando) {
    return <p className="text-[13px] text-muted">Consultando o catálogo dos fornecedores…</p>;
  }

  if (itensComOferta.length === 0) {
    return (
      <EstadoVazio
        icon={<Scale size={20} />}
        titulo="Nenhum item tem preço de catálogo"
        descricao="Nenhum item desta cotação está vinculado à tabela de preço de um fornecedor ainda. Convide fornecedores no passo Fornecedores para pedir preço."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">
        Preço já cadastrado na tabela dos fornecedores — escolha de quem comprar cada item sem
        esperar resposta de cotação.
      </p>

      <ul className="flex flex-col gap-3">
        {itensComOferta.map((item) => {
          const lista = ofertas[item.id] ?? [];
          const marcas: MarcaRegua[] = lista.map((o) => ({
            id: o.supplierId,
            nome: o.supplierNome,
            preco: o.precoEfetivo,
          }));
          const escolhido = escolhas[item.id];
          return (
            <li key={item.id} className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
              <p className="text-sm font-medium text-ink">{item.descricao}</p>
              <ReguaPreco marcas={marcas} className="mt-3" />
              {editavel && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {lista.map((o) => (
                    <button
                      key={o.supplierId}
                      type="button"
                      onClick={() => escolher(item.id, o.supplierId)}
                      aria-pressed={escolhido === o.supplierId}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                        escolhido === o.supplierId
                          ? "border-brand bg-brand text-on-brand"
                          : "border-line text-ink hover:bg-surface-2",
                      )}
                    >
                      {escolhido === o.supplierId && <Check size={12} />}
                      {o.supplierNome} · {fmtPreco(o.precoEfetivo)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {editavel && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-float)]">
          <p className="text-[13px] text-muted">
            {totalEscolhidos === 0
              ? "Escolha o fornecedor de cada item."
              : `${totalEscolhidos} ${totalEscolhidos === 1 ? "item escolhido" : "itens escolhidos"}`}
          </p>
          <button
            type="button"
            onClick={registrar}
            disabled={pendente || totalEscolhidos === 0}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pendente ? "Registrando…" : "Registrar cotação do catálogo"}
          </button>
        </div>
      )}
    </div>
  );
}
