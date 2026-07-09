"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Cake, AlertTriangle, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { updateCupomConfig } from "../../clientes/actions";
import { Switch } from "../_ui";

export function FidelizacaoClient({
  cupomAutomatico, cupomDiasRisco,
}: {
  cupomAutomatico: boolean;
  cupomDiasRisco: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [auto, setAuto] = useState(cupomAutomatico);
  const [dias, setDias] = useState(String(cupomDiasRisco));

  const dirty = auto !== cupomAutomatico || Number(dias) !== cupomDiasRisco;

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
