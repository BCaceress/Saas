"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, ArrowDownCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { SettingCard } from "../_ui";
import { updateCaixaConfig } from "../actions";

type CaixaConfig = {
  caixaFundoTroco: number | null;
  caixaLimiteGaveta: number | null;
};

const toMask = (v: number | null) =>
  v == null
    ? ""
    : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCentavos = (s: string) => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const parseMask = (s: string): number | null => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10) / 100;
};

export function CaixaConfigClient({
  initial,
  moduloPdv,
}: {
  initial: CaixaConfig;
  moduloPdv: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fundo, setFundo] = useState(toMask(initial.caixaFundoTroco));
  const [limite, setLimite] = useState(toMask(initial.caixaLimiteGaveta));

  const dirty =
    parseMask(fundo) !== initial.caixaFundoTroco ||
    parseMask(limite) !== initial.caixaLimiteGaveta;

  function salvar() {
    start(async () => {
      try {
        await updateCaixaConfig({
          caixaFundoTroco: parseMask(fundo),
          caixaLimiteGaveta: parseMask(limite),
        });
        toast.success("Configuração do caixa salva.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!moduloPdv && (
        <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            O módulo PDV está desligado — estas regras passam a valer quando você
            ligá-lo em Configurações → Módulos.
          </p>
        </div>
      )}

      <SettingCard
        icon={<Coins size={18} />}
        title="Fundo de troco padrão"
        description="Valor sugerido ao abrir o caixa. O operador pode ajustar na abertura; vazio deixa o campo em branco."
      >
        <Field className="mt-3 max-w-[12rem]" label="Valor (R$)" htmlFor="fundo">
          <Input
            id="fundo"
            value={fundo}
            onChange={(e) => setFundo(fmtCentavos(e.target.value))}
            placeholder="0,00"
            inputMode="numeric"
            className="tabular-nums"
          />
        </Field>
      </SettingCard>

      <SettingCard
        icon={<ArrowDownCircle size={18} />}
        iconTone="warn"
        title="Limite de dinheiro na gaveta"
        description="Quando o dinheiro em caixa passa deste valor, o painel do caixa sugere uma sangria. Vazio desliga o aviso."
      >
        <Field className="mt-3 max-w-[12rem]" label="Valor (R$)" htmlFor="limite">
          <Input
            id="limite"
            value={limite}
            onChange={(e) => setLimite(fmtCentavos(e.target.value))}
            placeholder="0,00"
            inputMode="numeric"
            className="tabular-nums"
          />
        </Field>
      </SettingCard>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}
