"use client";

// Terminais de pagamento — dispositivos que recebem cobranças do PDV e do
// autoatendimento. Linha rica (nome, identificador, loja) + menu de ações;
// vínculo via modal que lista os aparelhos da conta do provedor.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MonitorSmartphone,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { Menu, MenuItem } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import {
  buscarTerminaisAction,
  vincularTerminalAction,
  atualizarTerminalAction,
  removerTerminalAction,
} from "./actions";
import { SectionHeader, StatusDot, type SiteOption, type TerminalVinculado } from "./_shared";
import type { ConfigPagamentoPublica, TerminalInfo } from "@/lib/pagamentos";

export function TerminaisSection({
  config,
  terminais,
  sites,
  siteAtual,
}: {
  config: ConfigPagamentoPublica | null;
  terminais: TerminalVinculado[];
  sites: SiteOption[];
  siteAtual: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [vincularAberto, setVincularAberto] = React.useState(false);
  const [renomear, setRenomear] = React.useState<TerminalVinculado | null>(null);
  const [alterarLoja, setAlterarLoja] = React.useState<TerminalVinculado | null>(null);
  const [desvincular, setDesvincular] = React.useState<TerminalVinculado | null>(null);

  const cartaoIntegradoAtivo = !!(config?.ativo && config.cartaoIntegrado);

  function executar(fn: () => Promise<void>, sucesso: string, aoFinal?: () => void) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(sucesso);
        router.refresh();
        aoFinal?.();
      } catch (e) {
        toast.error("Não foi possível concluir.", e instanceof Error ? e.message : "Tente novamente.");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Terminais de pagamento"
        badge={
          terminais.length > 0 ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] tracking-normal text-muted">
              {terminais.length}
            </span>
          ) : undefined
        }
        description="Vincule os terminais que receberão cobranças diretamente do PDV."
        actions={
          config ? (
            <Button variant="secondary" size="sm" onClick={() => setVincularAberto(true)}>
              <Plus size={14} />
              Vincular terminal
            </Button>
          ) : undefined
        }
      />

      <div className={cn("rounded-[var(--radius-lg)] border border-line bg-surface", !cartaoIntegradoAtivo && terminais.length === 0 && "border-dashed")}>
        {!config ? (
          <p className="px-4 py-4 text-[13px] text-muted sm:px-5">
            Conecte um provedor em <span className="font-medium text-ink-2">Pagamentos integrados</span>{" "}
            para vincular terminais.
          </p>
        ) : terminais.length === 0 ? (
          cartaoIntegradoAtivo ? (
            <div className="flex flex-col items-start gap-2 px-4 py-4 sm:px-5">
              <p className="text-sm font-medium text-ink">Nenhum terminal vinculado</p>
              <p className="text-[13px] text-muted">
                Vincule um terminal para enviar cobranças diretamente do PDV ou autoatendimento.
              </p>
            </div>
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted sm:px-5">
              Nenhum método utiliza terminal integrado. Configure crédito ou débito como{" "}
              <span className="font-medium text-ink-2">Terminal integrado</span> para usar um
              dispositivo conectado.
            </p>
          )
        ) : (
          <div className="divide-y divide-line">
            {terminais.map((t) => (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <span
                  aria-hidden
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"
                >
                  <MonitorSmartphone size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <p className="text-sm font-medium text-ink">{t.nome}</p>
                    <StatusDot tone="ok">Vinculado</StatusDot>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-faint">{t.externalId}</p>
                  <p className="text-[13px] text-muted">{t.siteNome}</p>
                </div>
                <Menu
                  trigger={
                    <button
                      type="button"
                      aria-label={`Ações do terminal ${t.nome}`}
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  }
                >
                  <MenuItem onClick={() => setRenomear(t)}>Renomear</MenuItem>
                  {sites.length > 1 && (
                    <MenuItem onClick={() => setAlterarLoja(t)}>Alterar loja</MenuItem>
                  )}
                  <MenuItem danger onClick={() => setDesvincular(t)}>
                    Desvincular
                  </MenuItem>
                </Menu>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Vincular terminal ── */}
      {vincularAberto && config && (
        <VincularModal
          config={config}
          sites={sites}
          siteAtual={siteAtual}
          jaVinculados={terminais.map((t) => t.externalId)}
          onClose={() => setVincularAberto(false)}
        />
      )}

      {/* ── Renomear ── */}
      {renomear && (
        <RenomearModal
          terminal={renomear}
          pending={pending}
          onClose={() => setRenomear(null)}
          onSalvar={(nome) =>
            executar(
              () => atualizarTerminalAction({ id: renomear.id, nome }),
              "Terminal renomeado",
              () => setRenomear(null)
            )
          }
        />
      )}

      {/* ── Alterar loja ── */}
      {alterarLoja && (
        <AlterarLojaModal
          terminal={alterarLoja}
          sites={sites}
          pending={pending}
          onClose={() => setAlterarLoja(null)}
          onSalvar={(siteId) =>
            executar(
              () => atualizarTerminalAction({ id: alterarLoja.id, siteId }),
              "Loja do terminal atualizada",
              () => setAlterarLoja(null)
            )
          }
        />
      )}

      {/* ── Desvincular (confirmação) ── */}
      <Modal
        open={!!desvincular}
        onClose={() => setDesvincular(null)}
        title={`Desvincular ${desvincular?.nome ?? "terminal"}?`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDesvincular(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() =>
                desvincular &&
                executar(
                  () => removerTerminalAction(desvincular.id),
                  "Terminal desvinculado",
                  () => setDesvincular(null)
                )
              }
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Desvincular
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">
          O PDV e o autoatendimento deixarão de enviar cobranças para este terminal. Você pode
          vinculá-lo de novo quando quiser.
        </p>
      </Modal>
    </section>
  );
}

// ── Modal: vincular terminal ────────────────────────────────
function VincularModal({
  config,
  sites,
  siteAtual,
  jaVinculados,
  onClose,
}: {
  config: ConfigPagamentoPublica;
  sites: SiteOption[];
  siteAtual: string;
  jaVinculados: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // Stone não lista terminais por API — só cadastro pelo número de série
  const somenteSerial = config.provider === "STONE";
  const [encontrados, setEncontrados] = React.useState<TerminalInfo[] | null>(null);
  // a busca inicial dispara no mount — o estado já nasce "buscando"
  const [buscando, setBuscando] = React.useState(!somenteSerial);
  const [selecionado, setSelecionado] = React.useState<string | null>(null);
  const [usarSerial, setUsarSerial] = React.useState(somenteSerial);
  const [serial, setSerial] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [siteId, setSiteId] = React.useState(siteAtual);

  React.useEffect(() => {
    if (somenteSerial) return;
    let ativo = true;
    buscarTerminaisAction()
      .then((r) => {
        if (ativo) setEncontrados(r);
      })
      .catch((e) => {
        if (ativo) {
          toast.error(
            "Não foi possível listar os terminais.",
            e instanceof Error ? e.message : "Tente novamente."
          );
        }
      })
      .finally(() => {
        if (ativo) setBuscando(false);
      });
    return () => {
      ativo = false;
    };
  }, [somenteSerial]);

  async function atualizarLista() {
    setBuscando(true);
    try {
      setEncontrados(await buscarTerminaisAction());
    } catch (e) {
      toast.error(
        "Não foi possível listar os terminais.",
        e instanceof Error ? e.message : "Tente novamente."
      );
    } finally {
      setBuscando(false);
    }
  }

  const externalId = usarSerial ? serial.trim() : selecionado;
  const pronto = !!externalId && nome.trim().length > 0 && !!siteId;

  function vincular() {
    if (!externalId) return;
    startTransition(async () => {
      try {
        await vincularTerminalAction({ siteId, externalId, nome: nome.trim() });
        toast.success("Terminal vinculado");
        router.refresh();
        onClose();
      } catch (e) {
        toast.error(
          "Não foi possível vincular.",
          e instanceof Error ? e.message : "Tente novamente."
        );
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Vincular terminal"
      description={
        somenteSerial
          ? "Informe o número de série do terminal — fica na etiqueta atrás da maquininha."
          : "Selecione um terminal disponível na sua conta."
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button size="sm" onClick={vincular} disabled={pending || !pronto}>
            {pending && <Loader2 size={14} className="animate-spin" />}
            Vincular terminal
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {!usarSerial && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-ink-2">Terminais na conta</p>
              <button
                type="button"
                onClick={atualizarLista}
                disabled={buscando}
                className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                {buscando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Atualizar lista
              </button>
            </div>

            {buscando && !encontrados ? (
              <p className="rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
                Procurando terminais na conta…
              </p>
            ) : encontrados && encontrados.length === 0 ? (
              <p className="rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
                Nenhum dispositivo encontrado. Confira se o terminal está ligado e associado à mesma
                conta da integração.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Terminais disponíveis" className="flex flex-col gap-2">
                {(encontrados ?? []).map((d) => {
                  const vinculado = jaVinculados.includes(d.externalId);
                  const ativo = selecionado === d.externalId;
                  return (
                    <button
                      key={d.externalId}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      disabled={vinculado}
                      onClick={() => setSelecionado(d.externalId)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius)] border p-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        ativo ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded-full border-2",
                          ativo ? "border-brand" : "border-line-strong"
                        )}
                      >
                        {ativo && <span className="h-2 w-2 rounded-full bg-brand" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs text-ink">{d.externalId}</span>
                        {d.operatingMode && d.operatingMode !== "PDV" && !vinculado && (
                          <span className="block text-[11px] text-warn">
                            Modo atual: {d.operatingMode} — ao vincular, mudamos para PDV.
                          </span>
                        )}
                      </span>
                      {vinculado && <span className="shrink-0 text-xs font-medium text-ok">Vinculado</span>}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setUsarSerial(true)}
              className="self-start cursor-pointer text-[13px] font-medium text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Cadastrar pelo número de série
            </button>
          </div>
        )}

        {usarSerial && (
          <Field label="Número de série">
            <Input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Ex.: MP-POINT-0234"
              className="font-mono"
              autoComplete="off"
            />
          </Field>
        )}

        <Field label="Nome do terminal" hint="Como ele aparece no PDV — use o lugar onde fica.">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Maquininha Balcão"
          />
        </Field>

        <Field label="Usar em">
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ── Modal: renomear ─────────────────────────────────────────
function RenomearModal({
  terminal,
  pending,
  onClose,
  onSalvar,
}: {
  terminal: TerminalVinculado;
  pending: boolean;
  onClose: () => void;
  onSalvar: (nome: string) => void;
}) {
  const [nome, setNome] = React.useState(terminal.nome);
  return (
    <Modal
      open
      onClose={onClose}
      title="Renomear terminal"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSalvar(nome.trim())} disabled={pending || !nome.trim()}>
            {pending && <Loader2 size={14} className="animate-spin" />}
            Salvar alterações
          </Button>
        </div>
      }
    >
      <Field label="Nome do terminal">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

// ── Modal: alterar loja ─────────────────────────────────────
function AlterarLojaModal({
  terminal,
  sites,
  pending,
  onClose,
  onSalvar,
}: {
  terminal: TerminalVinculado;
  sites: SiteOption[];
  pending: boolean;
  onClose: () => void;
  onSalvar: (siteId: string) => void;
}) {
  const [siteId, setSiteId] = React.useState(terminal.siteId);
  return (
    <Modal
      open
      onClose={onClose}
      title="Alterar loja do terminal"
      description={`${terminal.nome} · ${terminal.externalId}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => onSalvar(siteId)} disabled={pending || siteId === terminal.siteId}>
            {pending && <Loader2 size={14} className="animate-spin" />}
            Salvar alterações
          </Button>
        </div>
      }
    >
      <Field label="Loja">
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
