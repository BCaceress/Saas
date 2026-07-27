"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, ArrowDownCircle, Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SettingCard } from "../_ui";
import { updateCaixaConfig } from "../actions";

type ControleEstoquePdv = "BLOQUEAR" | "CONFIRMAR" | "IGNORAR";

type CaixaConfig = {
  caixaFundoTroco: number | null;
  caixaLimiteGaveta: number | null;
  controleEstoquePdv: ControleEstoquePdv;
};

const CONTROLE_OPCOES: {
  valor: ControleEstoquePdv;
  titulo: string;
  descricao: string;
}[] = [
  {
    valor: "BLOQUEAR",
    titulo: "Bloquear venda sem estoque",
    descricao: "Produtos zerados não entram na venda. Padrão.",
  },
  {
    valor: "CONFIRMAR",
    titulo: "Permitir venda acima do estoque mediante confirmação",
    descricao: "O operador confirma antes de vender além do saldo.",
  },
  {
    valor: "IGNORAR",
    titulo: "Permitir venda sem validar estoque",
    descricao: "A venda não checa saldo — o estoque pode ir a negativo.",
  },
];

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
  const [controle, setControle] = useState<ControleEstoquePdv>(
    initial.controleEstoquePdv,
  );

  const dirty =
    parseMask(fundo) !== initial.caixaFundoTroco ||
    parseMask(limite) !== initial.caixaLimiteGaveta ||
    controle !== initial.controleEstoquePdv;

  function salvar() {
    start(async () => {
      try {
        await updateCaixaConfig({
          caixaFundoTroco: parseMask(fundo),
          caixaLimiteGaveta: parseMask(limite),
          controleEstoquePdv: controle,
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

      <SettingCard
        icon={<ShieldCheck size={18} />}
        title="Controle de estoque no PDV"
        description="Como a venda reage quando o produto não tem saldo suficiente."
      >
        <div className="mt-3 flex flex-col gap-2">
          {CONTROLE_OPCOES.map((opt) => {
            const ativo = controle === opt.valor;
            return (
              <label
                key={opt.valor}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border px-3 py-2.5 transition-colors",
                  ativo
                    ? "border-brand bg-brand-soft"
                    : "border-line hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="controleEstoquePdv"
                  value={opt.valor}
                  checked={ativo}
                  onChange={() => setControle(opt.valor)}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--brand)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {opt.titulo}
                  </span>
                  <span className="block text-[13px] text-muted">
                    {opt.descricao}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </SettingCard>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}
