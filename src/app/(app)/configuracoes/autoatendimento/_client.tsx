"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, MonitorSmartphone, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { SettingCard } from "../_ui";
import { updateTotemPin } from "../actions";

const soDigitos = (s: string) => s.replace(/\D/g, "").slice(0, 6);

export function AutoatendimentoConfigClient({
  temPin,
  moduloAtivo,
}: {
  temPin: boolean;
  moduloAtivo: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pin, setPin] = useState("");
  const [confirma, setConfirma] = useState("");

  function salvar() {
    if (pin.length < 4) {
      toast.error("O PIN precisa ter de 4 a 6 dígitos.");
      return;
    }
    if (pin !== confirma) {
      toast.error("Os dois campos não conferem — digite o mesmo PIN.");
      return;
    }
    start(async () => {
      try {
        await updateTotemPin({ pin });
        toast.success("PIN salvo — a saída do quiosque agora exige o PIN.");
        setPin("");
        setConfirma("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function remover() {
    start(async () => {
      try {
        await updateTotemPin({ pin: null });
        toast.success("PIN removido — a saída do quiosque fica livre.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao remover.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!moduloAtivo && (
        <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            O módulo Autoatendimento está desligado — ligue em Configurações →
            Módulos para o totem aparecer no menu.
          </p>
        </div>
      )}

      <SettingCard
        icon={<Lock size={18} />}
        title="PIN de saída do quiosque"
        description={
          temPin
            ? "Um PIN está configurado — o totem só sai do modo quiosque com ele. Defina um novo abaixo ou remova para liberar a saída."
            : "O PIN é pedido para sair do modo quiosque. Sem PIN, a saída é livre."
        }
      >
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field className="max-w-[10rem]" label="Novo PIN (4–6 dígitos)" htmlFor="pin">
            <Input
              id="pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(soDigitos(e.target.value))}
              placeholder="••••"
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
            />
          </Field>
          <Field className="max-w-[10rem]" label="Confirme o PIN" htmlFor="pin-confirma">
            <Input
              id="pin-confirma"
              type="password"
              value={confirma}
              onChange={(e) => setConfirma(soDigitos(e.target.value))}
              placeholder="••••"
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
            />
          </Field>
          <div className="flex gap-2 pb-0.5">
            <Button onClick={salvar} disabled={pending || pin.length < 4}>
              {pending ? "Salvando…" : temPin ? "Trocar PIN" : "Salvar PIN"}
            </Button>
            {temPin && (
              <Button variant="outline" onClick={remover} disabled={pending}>
                Remover PIN
              </Button>
            )}
          </div>
        </div>
      </SettingCard>

      <SettingCard
        icon={<MonitorSmartphone size={18} />}
        title="Abrir o totem"
        description="Abre a tela de autoatendimento em modo quiosque neste dispositivo. Ideal para um tablet dedicado, deixado na loja."
        right={
          moduloAtivo ? (
            <Link
              href="/totem"
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              Abrir totem
            </Link>
          ) : (
            <span className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-faint">
              Módulo desligado
            </span>
          )
        }
      />
    </div>
  );
}
