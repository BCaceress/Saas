"use client";

// Sidepanels de modo de processamento por método (Pix, Crédito/Débito).
// Persistem nos flags da config do provedor via atualizarRecursosPagamentoAction.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { atualizarRecursosPagamentoAction } from "./actions";
import { OpcaoModo, PROVIDER_LABEL, StatusDot } from "./_shared";
import type { ConfigPagamentoPublica } from "@/lib/pagamentos";

function useSalvarModo(onClose: () => void) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function salvar(input: { pixAutomatico?: boolean; cartaoIntegrado?: boolean }, sucesso: string) {
    startTransition(async () => {
      try {
        await atualizarRecursosPagamentoAction(input);
        toast.success(sucesso);
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Não foi possível salvar.", e instanceof Error ? e.message : "Tente novamente.");
      }
    });
  }
  return { pending, salvar };
}

/** Bloco "provedor conectado / conectar" reutilizado pelos dois sheets. */
function ProvedorResumo({
  config,
  onConectarProvedor,
}: {
  config: ConfigPagamentoPublica | null;
  onConectarProvedor: () => void;
}) {
  if (config?.ativo) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted">Provedor</p>
          <p className="mt-0.5 text-sm font-medium text-ink">{PROVIDER_LABEL[config.provider]}</p>
        </div>
        <StatusDot tone="ok">Conectado</StatusDot>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3">
      <p className="text-sm text-muted">Nenhum provedor conectado.</p>
      <Button variant="secondary" size="sm" onClick={onConectarProvedor}>
        <PlugZap size={14} />
        Conectar provedor
      </Button>
    </div>
  );
}

function RodapeSalvar({
  onClose,
  onSalvar,
  pending,
  desabilitado,
}: {
  onClose: () => void;
  onSalvar: () => void;
  pending: boolean;
  desabilitado?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
        Cancelar
      </Button>
      <Button size="sm" onClick={onSalvar} disabled={pending || desabilitado}>
        {pending && <Loader2 size={14} className="animate-spin" />}
        Salvar alterações
      </Button>
    </div>
  );
}

// ── Pix ─────────────────────────────────────────────────────
export function PixSheet(props: {
  open: boolean;
  onClose: () => void;
  config: ConfigPagamentoPublica | null;
  onConectarProvedor: () => void;
}) {
  // monta só quando aberto — o estado local nasce do valor salvo
  if (!props.open) return null;
  return <PixSheetInner {...props} />;
}

function PixSheetInner({
  onClose,
  config,
  onConectarProvedor,
}: {
  onClose: () => void;
  config: ConfigPagamentoPublica | null;
  onConectarProvedor: () => void;
}) {
  const automaticoAtual = !!(config?.ativo && config.pixAutomatico);
  const [automatico, setAutomatico] = React.useState(automaticoAtual);
  const { pending, salvar } = useSalvarModo(onClose);

  const sujo = automatico !== automaticoAtual;
  const fechar = () => {
    if (sujo && !window.confirm("Descartar alterações?")) return;
    onClose();
  };

  return (
    <Sheet
      open
      onClose={fechar}
      title="Pix"
      description="Configure como os pagamentos via Pix serão recebidos."
      footer={
        <RodapeSalvar
          onClose={fechar}
          pending={pending}
          desabilitado={!sujo || (automatico && !config)}
          onSalvar={() =>
            salvar({ pixAutomatico: automatico }, automatico ? "Pix automático ativado" : "Pix em modo manual")
          }
        />
      }
    >
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="Método de processamento" className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink-2">Método de processamento</p>
          <OpcaoModo
            selecionado={automatico}
            onSelect={() => setAutomatico(true)}
            titulo="Automático"
            descricao="Gera um QR Code exclusivo para cada venda e confirma o pagamento automaticamente."
          />
          <OpcaoModo
            selecionado={!automatico}
            onSelect={() => setAutomatico(false)}
            titulo="Manual"
            descricao="O pagamento é realizado externamente e confirmado pelo operador no PDV."
          />
        </div>

        {automatico && <ProvedorResumo config={config} onConectarProvedor={onConectarProvedor} />}
        {automatico && !config && (
          <p className="text-[13px] text-muted">
            O modo automático precisa de um provedor conectado para gerar as cobranças.
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ── Crédito / Débito ────────────────────────────────────────
export function CartaoSheet(props: {
  open: boolean;
  tipo: "credito" | "debito";
  onClose: () => void;
  config: ConfigPagamentoPublica | null;
  onConectarProvedor: () => void;
}) {
  if (!props.open) return null;
  return <CartaoSheetInner {...props} />;
}

function CartaoSheetInner({
  tipo,
  onClose,
  config,
  onConectarProvedor,
}: {
  tipo: "credito" | "debito";
  onClose: () => void;
  config: ConfigPagamentoPublica | null;
  onConectarProvedor: () => void;
}) {
  const integradoAtual = !!(config?.ativo && config.cartaoIntegrado);
  const [integrado, setIntegrado] = React.useState(integradoAtual);
  const { pending, salvar } = useSalvarModo(onClose);

  const sujo = integrado !== integradoAtual;
  const fechar = () => {
    if (sujo && !window.confirm("Descartar alterações?")) return;
    onClose();
  };

  return (
    <Sheet
      open
      onClose={fechar}
      title={tipo === "credito" ? "Cartão de crédito" : "Cartão de débito"}
      description="Escolha como a cobrança chega até a maquininha."
      footer={
        <RodapeSalvar
          onClose={fechar}
          pending={pending}
          desabilitado={!sujo || (integrado && !config)}
          onSalvar={() =>
            salvar(
              { cartaoIntegrado: integrado },
              integrado ? "Cartão em terminal integrado" : "Cartão em maquininha externa"
            )
          }
        />
      }
    >
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="Como deseja processar?" className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink-2">Como deseja processar?</p>
          <OpcaoModo
            selecionado={integrado}
            onSelect={() => setIntegrado(true)}
            titulo="Terminal integrado"
            descricao="O valor é enviado automaticamente para o terminal vinculado ao caixa e a venda finaliza após a aprovação."
          />
          <OpcaoModo
            selecionado={!integrado}
            onSelect={() => setIntegrado(false)}
            titulo="Maquininha externa"
            descricao="O operador realiza a cobrança manualmente na maquininha e confirma o pagamento no PDV."
          />
        </div>

        {integrado && (
          <>
            <ProvedorResumo config={config} onConectarProvedor={onConectarProvedor} />
            <div className="rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3">
              <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted">Terminal</p>
              <p className="mt-0.5 text-sm text-ink">Definido pelo caixa</p>
              <p className="mt-1 text-[13px] text-muted">
                Cada caixa ou autoatendimento usa o terminal vinculado a ele — a cobrança nunca vai
                para o aparelho errado.
              </p>
            </div>
          </>
        )}

        <p className="text-[13px] text-muted">
          A forma de processamento vale para crédito e débito.
        </p>
      </div>
    </Sheet>
  );
}
