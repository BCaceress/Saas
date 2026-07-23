"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingCart, ReceiptText, Recycle, Truck, MonitorSmartphone, Lock } from "lucide-react";
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
  moduloAutoatendimento: boolean;
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
      "Frente de caixa completa: caixa por turno, sangria e fechamento.",
  },
  {
    key: "moduloAutoatendimento",
    icon: <MonitorSmartphone size={18} />,
    title: "Autoatendimento (totem)",
    description:
      "Modo quiosque em tela cheia para o cliente comprar sozinho. Funciona junto ou separado do PDV.",
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

export function ModulosClient({
  initial,
  bloqueio,
}: {
  initial: Modulos;
  /** Texto de upgrade por módulo fora do plano. `null` = liberado. */
  bloqueio: Record<keyof Modulos, string | null>;
}) {
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
      {MODULOS.map((m) => {
        const travado = bloqueio[m.key];
        return (
          <SettingCard
            key={m.key}
            icon={m.icon}
            title={m.title}
            description={
              <>
                {m.description}
                {m.emBreve && !travado && (
                  <>
                    {" "}
                    <Badge tone="warn">em breve</Badge>
                  </>
                )}
                {travado && (
                  <span className="mt-1 flex items-center gap-1.5 text-accent">
                    <Lock size={13} />
                    {travado}{" "}
                    <Link href="/configuracoes/plano" className="underline underline-offset-2">
                      Ver planos
                    </Link>
                  </span>
                )}
              </>
            }
            right={
              <Switch
                checked={mods[m.key] && !travado}
                disabled={!!travado}
                onChange={(v) => setMods((prev) => ({ ...prev, [m.key]: v }))}
                label={m.title}
              />
            }
          />
        );
      })}
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
