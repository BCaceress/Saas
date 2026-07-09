"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, ReceiptText, Recycle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Switch, SettingCard } from "../_ui";
import { updateModulos } from "../actions";

type Modulos = {
  moduloPdv: boolean;
  moduloFiscal: boolean;
  moduloComodato: boolean;
  moduloRota: boolean;
};

const MODULOS: {
  key: keyof Modulos;
  icon: React.ReactNode;
  title: string;
  description: string;
  emBreve?: boolean;
}[] = [
  {
    key: "moduloPdv",
    icon: <ShoppingCart size={18} />,
    title: "PDV com operador",
    description:
      "Frente de caixa completa: caixa por turno, sangria e fechamento. Desligado, o app mostra o autoatendimento.",
  },
  {
    key: "moduloFiscal",
    icon: <ReceiptText size={18} />,
    title: "Emissão fiscal",
    description:
      "Emissão de NFC-e nas vendas. A classificação fiscal dos produtos já pode ser preparada em Configurações.",
    emBreve: true,
  },
  {
    key: "moduloComodato",
    icon: <Recycle size={18} />,
    title: "Comodato",
    description:
      "Controle de ativos emprestados a clientes: barris, cilindros e equipamentos.",
    emBreve: true,
  },
  {
    key: "moduloRota",
    icon: <Truck size={18} />,
    title: "Rota de reposição",
    description:
      "Planejamento de rota para abastecer pontos e mercados autônomos.",
    emBreve: true,
  },
];

export function ModulosClient({ initial }: { initial: Modulos }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mods, setMods] = useState(initial);

  const dirty = (Object.keys(initial) as (keyof Modulos)[]).some(
    (k) => mods[k] !== initial[k],
  );

  function salvar() {
    start(async () => {
      try {
        await updateModulos(mods);
        toast.success("Módulos atualizados — o menu já reflete a mudança.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {MODULOS.map((m) => (
        <SettingCard
          key={m.key}
          icon={m.icon}
          title={m.title}
          description={
            <>
              {m.description}
              {m.emBreve && (
                <>
                  {" "}
                  <Badge tone="warn">em breve</Badge>
                </>
              )}
            </>
          }
          right={
            <Switch
              checked={mods[m.key]}
              onChange={(v) => setMods((prev) => ({ ...prev, [m.key]: v }))}
              label={m.title}
            />
          }
        />
      ))}
      <p className="text-xs text-muted">
        Módulos marcados como “em breve” podem ser ligados desde já — a tela
        aparece no menu assim que o módulo for lançado.
      </p>
      <div className="flex justify-end">
        <Button onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar módulos"}
        </Button>
      </div>
    </div>
  );
}
