"use client";

import { useState, useTransition } from "react";
import {
  BadgeCheck,
  Copy,
  Loader2,
  MessageCircle,
  Send,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { copiarTexto } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_CATEGORIA,
  TEMPLATE_CORPO_SUGERIDO,
  TEMPLATE_PARAMETROS,
} from "@/lib/compras/cotacao-whatsapp";
import { SettingCard, SeloEstado, Switch } from "../_ui";
import {
  desligarWhatsAppAction,
  enviarProvaWhatsAppAction,
  salvarWhatsAppAction,
  testarWhatsAppAction,
} from "./actions";

// ── Configuração do canal WhatsApp ──────────────────────────
// A tela é uma receita, na ordem em que a Meta obriga: o número e a credencial
// primeiro, o template depois (sem ele nada sai) e o webhook por último (sem
// ele o disparo funciona, mas nunca se sabe se chegou).
//
// Credencial não volta do servidor. Campo vazio quer dizer "mantém o que está
// guardado" — e a tela precisa dizer isso, senão o operador acha que perdeu.

type Inicial = {
  provider: "META_CLOUD" | "SIMULADO";
  ativo: boolean;
  phoneNumberId: string;
  wabaId: string;
  numeroExibicao: string;
  templateNome: string;
  templateIdioma: string;
  temToken: boolean;
  temAppSecret: boolean;
};

const VAZIO: Inicial = {
  provider: "META_CLOUD",
  ativo: false,
  phoneNumberId: "",
  wabaId: "",
  numeroExibicao: "",
  templateNome: "cotacao_fornecedor",
  templateIdioma: "pt_BR",
  temToken: false,
  temAppSecret: false,
};

export function ConfiguracaoWhatsApp({
  inicial,
  webhookUrl,
  verifyToken,
}: {
  inicial: Inicial | null | undefined;
  webhookUrl: string;
  verifyToken: string;
}) {
  const base = inicial ?? VAZIO;
  const [form, setForm] = useState({
    provider: base.provider,
    ativo: base.ativo,
    phoneNumberId: base.phoneNumberId,
    wabaId: base.wabaId,
    numeroExibicao: base.numeroExibicao,
    templateNome: base.templateNome,
    templateIdioma: base.templateIdioma,
    accessToken: "",
    appSecret: "",
  });
  const [salvo, setSalvo] = useState(false);
  const [pendente, salvar] = useTransition();
  const [testando, testar] = useTransition();
  const [enviando, enviarProva] = useTransition();
  const [telefoneProva, setTelefoneProva] = useState("");
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);

  const sujo =
    form.provider !== base.provider ||
    form.ativo !== base.ativo ||
    form.phoneNumberId !== base.phoneNumberId ||
    form.wabaId !== base.wabaId ||
    form.numeroExibicao !== base.numeroExibicao ||
    form.templateNome !== base.templateNome ||
    form.templateIdioma !== base.templateIdioma ||
    form.accessToken !== "" ||
    form.appSecret !== "";

  const mudar = <K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setSalvo(false);
  };

  const podeSalvar = form.phoneNumberId.trim().length > 0 && (base.temToken || form.accessToken);

  function gravar() {
    salvar(async () => {
      try {
        await salvarWhatsAppAction(form);
        // O token some do formulário depois de salvo: ele já está guardado, e
        // deixá-lo na tela é uma credencial exposta sem motivo.
        setForm((f) => ({ ...f, accessToken: "", appSecret: "" }));
        setSalvo(true);
        toast.success("Configurações salvas");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  function conferir() {
    testar(async () => {
      const r = await testarWhatsAppAction({
        provider: form.provider,
        phoneNumberId: form.phoneNumberId,
        accessToken: form.accessToken,
      });
      setTeste({
        ok: r.ok,
        texto: r.ok
          ? `Credencial válida${r.numero ? ` — número ${r.numero}` : ""}${r.nome ? ` (${r.nome})` : ""}.`
          : (r.mensagem ?? "Credencial recusada pela Meta."),
      });
      // O número que a Meta devolve é o que o fornecedor vê: melhor gravar
      // isso do que pedir ao operador para digitar de novo, com erro de digitação.
      if (r.ok && r.numero) mudar("numeroExibicao", r.numero);
    });
  }

  function mandarProva() {
    enviarProva(async () => {
      const r = await enviarProvaWhatsAppAction({ telefone: telefoneProva });
      if (r.ok) toast.success(r.mensagem);
      else toast.error(r.mensagem);
    });
  }

  function desligar() {
    salvar(async () => {
      await desligarWhatsAppAction();
      setForm((f) => ({ ...f, ativo: false }));
      toast.success("Disparo automático desligado");
    });
  }

  const copiar = (texto: string, oque: string) => {
    void copiarTexto(texto).then((ok) =>
      ok ? toast.success(`${oque} copiado`) : toast.error(`Não foi possível copiar ${oque}.`),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <SeloEstado dirty={sujo} salvo={salvo} />
      </div>

      {/* ── 1. O canal ─────────────────────────────────── */}
      <SettingCard
        icon={<MessageCircle size={18} />}
        title="Disparo automático"
        description={
          form.ativo
            ? "As cotações saem por este número, sem abrir o WhatsApp. Cada mensagem é cobrada pela Meta."
            : "Desligado, a folha de envio continua abrindo o WhatsApp contato por contato."
        }
        right={
          <Switch
            checked={form.ativo}
            onChange={(v) => mudar("ativo", v)}
            label="Ligar disparo automático"
            disabled={!podeSalvar}
          />
        }
      >
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Provedor</span>
            <select
              value={form.provider}
              onChange={(e) => mudar("provider", e.target.value as Inicial["provider"])}
              className="h-11 rounded-[var(--radius)] border border-line-strong bg-surface px-3 text-sm text-ink"
            >
              <option value="META_CLOUD">WhatsApp Cloud API (Meta)</option>
              <option value="SIMULADO">Simulado (nada sai)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Número (exibição)</span>
            <Input
              value={form.numeroExibicao}
              onChange={(e) => mudar("numeroExibicao", e.target.value)}
              placeholder="+55 51 99999-0000"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">ID do número (phone number ID)</span>
            <Input
              value={form.phoneNumberId}
              onChange={(e) => mudar("phoneNumberId", e.target.value)}
              placeholder="102290129340398"
              className="font-mono text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">
              Conta WhatsApp Business (WABA) <span className="text-faint">— opcional</span>
            </span>
            <Input
              value={form.wabaId}
              onChange={(e) => mudar("wabaId", e.target.value)}
              placeholder="106540352242922"
              className="font-mono text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-2">Token de acesso permanente</span>
            <Input
              type="password"
              value={form.accessToken}
              onChange={(e) => mudar("accessToken", e.target.value)}
              placeholder={base.temToken ? "Guardado — cole outro para trocar" : "EAAG..."}
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-2">
              App Secret <span className="text-faint">— assina o webhook</span>
            </span>
            <Input
              type="password"
              value={form.appSecret}
              onChange={(e) => mudar("appSecret", e.target.value)}
              placeholder={base.temAppSecret ? "Guardado — cole outro para trocar" : "Do painel do app na Meta"}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={gravar} disabled={!podeSalvar || pendente || !sujo}>
            {pendente ? <Loader2 size={15} className="animate-spin" /> : null}
            Salvar configurações
          </Button>
          <Button
            variant="outline"
            onClick={conferir}
            disabled={testando || !form.phoneNumberId.trim()}
          >
            {testando ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            Testar credencial
          </Button>
          {base.ativo && (
            <Button variant="ghost" onClick={desligar} disabled={pendente}>
              Desligar canal
            </Button>
          )}
        </div>

        {teste && (
          <p
            className={cn(
              "mt-3 flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-[13px]",
              teste.ok ? "border-ok/40 bg-ok-soft text-ok" : "border-danger/40 bg-danger-soft text-danger",
            )}
          >
            {teste.ok ? (
              <BadgeCheck size={15} className="mt-0.5 shrink-0" />
            ) : (
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            )}
            {teste.texto}
          </p>
        )}
      </SettingCard>

      {/* ── 2. O template ──────────────────────────────── */}
      <SettingCard
        icon={<Send size={18} />}
        iconTone="accent"
        title="Template da cotação"
        description="Mensagem que a empresa inicia só sai por template aprovado pela Meta. Cadastre o texto abaixo, palavra por palavra, e use o mesmo nome aqui."
      >
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Nome do template</span>
            <Input
              value={form.templateNome}
              onChange={(e) => mudar("templateNome", e.target.value)}
              className="font-mono text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Idioma</span>
            <Input
              value={form.templateIdioma}
              onChange={(e) => mudar("templateIdioma", e.target.value)}
              placeholder="pt_BR"
              className="font-mono text-[13px]"
            />
          </label>
        </div>

        <div className="mt-4 rounded-[var(--radius)] border border-line bg-surface-2 p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">
            Categoria: {TEMPLATE_CATEGORIA}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{TEMPLATE_CORPO_SUGERIDO}</p>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
            {TEMPLATE_PARAMETROS.map((p) => (
              <li key={p} className="font-mono">
                {p}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => copiar(TEMPLATE_CORPO_SUGERIDO, "Texto do template")}
          >
            <Copy size={14} />
            Copiar texto
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">
              Mandar uma prova para o meu WhatsApp
            </span>
            <Input
              value={telefoneProva}
              onChange={(e) => setTelefoneProva(e.target.value)}
              placeholder="51 99999-0000"
              className="w-56"
            />
          </label>
          <Button
            variant="outline"
            onClick={mandarProva}
            disabled={enviando || telefoneProva.trim().length < 8}
          >
            {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Enviar teste
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          Vale o preço de uma mensagem — e é o único jeito de ver, antes do primeiro disparo de
          verdade, se o template foi aprovado com os campos na ordem certa.
        </p>
      </SettingCard>

      {/* ── 3. O webhook ───────────────────────────────── */}
      <SettingCard
        icon={<ShieldCheck size={18} />}
        title="Webhook de status"
        description="Cole no painel da Meta (campo “messages”). É por ele que “entregue” e “lido” voltam para a trilha de envio da cotação."
      >
        <div className="mt-4 flex flex-col gap-3">
          <CampoCopiavel rotulo="URL de callback" valor={webhookUrl} onCopiar={copiar} />
          <CampoCopiavel rotulo="Token de verificação" valor={verifyToken} onCopiar={copiar} />
        </div>
        {!base.temAppSecret && (
          <p className="mt-3 flex items-start gap-2 text-[12px] text-warn">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            Sem o App Secret salvo, o NoHub aceita o webhook sem conferir a assinatura. Cadastre
            antes de ir para produção.
          </p>
        )}
      </SettingCard>
    </div>
  );
}

function CampoCopiavel({
  rotulo,
  valor,
  onCopiar,
}: {
  rotulo: string;
  valor: string;
  onCopiar: (texto: string, oque: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{rotulo}</span>
      <div className="flex items-center gap-2">
        <Input readOnly value={valor} className="font-mono text-[12px]" />
        <Button variant="outline" size="sm" onClick={() => onCopiar(valor, rotulo)}>
          <Copy size={14} />
          Copiar
        </Button>
      </div>
    </div>
  );
}
