"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2, PackageCheck, PackagePlus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { NovaEntradaForm, type Motivo } from "./entradas/nova/_client";
import { fetchEntradaFormDataAction } from "./actions";
import { ENTRADA_SHEET_META } from "./_header";

/** Estado vazio da página de estoque com CTA que abre o lançamento de entrada. */
export function EstoqueEmpty() {
  const router = useRouter();
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  type Data = Awaited<ReturnType<typeof fetchEntradaFormDataAction>>;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    if (motivo && !data) fetchEntradaFormDataAction().then(setData);
  }, [motivo, data]);

  const meta = motivo ? ENTRADA_SHEET_META[motivo] : null;

  return (
    <>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
        <Layers size={36} className="text-faint" />
        <p className="text-sm font-medium text-muted">Nenhum produto com estoque neste site.</p>
        <p className="text-xs text-faint">Registre uma entrada para começar a controlar o estoque.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setMotivo("ESTOQUE_INICIAL")}
            className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <PackageCheck size={15} /> Definir estoque inicial
          </button>
          <button
            type="button"
            onClick={() => setMotivo("COMPRA_SEM_PEDIDO")}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <PackagePlus size={15} className="text-muted" /> Nova entrada
          </button>
        </div>
      </div>

      <Sheet
        open={motivo !== null}
        onClose={() => setMotivo(null)}
        title={meta?.title ?? "Nova movimentação"}
        description={meta?.description ?? ""}
        width="xl"
      >
        {motivo &&
          (data ? (
            <NovaEntradaForm
              {...data}
              motivo={motivo}
              embedded
              onDone={() => {
                setMotivo(null);
                router.refresh();
              }}
            />
          ) : (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-faint" />
            </div>
          ))}
      </Sheet>
    </>
  );
}
