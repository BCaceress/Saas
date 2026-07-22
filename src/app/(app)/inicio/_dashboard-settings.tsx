"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { saveDashboardWidgetPref } from "./actions";
import { WIDGET_LABEL, type WidgetId } from "./_widgets";

/**
 * Personalização do Centro de Operações: ocultar/reordenar widgets de
 * análise (cabeçalho, assistente e KPIs ficam sempre fixos). Sem drag&drop —
 * setas pra cima/baixo bastam pra reordenar sem dependência extra, e são
 * mais acessíveis via teclado do que arrastar.
 */
export function DashboardSettings({ order, hidden }: { order: WidgetId[]; hidden: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [localOrder, setLocalOrder] = useState<WidgetId[]>(order);
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set(hidden));
  const [pending, startTransition] = useTransition();

  function abrir() {
    setLocalOrder(order);
    setLocalHidden(new Set(hidden));
    setOpen(true);
  }

  function toggle(id: WidgetId) {
    setLocalHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function mover(index: number, dir: -1 | 1) {
    setLocalOrder((prev) => {
      const alvo = index + dir;
      if (alvo < 0 || alvo >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[alvo]] = [next[alvo], next[index]];
      return next;
    });
  }

  function salvar() {
    startTransition(async () => {
      await saveDashboardWidgetPref([...localHidden], localOrder);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label="Personalizar painel"
        title="Personalizar painel"
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink print:hidden"
      >
        <SlidersHorizontal size={15} />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Personalizar painel"
        description="Oculte ou reordene os blocos de análise. Cabeçalho, assistente e indicadores ficam sempre visíveis."
        width="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      >
        <ul className="flex flex-col gap-1.5">
          {localOrder.map((id, i) => {
            const oculto = localHidden.has(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                    aria-label="Mover para cima"
                    className="text-faint transition-colors hover:text-ink disabled:opacity-30"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(i, 1)}
                    disabled={i === localOrder.length - 1}
                    aria-label="Mover para baixo"
                    className="text-faint transition-colors hover:text-ink disabled:opacity-30"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <span className={cn("flex-1 text-sm", oculto ? "text-faint line-through" : "text-ink")}>{WIDGET_LABEL[id]}</span>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={oculto ? "Mostrar widget" : "Ocultar widget"}
                  className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  {oculto ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
