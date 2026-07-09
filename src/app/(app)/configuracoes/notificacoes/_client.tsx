"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  PackagePlus,
  Wine,
  Coins,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { CATEGORY_LABEL, type AlertCategory } from "@/lib/alerts-types";
import { Switch, SettingCard } from "../_ui";
import { updateNotificacoes } from "../actions";

const CATEGORIAS: {
  key: AlertCategory;
  icon: React.ReactNode;
  tone: "danger" | "brand" | "accent" | "warn" | "ok";
  description: string;
}[] = [
  {
    key: "criticos",
    icon: <AlertTriangle size={18} />,
    tone: "danger",
    description:
      "Sem estoque, abaixo do mínimo, sem preço de venda e estoque negativo. Recomendamos manter ligado.",
  },
  {
    key: "operacao",
    icon: <PackagePlus size={18} />,
    tone: "brand",
    description:
      "Reposição sugerida, transferências aguardando confirmação, recebimentos e produto parado.",
  },
  {
    key: "consumo",
    icon: <Wine size={18} />,
    tone: "accent",
    description: "Unidades abertas em consumo (garrafas, barris) que merecem atenção.",
  },
  {
    key: "financeiro",
    icon: <Coins size={18} />,
    tone: "warn",
    description: "Produtos sem custo cadastrado, pedidos de compra pendentes e rascunhos.",
  },
  {
    key: "inventario",
    icon: <ClipboardList size={18} />,
    tone: "brand",
    description: "Contagens de inventário em aberto ou atrasadas.",
  },
  {
    key: "inteligencia",
    icon: <Sparkles size={18} />,
    tone: "accent",
    description: "Sugestões de cupom: cliente em risco e aniversariantes.",
  },
];

export function NotificacoesClient({ desativados }: { desativados: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [off, setOff] = useState<Set<string>>(() => new Set(desativados));

  const dirty =
    off.size !== desativados.length || desativados.some((c) => !off.has(c));

  function toggle(cat: AlertCategory, ligado: boolean) {
    setOff((prev) => {
      const next = new Set(prev);
      if (ligado) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function salvar() {
    start(async () => {
      try {
        await updateNotificacoes({
          alertasDesativados: [...off] as AlertCategory[],
        });
        toast.success("Preferências de alerta salvas.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {CATEGORIAS.map((c) => (
        <SettingCard
          key={c.key}
          icon={c.icon}
          iconTone={c.tone}
          title={CATEGORY_LABEL[c.key]}
          description={c.description}
          right={
            <Switch
              checked={!off.has(c.key)}
              onChange={(v) => toggle(c.key, v)}
              label={`Alertas de ${CATEGORY_LABEL[c.key]}`}
            />
          }
        />
      ))}
      <p className="text-xs text-muted">
        Desligar um grupo só esconde os avisos do sino — os dados continuam nos
        relatórios e nas telas de cada módulo.
      </p>
      <div className="flex justify-end">
        <Button onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar preferências"}
        </Button>
      </div>
    </div>
  );
}
