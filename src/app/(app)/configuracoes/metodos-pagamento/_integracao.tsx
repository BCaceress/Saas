"use client";

// Pagamentos integrados — card-resumo na página (sem credenciais à vista)
// e sidepanel "Configurar integração": ambiente, recursos, teste de conexão
// e configuração avançada (token/webhook) recolhida por padrão.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  CreditCard,
  Loader2,
  PlugZap,
  QrCode,
  RefreshCw,
  Settings2,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, Modal } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import {
  salvarProvedorPagamentoAction,
  removerProvedorPagamentoAction,
  testarConexaoPagamentoAction,
  type TesteConexaoResultado,
} from "./actions";
import { PROVIDER_LABEL, SectionHeader, StatusDot } from "./_shared";
import type { ConfigPagamentoPublica } from "@/lib/pagamentos";

type ProviderKind = "MERCADO_PAGO" | "STONE" | "PAGSEGURO" | "SIMULADO";

const WEBHOOK_PATH: Record<string, string> = {
  MERCADO_PAGO: "/api/webhooks/mercadopago",
  STONE: "/api/webhooks/stone",
  PAGSEGURO: "/api/webhooks/pagseguro",
};

const TOKEN_LABEL: Record<string, { label: string; placeholder: string; hint: string }> = {
  MERCADO_PAGO: {
    label: "Access Token (produção)",
    placeholder: "APP_USR-…",
    hint: "Painel do Mercado Pago → Suas integrações → Credenciais de produção.",
  },
  STONE: {
    label: "Secret Key (Pagar.me)",
    placeholder: "sk_…",
    hint: "Dashboard Pagar.me → Configurações → Chaves.",
  },
  PAGSEGURO: {
    label: "Token de aplicação",
    placeholder: "Bearer token PagBank…",
    hint: "Painel PagBank → Minhas aplicações → Token de produção.",
  },
};

// ── Card-resumo na página ───────────────────────────────────
export function IntegracaoSection({
  config,
  onConfigurar,
}: {
  config: ConfigPagamentoPublica | null;
  onConfigurar: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Pagamentos integrados"
        description="Gerencie os serviços utilizados para automatizar cobranças."
      />

      {config?.ativo ? (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {config.provider === "SIMULADO" && (
            <p className="flex items-center gap-2 border-b border-line bg-warn-soft px-5 py-2.5 text-[13px] font-medium text-warn">
              <TriangleAlert size={14} className="shrink-0" />
              Modo de teste ativo — nenhuma cobrança real será realizada.
            </p>
          )}
          <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"
              >
                <PlugZap size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{PROVIDER_LABEL[config.provider]}</p>
                <p className="text-[13px] text-muted">
                  Automatiza pagamentos no PDV e no autoatendimento.
                </p>
              </div>
              <StatusDot tone="ok">Conectado</StatusDot>
            </div>

            <div className="divide-y divide-line rounded-[var(--radius)] border border-line">
              <ResumoRecurso rotulo="Pix automático" ativo={config.pixAutomatico} />
              <ResumoRecurso rotulo="Cartão integrado" ativo={config.cartaoIntegrado} />
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={onConfigurar}>
                <Settings2 size={14} />
                Configurar integração
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Nenhum serviço conectado</p>
            <p className="mt-0.5 text-[13px] text-muted">
              Conecte um provedor para gerar Pix automático e enviar cobranças direto ao terminal.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onConfigurar}>
            <PlugZap size={14} />
            Conectar provedor
          </Button>
        </div>
      )}
    </section>
  );
}

function ResumoRecurso({ rotulo, ativo }: { rotulo: string; ativo: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-ink">{rotulo}</span>
      <span className={cn("text-[13px] font-medium", ativo ? "text-ok" : "text-muted")}>
        {ativo ? "Ativo" : "Desativado"}
      </span>
    </div>
  );
}

// ── Sidepanel "Configurar integração" ───────────────────────
export function IntegracaoSheet(props: {
  open: boolean;
  onClose: () => void;
  config: ConfigPagamentoPublica | null;
}) {
  // monta só quando aberto — o estado local nasce da config salva
  if (!props.open) return null;
  return <IntegracaoSheetInner {...props} />;
}

function IntegracaoSheetInner({
  onClose,
  config,
}: {
  onClose: () => void;
  config: ConfigPagamentoPublica | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [provider, setProvider] = React.useState<ProviderKind>(config?.provider ?? "MERCADO_PAGO");
  const [ultimoReal, setUltimoReal] = React.useState<Exclude<ProviderKind, "SIMULADO">>(
    config && config.provider !== "SIMULADO" ? config.provider : "MERCADO_PAGO"
  );
  const [accessToken, setAccessToken] = React.useState("");
  const [webhookSecret, setWebhookSecret] = React.useState("");
  const [partnerRef, setPartnerRef] = React.useState(config?.partnerRef ?? "");
  const [pixAutomatico, setPixAutomatico] = React.useState(config?.pixAutomatico ?? true);
  const [cartaoIntegrado, setCartaoIntegrado] = React.useState(config?.cartaoIntegrado ?? false);

  const [avancadoAberto, setAvancadoAberto] = React.useState(false);
  const [teste, setTeste] = React.useState<TesteConexaoResultado | null>(null);
  const [testando, setTestando] = React.useState(false);
  const [confirmaDesconectar, setConfirmaDesconectar] = React.useState(false);

  const emTeste = provider === "SIMULADO";
  const trocouProvedor = !!config && provider !== config.provider;
  const sujo =
    !config ||
    trocouProvedor ||
    accessToken !== "" ||
    webhookSecret !== "" ||
    partnerRef !== (config.partnerRef ?? "") ||
    pixAutomatico !== config.pixAutomatico ||
    cartaoIntegrado !== config.cartaoIntegrado;

  const fechar = () => {
    if (config && sujo && !window.confirm("Descartar alterações?")) return;
    onClose();
  };

  function salvar() {
    // trocar de provedor real exige a credencial dele — não reaproveita a antiga
    if (trocouProvedor && provider !== "SIMULADO" && !accessToken.trim()) {
      toast.error(
        `Informe a credencial do ${PROVIDER_LABEL[provider]}.`,
        "A credencial do provedor anterior não vale para o novo."
      );
      setAvancadoAberto(true);
      return;
    }
    startTransition(async () => {
      try {
        await salvarProvedorPagamentoAction({
          provider,
          accessToken,
          webhookSecret,
          partnerRef,
          ativo: true,
          pixAutomatico,
          cartaoIntegrado,
        });
        setAccessToken("");
        setWebhookSecret("");
        toast.success(config ? "Integração salva" : "Provedor conectado");
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Não foi possível salvar.", e instanceof Error ? e.message : "Tente novamente.");
        setAvancadoAberto(true);
      }
    });
  }

  async function testarConexao() {
    setTestando(true);
    setTeste(null);
    try {
      setTeste(await testarConexaoPagamentoAction());
    } catch (e) {
      toast.error("Não foi possível testar.", e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setTestando(false);
    }
  }

  function desconectar() {
    startTransition(async () => {
      try {
        await removerProvedorPagamentoAction();
        toast.success("Integração desconectada", "Os métodos seguem funcionando em modo manual.");
        setConfirmaDesconectar(false);
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Não foi possível desconectar.", e instanceof Error ? e.message : "Tente novamente.");
      }
    });
  }

  const tokenUi = TOKEN_LABEL[provider];
  const webhookPath = WEBHOOK_PATH[provider];
  const webhookUrl =
    typeof window !== "undefined" && webhookPath ? `${window.location.origin}${webhookPath}` : webhookPath;

  return (
    <>
      <Sheet
        open
        onClose={fechar}
        width="lg"
        title={config ? PROVIDER_LABEL[config.provider] : "Conectar provedor"}
        description="Integração utilizada para automatizar pagamentos no PDV e no autoatendimento."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={fechar} disabled={pending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={pending || (!!config && !sujo)}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              {config ? "Salvar alterações" : "Conectar provedor"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {config && (
            <div className="flex items-center justify-between">
              <StatusDot tone="ok">Conectado</StatusDot>
            </div>
          )}

          {/* ── Ambiente ── */}
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] font-medium text-ink-2">Ambiente</p>
            <div
              role="radiogroup"
              aria-label="Ambiente"
              className="grid grid-cols-2 gap-1 rounded-[var(--radius)] border border-line bg-surface-2 p-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={emTeste}
                onClick={() => setProvider("SIMULADO")}
                className={cn(
                  "cursor-pointer rounded-[calc(var(--radius)-4px)] px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  emTeste ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                )}
              >
                Teste
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!emTeste}
                onClick={() => setProvider(ultimoReal)}
                className={cn(
                  "cursor-pointer rounded-[calc(var(--radius)-4px)] px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  !emTeste ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                )}
              >
                Produção
              </button>
            </div>

            {emTeste ? (
              <p className="flex items-start gap-2 rounded-[var(--radius)] bg-warn-soft px-4 py-3 text-[13px] font-medium leading-snug text-warn">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                Modo de teste ativo — as cobranças aprovam sozinhas e nenhum valor real é movimentado.
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-[13px] font-medium leading-snug text-ok">
                <CircleCheck size={15} className="mt-0.5 shrink-0" />
                Pagamentos reais ativos — as cobranças movimentam dinheiro de verdade.
              </p>
            )}

            {!emTeste && (
              <Field label="Provedor">
                <Select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value as Exclude<ProviderKind, "SIMULADO">;
                    setProvider(p);
                    setUltimoReal(p);
                    if (p === "PAGSEGURO") setCartaoIntegrado(false);
                  }}
                >
                  <option value="MERCADO_PAGO">Mercado Pago</option>
                  <option value="STONE">Stone (Pagar.me)</option>
                  <option value="PAGSEGURO">PagSeguro</option>
                </Select>
              </Field>
            )}
          </div>

          {/* ── Recursos ── */}
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] font-medium text-ink-2">Recursos</p>
            <div className="divide-y divide-line rounded-[var(--radius)] border border-line">
              <RecursoLinha
                icon={<QrCode size={16} />}
                titulo="Pix automático"
                descricao="Gera um QR Code exclusivo para cada venda e confirma automaticamente quando o pagamento é recebido."
                checked={pixAutomatico}
                onChange={setPixAutomatico}
              />
              <RecursoLinha
                icon={<CreditCard size={16} />}
                titulo="Cartão integrado"
                descricao={
                  provider === "PAGSEGURO"
                    ? "PagSeguro ainda não oferece envio remoto à maquininha — use maquininha externa."
                    : "Envia o valor da venda diretamente para o terminal vinculado ao caixa."
                }
                checked={cartaoIntegrado}
                onChange={setCartaoIntegrado}
                disabled={provider === "PAGSEGURO"}
              />
            </div>
            {provider === "STONE" && cartaoIntegrado && (
              <Field
                label="Código de parceiro Stone Connect"
                hint="Obtido no Programa de Parcerias Stone — necessário só para o cartão integrado; o Pix funciona sem ele."
              >
                <Input
                  value={partnerRef}
                  onChange={(e) => setPartnerRef(e.target.value)}
                  placeholder="ServiceRefererName"
                  autoComplete="off"
                />
              </Field>
            )}
          </div>

          {/* ── Status da integração ── */}
          {config && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-ink-2">Status da integração</p>
                <Button variant="secondary" size="sm" onClick={testarConexao} disabled={testando}>
                  {testando ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Testar conexão
                </Button>
              </div>

              {teste ? (
                <div className="overflow-hidden rounded-[var(--radius)] border border-line">
                  <p
                    className={cn(
                      "flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-medium",
                      teste.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
                    )}
                  >
                    {teste.ok ? <CircleCheck size={15} /> : <TriangleAlert size={15} />}
                    {teste.ok ? "Integração pronta para uso" : "Integração requer atenção"}
                  </p>
                  <ul className="divide-y divide-line">
                    {teste.itens.map((item) => (
                      <li key={item.rotulo} className="flex items-start gap-2.5 px-4 py-2.5">
                        {item.status === "ok" && <CircleCheck size={15} className="mt-0.5 shrink-0 text-ok" />}
                        {item.status === "warn" && (
                          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
                        )}
                        {item.status === "erro" && <CircleX size={15} className="mt-0.5 shrink-0 text-danger" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{item.rotulo}</p>
                          {item.detalhe && <p className="text-[13px] leading-snug text-muted">{item.detalhe}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[13px] text-muted">
                  Verifica credenciais, Pix, webhook e terminais em um clique.
                </p>
              )}
            </div>
          )}

          {/* ── Configuração avançada (recolhida) ── */}
          <div className="rounded-[var(--radius)] border border-line">
            <button
              type="button"
              onClick={() => setAvancadoAberto((v) => !v)}
              aria-expanded={avancadoAberto}
              className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-medium text-ink">Configuração avançada</span>
              <ChevronDown
                size={16}
                className={cn("text-muted transition-transform", avancadoAberto && "rotate-180")}
                aria-hidden
              />
            </button>

            {avancadoAberto && (
              <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
                {emTeste ? (
                  <p className="text-[13px] text-muted">
                    O ambiente de teste não usa credenciais — conecte um provedor em produção para
                    configurar token e webhook.
                  </p>
                ) : (
                  <>
                    {tokenUi && (
                      <Field label={tokenUi.label} hint={tokenUi.hint}>
                        <Input
                          type="password"
                          value={accessToken}
                          onChange={(e) => setAccessToken(e.target.value)}
                          placeholder={
                            config && !trocouProvedor
                              ? "••••••••••••••••  (deixe vazio para manter)"
                              : tokenUi.placeholder
                          }
                          autoComplete="off"
                        />
                      </Field>
                    )}
                    <Field
                      label="Assinatura secreta do webhook"
                      hint={
                        provider === "STONE"
                          ? "Dash Pagar.me → Webhooks → Basic Auth (formato usuario:senha). Sem webhook, o PDV confirma por consulta a cada 3 segundos."
                          : provider === "PAGSEGURO"
                            ? "Defina uma assinatura própria e cole-a como ?token=… no fim da URL do webhook abaixo, ao cadastrar no painel PagBank. Sem webhook, o PDV confirma por consulta a cada 3 segundos."
                            : "Painel MP → Webhooks → assinatura secreta. Sem webhook, o PDV confirma por consulta a cada 3 segundos."
                      }
                    >
                      <Input
                        type="password"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                        placeholder={
                          config?.temWebhookSecret && !trocouProvedor
                            ? "••••••••••••••••  (deixe vazio para manter)"
                            : "Assinatura gerada no painel do provedor"
                        }
                        autoComplete="off"
                      />
                    </Field>
                    {webhookUrl && (
                      <Field
                        label="URL do webhook"
                        hint="Cadastre esta URL no painel do provedor para confirmação em tempo real."
                      >
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5 font-mono text-xs text-ink-2">
                            {webhookUrl}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(webhookUrl);
                              toast.success("URL copiada");
                            }}
                          >
                            <Copy size={13} />
                            Copiar
                          </Button>
                        </div>
                      </Field>
                    )}
                  </>
                )}

                {config && (
                  <div className="border-t border-line pt-4">
                    <button
                      type="button"
                      onClick={() => setConfirmaDesconectar(true)}
                      className="flex cursor-pointer items-center gap-2 text-sm font-medium text-danger hover:underline"
                    >
                      <Unplug size={15} />
                      Desconectar integração
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Sheet>

      <Modal
        open={confirmaDesconectar}
        onClose={() => setConfirmaDesconectar(false)}
        title={`Desconectar ${config ? PROVIDER_LABEL[config.provider] : "integração"}?`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmaDesconectar(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={desconectar} disabled={pending}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              Desconectar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          O Pix automático e os pagamentos integrados deixarão de funcionar, e os terminais serão
          desvinculados. Os métodos poderão continuar sendo utilizados manualmente.
        </p>
      </Modal>
    </>
  );
}

function RecursoLinha({
  icon,
  titulo,
  descricao,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-4 py-3", disabled && "opacity-60")}>
      <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{titulo}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">{descricao}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={titulo} />
    </div>
  );
}
