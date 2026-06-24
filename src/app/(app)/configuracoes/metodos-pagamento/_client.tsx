"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import { toggleMetodoPagamentoAction } from "./actions";
import type { PaymentMethod } from "@/generated/prisma";

type SiteMetodos = {
  siteId: string;
  siteNome: string;
  metodos: { metodo: PaymentMethod; ativo: boolean }[];
};

export function MetodosClient({ porSite }: { porSite: SiteMetodos[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(siteId: string, metodo: PaymentMethod, ativo: boolean) {
    setError(null);
    setBusy(siteId + metodo);
    startTransition(async () => {
      try {
        await toggleMetodoPagamentoAction({ siteId, metodo, ativo });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}
      {porSite.map((s) => (
        <div key={s.siteId} className="rounded-[var(--radius-lg)] border border-line bg-surface">
          <p className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">{s.siteNome}</p>
          <div className="divide-y divide-line">
            {s.metodos.map((m) => (
              <label key={m.metodo} className="flex cursor-pointer items-center justify-between px-5 py-3">
                <span className="text-sm text-ink">{PAYMENT_METHOD_LABELS[m.metodo]}</span>
                <span className="flex items-center gap-2">
                  {pending && busy === s.siteId + m.metodo && <Loader2 size={14} className="animate-spin text-muted" />}
                  <input
                    type="checkbox"
                    checked={m.ativo}
                    onChange={(e) => toggle(s.siteId, m.metodo, e.target.checked)}
                    disabled={pending}
                    className="h-5 w-5 accent-[var(--brand)]"
                  />
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
