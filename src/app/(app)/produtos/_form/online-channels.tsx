"use client";

import { ShoppingBag, Store, Truck } from "lucide-react";
import { cn, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { Input, Textarea } from "@/components/ui/input";
import type { SalesChannel } from "@/generated/prisma";
import type { SalesChannelItem } from "../_types";

export type ChannelRow = {
  canal: SalesChannel;
  ativo: boolean;
  precoCanal: string; // mascarado
  descricaoCanal: string;
};

const CHANNELS: { canal: SalesChannel; label: string; icon: React.ReactNode }[] = [
  { canal: "IFOOD", label: "iFood", icon: <Truck size={16} /> },
  { canal: "MERCADO_LIVRE", label: "Mercado Livre", icon: <ShoppingBag size={16} /> },
  { canal: "PROPRIO", label: "Loja própria", icon: <Store size={16} /> },
];

/** Monta as 3 linhas de canal a partir do que já está salvo (ou tudo inativo). */
export function initChannels(existing?: SalesChannelItem[]): ChannelRow[] {
  return CHANNELS.map((c) => {
    const e = existing?.find((x) => x.canal === c.canal);
    return {
      canal: c.canal,
      ativo: e?.ativo ?? false,
      precoCanal: moneyToMask(e?.precoCanal ?? null),
      descricaoCanal: e?.descricaoCanal ?? "",
    };
  });
}

/** Canais ativos prontos p/ a action (preço numérico). Lança se faltar preço. */
export function channelsToInput(rows: ChannelRow[]) {
  return rows
    .filter((r) => r.ativo)
    .map((r) => {
      const preco = parseMoney(r.precoCanal);
      if (preco == null)
        throw new Error(
          `Defina o preço do canal ${CHANNELS.find((c) => c.canal === r.canal)?.label}.`,
        );
      return {
        canal: r.canal,
        precoCanal: preco,
        descricaoCanal: r.descricaoCanal.trim() || undefined,
      };
    });
}

export function OnlineChannels({
  rows,
  onChange,
  descricaoPadrao,
}: {
  rows: ChannelRow[];
  onChange: (canal: SalesChannel, patch: Partial<ChannelRow>) => void;
  descricaoPadrao?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {CHANNELS.map((c) => {
        const row = rows.find((r) => r.canal === c.canal)!;
        return (
          <div
            key={c.canal}
            className={cn(
              "rounded-[var(--radius)] border p-3 transition-colors",
              row.ativo ? "border-brand/30 bg-brand-soft/40" : "border-line bg-surface-2",
            )}
          >
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={row.ativo}
                onChange={(e) => onChange(c.canal, { ativo: e.target.checked })}
                className="cursor-pointer accent-[var(--brand)]"
              />
              <span className={cn("shrink-0", row.ativo ? "text-brand-strong" : "text-faint")}>
                {c.icon}
              </span>
              <span className="text-sm font-medium text-ink-2">{c.label}</span>
            </label>

            {row.ativo && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                    R$
                  </span>
                  <Input
                    value={row.precoCanal}
                    onChange={(e) =>
                      onChange(c.canal, { precoCanal: maskMoney(e.target.value) })
                    }
                    placeholder="0,00"
                    inputMode="numeric"
                    aria-label={`Preço no ${c.label}`}
                    className="bg-surface pl-9 font-mono"
                  />
                </div>
                <Textarea
                  value={row.descricaoCanal}
                  onChange={(e) => onChange(c.canal, { descricaoCanal: e.target.value })}
                  placeholder={
                    descricaoPadrao
                      ? "Vazio = usa a descrição do produto"
                      : "Descrição para este canal (opcional)"
                  }
                  aria-label={`Descrição no ${c.label}`}
                  className="min-h-[44px] bg-surface"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
