"use client";

// Métodos de pagamento — visão geral em três seções (formas aceitas,
// pagamentos integrados, terminais). Configuração detalhada vive em
// sidepanels; a página responde "o que aceito e como é processado".

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  WalletCards,
  QrCode,
  Ellipsis,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import { toggleMetodoPagamentoAction } from "./actions";
import { PROVIDER_LABEL, SectionHeader, type SiteOption, type TerminalVinculado } from "./_shared";
import { PixSheet, CartaoSheet } from "./_sheets-metodo";
import { IntegracaoSection, IntegracaoSheet } from "./_integracao";
import { TerminaisSection } from "./_terminais";
import type { ConfigPagamentoPublica } from "@/lib/pagamentos";
import type { PaymentMethod } from "@/generated/prisma";

type SiteMetodos = {
  siteId: string;
  siteNome: string;
  metodos: { metodo: PaymentMethod; ativo: boolean }[];
};

const METODO_ICON: Record<PaymentMethod, LucideIcon> = {
  DINHEIRO: Banknote,
  CARTAO_CREDITO: CreditCard,
  CARTAO_DEBITO: WalletCards,
  PIX: QrCode,
  OUTRO: Ellipsis,
};

type Painel = "pix" | "credito" | "debito" | "integracao" | null;

export function MetodosPagamentoClient({
  porSite,
  config,
  terminais,
  sites,
}: {
  porSite: SiteMetodos[];
  config: ConfigPagamentoPublica | null;
  terminais: TerminalVinculado[];
  sites: SiteOption[];
}) {
  const router = useRouter();
  const [siteId, setSiteId] = React.useState(sites[0]?.id ?? "");
  const [painel, setPainel] = React.useState<Painel>(null);

  // switches salvam sozinhos — estado otimista por método + trava enquanto salva
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = React.useState<string | null>(null);

  const site = porSite.find((s) => s.siteId === siteId) ?? porSite[0];

  // Como cada método é processado hoje — o operador entende sem abrir nada.
  const providerNome = config ? PROVIDER_LABEL[config.provider] : null;
  const modoDoMetodo: Record<PaymentMethod, string> = {
    DINHEIRO: "Recebimento direto no caixa",
    PIX:
      config?.ativo && config.pixAutomatico
        ? `Automático via ${providerNome}`
        : "Confirmação manual no caixa",
    CARTAO_CREDITO: config?.ativo && config.cartaoIntegrado ? "Terminal integrado" : "Maquininha externa",
    CARTAO_DEBITO: config?.ativo && config.cartaoIntegrado ? "Terminal integrado" : "Maquininha externa",
    OUTRO: "Outras formas de pagamento",
  };
  const configuravel: Partial<Record<PaymentMethod, Painel>> = {
    PIX: "pix",
    CARTAO_CREDITO: "credito",
    CARTAO_DEBITO: "debito",
  };

  function alternarMetodo(metodo: PaymentMethod, ativo: boolean) {
    if (!site) return;
    const key = `${site.siteId}:${metodo}`;
    setOverrides((o) => ({ ...o, [key]: ativo }));
    setSalvando(key);
    toggleMetodoPagamentoAction({ siteId: site.siteId, metodo, ativo })
      .then(() => {
        toast.success(`${PAYMENT_METHOD_LABELS[metodo]} ${ativo ? "ativado" : "desativado"}`);
        router.refresh();
      })
      .catch((e) => {
        // restaura o switch — o operador precisa saber que não salvou
        setOverrides((o) => ({ ...o, [key]: !ativo }));
        toast.error(
          `Não foi possível ${ativo ? "ativar" : "desativar"} ${PAYMENT_METHOD_LABELS[metodo]}.`,
          e instanceof Error ? e.message : "Tente novamente."
        );
      })
      .finally(() => setSalvando(null));
  }

  if (!site) return null;

  return (
    <div className="flex w-full flex-col gap-7">
      {sites.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seletor-loja">Loja</Label>
          <Select
            id="seletor-loja"
            value={site.siteId}
            onChange={(e) => setSiteId(e.target.value)}
            containerClassName="w-full sm:w-64"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* ── 1 · Formas aceitas ── */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Formas aceitas"
          description="Escolha quais opções estarão disponíveis no checkout."
        />
        <div className="divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface">
          {site.metodos.map(({ metodo, ativo }) => {
            const key = `${site.siteId}:${metodo}`;
            const Icon = METODO_ICON[metodo];
            const valor = overrides[key] ?? ativo;
            const abrePainel = configuravel[metodo];
            return (
              <div key={metodo} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span
                  aria-hidden
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors",
                    valor ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted"
                  )}
                >
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{PAYMENT_METHOD_LABELS[metodo]}</p>
                  <p className="truncate text-[13px] text-muted">{modoDoMetodo[metodo]}</p>
                </div>
                {abrePainel && (
                  <button
                    type="button"
                    onClick={() => setPainel(abrePainel)}
                    className="hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:flex"
                  >
                    <Settings2 size={14} />
                    Configurar
                  </button>
                )}
                {abrePainel && (
                  <button
                    type="button"
                    onClick={() => setPainel(abrePainel)}
                    aria-label={`Configurar ${PAYMENT_METHOD_LABELS[metodo]}`}
                    className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:hidden"
                  >
                    <Settings2 size={15} />
                  </button>
                )}
                <Switch
                  checked={valor}
                  busy={salvando === key}
                  onCheckedChange={(v) => alternarMetodo(metodo, v)}
                  aria-label={`${PAYMENT_METHOD_LABELS[metodo]} aceito no checkout`}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 2 · Pagamentos integrados ── */}
      <IntegracaoSection config={config} onConfigurar={() => setPainel("integracao")} />

      {/* ── 3 · Terminais de pagamento ── */}
      <TerminaisSection
        config={config}
        terminais={sites.length > 1 ? terminais.filter((t) => t.siteId === site.siteId) : terminais}
        sites={sites}
        siteAtual={site.siteId}
      />

      {/* ── Sidepanels ── */}
      <PixSheet
        open={painel === "pix"}
        onClose={() => setPainel(null)}
        config={config}
        onConectarProvedor={() => setPainel("integracao")}
      />
      <CartaoSheet
        open={painel === "credito" || painel === "debito"}
        tipo={painel === "debito" ? "debito" : "credito"}
        onClose={() => setPainel(null)}
        config={config}
        onConectarProvedor={() => setPainel("integracao")}
      />
      <IntegracaoSheet
        open={painel === "integracao"}
        onClose={() => setPainel(null)}
        config={config}
      />
    </div>
  );
}
