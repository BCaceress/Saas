"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Warehouse, EyeOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BarraAcoes, SettingCard, SeloEstado, Switch } from "../_ui";
import { updateCamposCadastro } from "../actions";

/**
 * Configurações → Campos do cadastro.
 *
 * Um card por campo, cada um dizendo três coisas: o que o campo é, o que
 * desaparece quando ele desliga e o que já está preenchido hoje. O número de
 * preenchidos é o que evita a surpresa — desligar esconde, nunca apaga, e quem
 * já usa o campo precisa ver o tamanho do que vai sair da tela.
 */

type Campos = { usaMarcas: boolean; usaArmazenagem: boolean };

type Uso = {
  /** Produtos com marca gravada. */
  produtosComMarca: number;
  /** Saldos com local de armazenagem gravado. */
  produtosComLocal: number;
  /** Locais de armazenagem ativos. */
  locais: number;
};

export function CamposCadastroClient({
  initial,
  uso,
}: {
  initial: Campos;
  uso: Uso;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [base, setBase] = useState(initial);
  const [marcas, setMarcas] = useState(initial.usaMarcas);
  const [armazenagem, setArmazenagem] = useState(initial.usaArmazenagem);
  const [salvoAgora, setSalvoAgora] = useState(false);

  const dirty = marcas !== base.usaMarcas || armazenagem !== base.usaArmazenagem;

  // O selo "salvo" é confirmação, não estado — some sozinho.
  useEffect(() => {
    if (!salvoAgora) return;
    const t = setTimeout(() => setSalvoAgora(false), 4000);
    return () => clearTimeout(t);
  }, [salvoAgora]);

  function salvar() {
    const payload = { usaMarcas: marcas, usaArmazenagem: armazenagem };
    start(async () => {
      try {
        await updateCamposCadastro(payload);
        setBase(payload);
        setSalvoAgora(true);
        toast.success("Campos do cadastro salvos.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Desligue o que sua operação não usa. O campo sai do cadastro, da
          listagem e da edição em lote — o que já está preenchido continua
          gravado e volta a aparecer se você religar.
        </p>
        <SeloEstado dirty={dirty} salvo={salvoAgora} />
      </div>

      <SettingCard
        icon={<Tag size={18} />}
        title="Marca"
        description="A marca do fabricante do produto — Heineken, Ambev, Nestlé."
        right={
          <Switch checked={marcas} onChange={setMarcas} label="Usar marca" />
        }
      >
        <ListaEfeito
          ligado={marcas}
          itens={[
            "Campo Marca no cadastro e na edição do produto",
            "Filtro e coluna Marca na listagem de produtos",
            "Marcas no menu Gerenciar e na edição em lote",
          ]}
        />
        <Preenchido
          n={uso.produtosComMarca}
          singular="produto já tem marca gravada."
          plural="produtos já têm marca gravada."
          vazio="Nenhum produto tem marca gravada hoje."
          esconder={!marcas}
        />
      </SettingCard>

      <SettingCard
        icon={<Warehouse size={18} />}
        title="Local de armazenagem"
        description="Onde a mercadoria fica dentro da loja: geladeira, depósito, prateleira."
        right={
          <Switch
            checked={armazenagem}
            onChange={setArmazenagem}
            label="Usar local de armazenagem"
          />
        }
      >
        <ListaEfeito
          ligado={armazenagem}
          itens={[
            "Campo Local do estoque no cadastro e na edição do produto",
            "Coluna Local na listagem e a troca de local em massa no estoque",
            "Armazenagem no menu Gerenciar e nos locais de cada loja",
          ]}
        />
        <Preenchido
          n={uso.produtosComLocal}
          singular="saldo já tem local gravado."
          plural="saldos já têm local gravado."
          vazio={
            uso.locais > 0
              ? "Nenhum saldo tem local gravado hoje."
              : "Nenhum local de armazenagem cadastrado hoje."
          }
          esconder={!armazenagem}
        />
      </SettingCard>

      <BarraAcoes estado={dirty ? "Alterações não salvas." : "Tudo salvo."}>
        <Button size="sm" onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar configurações"}
        </Button>
      </BarraAcoes>
    </div>
  );
}

/* ── Peças ──────────────────────────────────────────────────────── */

/** O que o campo ocupa na tela — vira "o que sai" quando ele desliga. */
function ListaEfeito({ ligado, itens }: { ligado: boolean; itens: string[] }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
        {ligado ? (
          <>
            <Info size={13} className="shrink-0 text-muted" aria-hidden />
            Aparece em
          </>
        ) : (
          <>
            <EyeOff size={13} className="shrink-0 text-muted" aria-hidden />
            Escondido em
          </>
        )}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {itens.map((t) => (
          <li
            key={t}
            className="flex items-start gap-2 text-[13px] leading-snug text-muted"
          >
            <span
              className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-line-strong"
              aria-hidden
            />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Quanto já foi preenchido. Em âmbar quando o operador acabou de desligar. */
function Preenchido({
  n,
  singular,
  plural,
  vazio,
  esconder,
}: {
  n: number;
  singular: string;
  plural: string;
  vazio: string;
  esconder: boolean;
}) {
  const temDado = n > 0;
  return (
    <p
      className={
        esconder && temDado
          ? "mt-3 rounded-[var(--radius)] bg-warn-soft px-3 py-2 text-[13px] text-warn"
          : "mt-3 text-[13px] text-muted"
      }
    >
      {temDado ? (
        <>
          <span className="font-mono font-medium">{n}</span>{" "}
          {n === 1 ? singular : plural}
          {esconder && " Nada é apagado — o dado só deixa de aparecer."}
        </>
      ) : (
        vazio
      )}
    </p>
  );
}
