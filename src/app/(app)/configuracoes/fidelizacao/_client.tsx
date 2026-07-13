"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Cake, AlertTriangle, MessageCircle, Award, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { tiersFromThresholds } from "@/lib/customers";
import { updateCupomConfig, updateTierConfig } from "../../clientes/actions";
import { Switch } from "../_ui";

export function FidelizacaoClient({
  cupomAutomatico, cupomDiasRisco, tierBronzeMin, tierPrataMin, tierOuroMin, tierDiamanteMin,
}: {
  cupomAutomatico: boolean;
  cupomDiasRisco: number;
  tierBronzeMin: number;
  tierPrataMin: number;
  tierOuroMin: number;
  tierDiamanteMin: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [auto, setAuto] = useState(cupomAutomatico);
  const [dias, setDias] = useState(String(cupomDiasRisco));

  const [bronze, setBronze] = useState(String(tierBronzeMin));
  const [prata, setPrata] = useState(String(tierPrataMin));
  const [ouro, setOuro] = useState(String(tierOuroMin));
  const [diamante, setDiamante] = useState(String(tierDiamanteMin));
  const [tiersPending, startTiers] = useTransition();

  const dirty = auto !== cupomAutomatico || Number(dias) !== cupomDiasRisco;
  const dirtyTiers =
    Number(bronze) !== tierBronzeMin ||
    Number(prata) !== tierPrataMin ||
    Number(ouro) !== tierOuroMin ||
    Number(diamante) !== tierDiamanteMin;

  const previewTiers = tiersFromThresholds({
    bronze: Number(bronze) || 0,
    prata: Number(prata) || 0,
    ouro: Number(ouro) || 0,
    diamante: Number(diamante) || 0,
  }).reverse();

  function salvar() {
    const d = Math.max(1, Math.min(365, Number(dias) || cupomDiasRisco));
    start(async () => {
      try {
        await updateCupomConfig({ cupomAutomatico: auto, cupomDiasRisco: d });
        setDias(String(d));
        toast.success("Configuração salva.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function salvarTiers() {
    const b = Math.max(0, Number(bronze) || 0);
    const p = Math.max(0, Number(prata) || 0);
    const o = Math.max(0, Number(ouro) || 0);
    const d = Math.max(0, Number(diamante) || 0);
    if (!(b < p && p < o && o < d)) {
      toast.error("Cada nível deve exigir um valor maior que o anterior.");
      return;
    }
    startTiers(async () => {
      try {
        await updateTierConfig({ tierBronzeMin: b, tierPrataMin: p, tierOuroMin: o, tierDiamanteMin: d });
        setBronze(String(b));
        setPrata(String(p));
        setOuro(String(o));
        setDiamante(String(d));
        toast.success("Níveis atualizados.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Envio automático */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Gift size={18} />
            </span>
            <div>
              <p className="font-semibold text-ink">Envio automático de cupom</p>
              <p className="mt-0.5 max-w-md text-sm text-muted">
                Quando ligado, os cupons de retorno e aniversário são disparados
                sozinhos pelo WhatsApp. Desligado, você revisa e envia manualmente
                na tela de Clientes.
              </p>
            </div>
          </div>
          <Switch
            checked={auto}
            onChange={setAuto}
            label="Envio automático de cupom"
          />
        </div>
      </div>

      {/* Regra de risco */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warn-soft text-warn">
            <AlertTriangle size={18} />
          </span>
          <div className="flex-1">
            <p className="font-semibold text-ink">Cliente em risco</p>
            <p className="mt-0.5 text-sm text-muted">
              Marcamos como &ldquo;em risco&rdquo; o cliente ativo que fica sem comprar
              por este número de dias.
            </p>
            <Field className="mt-3 max-w-[10rem]" label="Dias sem comprar" htmlFor="dias">
              <Input
                id="dias"
                type="number"
                min={1}
                max={365}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                inputMode="numeric"
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Níveis de fidelização */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Award size={18} />
          </span>
          <div className="flex-1">
            <p className="font-semibold text-ink">Níveis do cliente</p>
            <p className="mt-0.5 text-sm text-muted">
              O nível sobe sozinho conforme o total gasto acumulado. Cliente Cobre é o
              nível inicial (R$ 0) e não é ajustável.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Field label="Cobre — a partir de" htmlFor="tier-cobre">
                <Input id="tier-cobre" type="number" value="0" disabled />
              </Field>
              <Field label="Bronze — a partir de" htmlFor="tier-bronze">
                <Input id="tier-bronze" type="number" min={0} inputMode="numeric" value={bronze} onChange={(e) => setBronze(e.target.value)} />
              </Field>
              <Field label="Prata — a partir de" htmlFor="tier-prata">
                <Input id="tier-prata" type="number" min={0} inputMode="numeric" value={prata} onChange={(e) => setPrata(e.target.value)} />
              </Field>
              <Field label="Ouro — a partir de" htmlFor="tier-ouro">
                <Input id="tier-ouro" type="number" min={0} inputMode="numeric" value={ouro} onChange={(e) => setOuro(e.target.value)} />
              </Field>
              <Field label="Diamante — a partir de" htmlFor="tier-diamante">
                <Input id="tier-diamante" type="number" min={0} inputMode="numeric" value={diamante} onChange={(e) => setDiamante(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {previewTiers.map((t) => (
                <span key={t.key} className={cn("flex items-center gap-1 text-[12px] font-medium", t.text)}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={11} className={i < t.estrelas ? "fill-current" : "opacity-25"} />
                  ))}
                  {t.label.replace("Cliente ", "")}
                </span>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={salvarTiers} disabled={!dirtyTiers || tiersPending}>
                {tiersPending ? "Salvando…" : "Salvar níveis"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Mensagens (prévia) */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <MessageCircle size={15} className="text-brand" /> Mensagens enviadas
        </p>
        <div className="space-y-2 text-[13px]">
          <Preview icon={<AlertTriangle size={13} className="text-warn" />} label="Retorno">
            Oi, [nome]! Sentimos sua falta 💙 Volte e ganhe 10% de desconto na próxima
            compra. Cupom: VOLTA10
          </Preview>
          <Preview icon={<Cake size={13} className="text-accent" />} label="Aniversário">
            Feliz aniversário, [nome]! 🎂 Comemore com a gente: 15% de desconto no seu
            presente. Cupom: NIVER15
          </Preview>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}

function Preview({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] bg-surface-2 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {icon} {label}
      </p>
      <p className="text-ink-2">{children}</p>
    </div>
  );
}
