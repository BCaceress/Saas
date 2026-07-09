"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, PauseCircle, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Switch, SettingCard } from "../_ui";
import { updateEstoqueConfig } from "../actions";

type EstoqueConfig = {
  estoqueMinimoPadrao: number;
  produtoParadoDias: number;
  recebimentoExigeContagem: boolean;
};

export function EstoqueConfigClient({
  initial,
  multiPonto,
}: {
  initial: EstoqueConfig;
  multiPonto: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [minimo, setMinimo] = useState(String(initial.estoqueMinimoPadrao));
  const [parado, setParado] = useState(String(initial.produtoParadoDias));
  const [contagem, setContagem] = useState(initial.recebimentoExigeContagem);

  const dirty =
    Number(minimo) !== initial.estoqueMinimoPadrao ||
    Number(parado) !== initial.produtoParadoDias ||
    contagem !== initial.recebimentoExigeContagem;

  function salvar() {
    const min = Math.max(0, Math.min(9999, Number(minimo) || 0));
    const dias = Math.max(7, Math.min(365, Number(parado) || initial.produtoParadoDias));
    start(async () => {
      try {
        await updateEstoqueConfig({
          estoqueMinimoPadrao: min,
          produtoParadoDias: dias,
          recebimentoExigeContagem: contagem,
        });
        setMinimo(String(min));
        setParado(String(dias));
        toast.success("Configuração de estoque salva.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingCard
        icon={<PackagePlus size={18} />}
        title="Estoque mínimo padrão"
        description="Pré-preenche o campo “mínimo” ao cadastrar um produto novo. Zero desliga o padrão — cada produto pode ajustar o seu."
      >
        <Field className="mt-3 max-w-[10rem]" label="Unidades" htmlFor="minimo">
          <Input
            id="minimo"
            type="number"
            min={0}
            max={9999}
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            inputMode="numeric"
          />
        </Field>
      </SettingCard>

      <SettingCard
        icon={<PauseCircle size={18} />}
        iconTone="warn"
        title="Produto parado"
        description="Depois de quantos dias sem nenhuma movimentação um produto com saldo vira alerta de “estoque parado” no sino."
      >
        <Field className="mt-3 max-w-[10rem]" label="Dias sem movimentar" htmlFor="parado">
          <Input
            id="parado"
            type="number"
            min={7}
            max={365}
            value={parado}
            onChange={(e) => setParado(e.target.value)}
            inputMode="numeric"
          />
        </Field>
      </SettingCard>

      <SettingCard
        icon={<ClipboardCheck size={18} />}
        title="Recebimento com contagem"
        description={
          multiPonto
            ? "Transferências do CD para a loja exigem contagem no destino antes de entrar no estoque (gera estoque em trânsito). Desligado, a expedição confirma sozinha."
            : "Vale para operações com CD e mais de um ponto: exige contagem no destino antes da entrada. Com um ponto só, não muda nada."
        }
        right={
          <Switch
            checked={contagem}
            onChange={setContagem}
            label="Recebimento com contagem"
          />
        }
      />

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}
