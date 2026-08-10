"use client";

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { bulkRenameProducts } from "../actions";

export type ProdutoNome = {
  id: string;
  nome: string;
  sku: string;
};

/**
 * Renomeia em massa os produtos selecionados na listagem, um campo por
 * produto — sem precisar abrir a tela de editar um por um.
 */
export function NomesSheet({
  open,
  onClose,
  produtos,
  onAplicado,
}: {
  open: boolean;
  onClose: () => void;
  produtos: ProdutoNome[];
  onAplicado?: () => void;
}) {
  const [pending, start] = useTransition();
  const [nomes, setNomes] = useState<Record<string, string>>(() =>
    Object.fromEntries(produtos.map((p) => [p.id, p.nome])),
  );

  const alterados = produtos.filter(
    (p) => (nomes[p.id] ?? "").trim() !== p.nome,
  );
  const invalido = produtos.some((p) => (nomes[p.id] ?? "").trim().length < 2);

  function aplicar() {
    if (invalido) {
      toast.info("Nome muito curto", "Cada produto precisa de ao menos 2 letras.");
      return;
    }
    if (!alterados.length) {
      toast.info("Nada para aplicar", "Nenhum nome foi alterado.");
      return;
    }
    start(async () => {
      try {
        const n = await bulkRenameProducts(
          alterados.map((p) => ({ id: p.id, nome: nomes[p.id] })),
        );
        toast.success(
          `${n} ${n === 1 ? "produto renomeado" : "produtos renomeados"}`,
        );
        onAplicado?.();
        onClose();
      } catch (e) {
        toast.error(
          "Não deu para aplicar",
          e instanceof Error ? e.message : "Tente de novo.",
        );
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Alterar nomes"
      description={`${produtos.length} produto${produtos.length === 1 ? "" : "s"} selecionado${produtos.length === 1 ? "" : "s"}.`}
      width="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-sm text-muted">
            {alterados.length
              ? `${alterados.length} nome${alterados.length === 1 ? "" : "s"} alterado${alterados.length === 1 ? "" : "s"}`
              : "Nenhum nome alterado"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={aplicar} disabled={pending || invalido}>
              {pending ? "Salvando…" : `Salvar ${alterados.length || ""}`.trim()}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {produtos.map((p) => (
          <Field key={p.id} label={p.sku}>
            <Input
              value={nomes[p.id] ?? ""}
              onChange={(e) =>
                setNomes((cur) => ({ ...cur, [p.id]: e.target.value }))
              }
              placeholder="Nome do produto"
            />
          </Field>
        ))}
      </div>
    </Sheet>
  );
}
