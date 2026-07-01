"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ReceiptText,
  TriangleAlert,
  Wallet,
  Percent,
  ChartColumnBig,
  Boxes,
  PackageX,
  Truck,
  FileText,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MODELOS, GRUPOS, type Modelo } from "../_modelos";

const ICONS: Record<string, LucideIcon> = {
  ReceiptText,
  TriangleAlert,
  Wallet,
  Percent,
  ChartColumnBig,
  Boxes,
  PackageX,
  Truck,
};

const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "custom", label: "Personalizado" },
];

export function CatalogoDocumentos() {
  const params = useSearchParams();
  const periodoUrl = params.get("periodo") ?? "30d";

  const [sel, setSel] = useState<Modelo | null>(null);
  const [periodo, setPeriodo] = useState(periodoUrl);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  function abrir(m: Modelo) {
    setPeriodo(periodoUrl === "custom" ? "30d" : periodoUrl);
    setDe("");
    setAte("");
    setSel(m);
  }

  function gerar() {
    if (!sel) return;
    const qs = new URLSearchParams();
    if (sel.usaPeriodo) {
      qs.set("periodo", periodo);
      if (periodo === "custom") {
        if (de) qs.set("de", de);
        if (ate) qs.set("ate", ate);
      }
    }
    window.open(`/documento/${sel.id}?${qs.toString()}`, "_blank", "noopener");
    setSel(null);
  }

  return (
    <div className="space-y-8">
      {GRUPOS.map((g) => {
        const modelos = MODELOS.filter((m) => m.grupo === g.id);
        if (modelos.length === 0) return null;
        return (
          <section key={g.id}>
            <div className="mb-3">
              <h2 className="font-display text-base font-bold text-ink">{g.nome}</h2>
              <p className="text-sm text-muted">{g.descricao}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modelos.map((m) => {
                const Icon = ICONS[m.icon] ?? FileText;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => abrir(m)}
                    className="group flex h-full cursor-pointer flex-col gap-3 rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-brand/40 hover:bg-surface-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="grid h-10 w-10 place-items-center rounded-sm bg-brand-softer text-brand">
                        <Icon size={19} />
                      </span>
                      <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted">
                        PDF <ExternalLink size={10} />
                      </span>
                    </div>
                    <div>
                      <h3 className="font-display text-sm font-bold text-ink group-hover:text-brand">{m.nome}</h3>
                      <p className="mt-1 text-[13px] leading-snug text-muted">{m.descricao}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <Modal
        open={!!sel}
        onClose={() => setSel(null)}
        title={sel ? sel.nome : ""}
        description={sel?.usaPeriodo ? "Escolha o período. O documento abre em nova aba para impressão ou PDF." : "O documento abre em nova aba para impressão ou PDF."}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={gerar}>
              <FileText size={15} /> Gerar PDF
            </Button>
          </div>
        }
      >
        {sel?.usaPeriodo ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">Período</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriodo(p.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      periodo === p.id ? "border-brand bg-brand text-on-brand" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {periodo === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">De</label>
                  <input
                    type="date"
                    value={de}
                    onChange={(e) => setDe(e.target.value)}
                    className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Até</label>
                  <input
                    type="date"
                    value={ate}
                    onChange={(e) => setAte(e.target.value)}
                    className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Este relatório usa o <strong className="text-ink">saldo de estoque ao vivo</strong> no momento da emissão — não depende de período.
          </p>
        )}
      </Modal>
    </div>
  );
}
