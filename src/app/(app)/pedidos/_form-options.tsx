"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { carregarFormOptionsAction } from "./actions";
import { PedidoFormSheet, type FormOptions, type PedidoView } from "./_pedidos";

// ── Catálogo do form, sob demanda ──────────────────────────────
// O `FormOptions` (todo o catálogo + embalagens + saldos + últimos preços
// + lead time) era carregado no servidor a cada abertura de /pedidos e
// serializado inteiro para o browser — a parte mais cara da tela, para uma
// coisa que só existe DEPOIS de clicar em "Novo pedido"/"Editar" ou abrir a
// bonificação. Aqui ele vem uma vez, quando alguém precisa, e fica em memória
// pelo resto da navegação.

type Ctx = {
  options: FormOptions | null;
  carregando: boolean;
  erro: string | null;
  /** Dispara o carregamento (idempotente). */
  garantir: () => void;
};

const FormOptionsContext = createContext<Ctx | null>(null);

export function useFormOptions(): Ctx {
  const ctx = useContext(FormOptionsContext);
  if (!ctx) throw new Error("useFormOptions precisa estar dentro de FormOptionsProvider");
  return ctx;
}

export function FormOptionsProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Guarda a requisição em voo: dois cliques rápidos (ou o drawer + o sheet)
  // não podem virar duas varreduras do catálogo.
  const emVoo = useRef(false);

  const garantir = useCallback(() => {
    if (emVoo.current || options) return;
    emVoo.current = true;
    setCarregando(true);
    setErro(null);
    carregarFormOptionsAction()
      .then((o) => setOptions(o))
      .catch((e: unknown) => {
        emVoo.current = false;
        setErro(e instanceof Error ? e.message : "Não foi possível carregar o catálogo.");
      })
      .finally(() => setCarregando(false));
  }, [options]);

  return (
    <FormOptionsContext.Provider value={{ options, carregando, erro, garantir }}>
      {children}
    </FormOptionsContext.Provider>
  );
}

/**
 * `PedidoFormSheet` monta o carrinho a partir do `formOptions` no primeiro
 * render — então ele só entra em cena com o catálogo em mãos. Enquanto isso o
 * sheet abre igual, mostrando que está buscando: a gaveta responde ao clique
 * na hora, o conteúdo chega em seguida.
 */
export function PedidoFormSheetLazy({
  open,
  onClose,
  mode,
  pedido,
  empresa,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  mode: "novo" | "editar";
  pedido?: PedidoView;
  empresa: string;
  onDone: () => void;
}) {
  const { options, erro, garantir } = useFormOptions();

  useEffect(() => {
    if (open) garantir();
  }, [open, garantir]);

  if (!open) return null;

  if (!options) {
    return (
      <Sheet
        open
        onClose={onClose}
        title={mode === "novo" ? "Novo pedido" : "Editar pedido"}
        description={erro ? "" : "Buscando o catálogo de produtos…"}
        width="xl"
      >
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          {erro ? (
            <>
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
                <TriangleAlert size={22} />
              </span>
              <p className="max-w-sm text-sm text-ink">{erro}</p>
              <button
                type="button"
                onClick={garantir}
                className="mt-1 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                Tentar de novo
              </button>
            </>
          ) : (
            <>
              <Loader2 size={22} className="animate-spin text-muted" />
              <p className="text-sm text-muted">Carregando produtos e fornecedores…</p>
            </>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <PedidoFormSheet
      open
      onClose={onClose}
      mode={mode}
      pedido={pedido}
      formOptions={options}
      empresa={empresa}
      onDone={onDone}
    />
  );
}
