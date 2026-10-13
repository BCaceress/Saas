"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Warehouse, ShieldCheck, Hash, EyeOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BarraAcoes, SeloEstado, Switch } from "../_ui";
import { updateCamposCadastro } from "../actions";

/**
 * Configurações → Campos do cadastro.
 *
 * Um card por campo, cada um dizendo duas coisas: o que o campo é e onde ele
 * aparece (ou de onde some, quando desligado). Dois cards por linha quando há
 * largura; um por linha no celular.
 */

type Campos = {
  usaMarcas: boolean;
  usaArmazenagem: boolean;
  usaRestricaoIdade: boolean;
  usaSku: boolean;
};

export function CamposCadastroClient({
  initial,
  lojasComControle,
}: {
  initial: Campos;
  /** Lojas ativas que pedem confirmação de idade no caixa. */
  lojasComControle: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [base, setBase] = useState(initial);
  const [marcas, setMarcas] = useState(initial.usaMarcas);
  const [armazenagem, setArmazenagem] = useState(initial.usaArmazenagem);
  const [idade, setIdade] = useState(initial.usaRestricaoIdade);
  const [sku, setSku] = useState(initial.usaSku);
  const [salvoAgora, setSalvoAgora] = useState(false);

  const dirty =
    marcas !== base.usaMarcas ||
    armazenagem !== base.usaArmazenagem ||
    idade !== base.usaRestricaoIdade ||
    sku !== base.usaSku;

  // O selo "salvo" é confirmação, não estado — some sozinho.
  useEffect(() => {
    if (!salvoAgora) return;
    const t = setTimeout(() => setSalvoAgora(false), 4000);
    return () => clearTimeout(t);
  }, [salvoAgora]);

  function salvar() {
    const payload = {
      usaMarcas: marcas,
      usaArmazenagem: armazenagem,
      usaRestricaoIdade: idade,
      usaSku: sku,
    };
    start(async () => {
      try {
        await updateCamposCadastro(payload);
        setBase(payload);
        setSalvoAgora(true);
        toast.success("Configurações de cadastro salvas.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-80 text-sm text-muted">
          Desligue o que sua operação não usa. O campo sai do cadastro, da
          listagem e da edição em lote — o que já está preenchido continua
          gravado e volta a aparecer se você religar.
        </p>
        <SeloEstado dirty={dirty} salvo={salvoAgora} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CampoCard
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
        </CampoCard>

        <CampoCard
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
        </CampoCard>

        <CampoCard
          icon={<ShieldCheck size={18} />}
          title="Venda para maiores de 18"
          description="Bebida alcoólica, cigarro e o que mais só pode sair para adulto."
          right={
            <Switch
              checked={idade}
              onChange={setIdade}
              label="Controlar venda para maiores de 18"
            />
          }
        >
          <ListaEfeito
            ligado={idade}
            itens={[
              "Opção “Venda restrita a maiores de 18 anos” no cadastro do produto",
              "Selo +18 na listagem de produtos",
              "Confirmação de idade no caixa e no totem, nas lojas que controlam",
            ]}
          />
          {/* Diferente dos outros campos, este muda o que o caixa faz — o aviso
              precisa dizer isso com todas as letras antes do Salvar. */}
          {!idade && lojasComControle > 0 && (
            <p className="mt-3 rounded-[var(--radius)] bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <span className="font-mono font-medium">{lojasComControle}</span>{" "}
              {lojasComControle === 1
                ? "loja pede confirmação de idade hoje. Ao salvar, o caixa dela para de pedir."
                : "lojas pedem confirmação de idade hoje. Ao salvar, o caixa delas para de pedir."}
            </p>
          )}
        </CampoCard>

        <CampoCard
          icon={<Hash size={18} />}
          title="SKU"
          description="O código interno do produto, gerado a partir da categoria — BEB-CER-0001."
          right={<Switch checked={sku} onChange={setSku} label="Usar SKU" />}
        >
          <ListaEfeito
            ligado={sku}
            itens={[
              "Campo SKU no cadastro e a etiqueta de SKU no topo da edição",
              "SKU na listagem e na exportação de produtos",
              "Opção “Mostrar SKU” na impressão de etiquetas",
            ]}
          />
          <p className="mt-3 text-[13px] text-muted">
            {sku
              ? "Todo produto tem SKU: quem não informa recebe um gerado ao salvar."
              : "O SKU continua sendo gerado por baixo — só deixa de aparecer. Religar devolve todos."}
          </p>
        </CampoCard>
      </div>

      <BarraAcoes estado={dirty ? "Alterações não salvas." : "Tudo salvo."}>
        <Button size="sm" onClick={salvar} disabled={!dirty || pending}>
          {pending ? "Salvando…" : "Salvar configurações"}
        </Button>
      </BarraAcoes>
    </div>
  );
}

/* ── Peças ──────────────────────────────────────────────────────── */

/**
 * Card de um campo. O corpo fica ABAIXO do cabeçalho, na largura inteira do
 * card — no `SettingCard` ele divide a linha com o ícone e o switch, e em duas
 * colunas sobraria pouco mais de meia largura para o texto.
 */
function CampoCard({
  icon,
  title,
  description,
  right,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  right: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** O que o campo ocupa na tela — vira "o que sai" quando ele desliga. */
function ListaEfeito({ ligado, itens }: { ligado: boolean; itens: string[] }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
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
