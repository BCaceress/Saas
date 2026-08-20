"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Link2,
  Download,
  CheckCircle2,
  CloudDownload,
  FileSignature,
  FileUp,
  Inbox,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Field } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Switch } from "../_ui";
import { enviarCertificadoAction } from "../fiscal/actions";
import {
  consultarSefazAction,
  historicoImportacoesAction,
  iniciarConexaoOauthAction,
  removerCaixaEmailAction,
  salvarCaixaEmailAction,
  salvarManifestacaoAutomaticaAction,
  testarCaixaEmailAction,
  verificarCaixasAction,
} from "./actions";
import type { CaixaView } from "@/lib/fiscal/email-inbox";
import type { LinhaHistorico } from "@/lib/fiscal/import-log";

// ============================================================
// Configuração dos canais de entrada de NF-e.
//
// Três abas porque são três decisões independentes, não três passos: quem
// recebe pouca nota vive de upload; quem tem fornecedor organizado liga o
// e-mail; quem tem certificado A1 deixa a SEFAZ entregar. Dá para usar os três
// ao mesmo tempo — a chave da nota impede a mesma entrar duas vezes.
// ============================================================

type Aba = "upload" | "email" | "sefaz" | "historico";

export type EmitenteResumo = {
  siteId: string;
  cnpj: string;
  razaoSocial: string;
  temCertificado: boolean;
  certificadoTitular: string | null;
  certificadoValidade: string | null;
};

export function NotasFiscaisClient({
  moduloLigado,
  sites,
  caixas,
  historico,
  emitentes,
  provider,
  ambiente,
  providerAtivo,
  manifestacaoAutomatica,
  oauth,
  oauthMotivo,
}: {
  moduloLigado: boolean;
  sites: { id: string; nome: string }[];
  caixas: CaixaView[];
  historico: LinhaHistorico[];
  emitentes: EmitenteResumo[];
  provider: string | null;
  ambiente: string | null;
  providerAtivo: boolean;
  manifestacaoAutomatica: boolean;
  oauth: "ok" | "erro" | null;
  oauthMotivo: string | null;
}) {
  // Voltou do consentimento: abre direto na aba de e-mail, que é onde a
  // resposta faz sentido.
  const [aba, setAba] = React.useState<Aba>(oauth ? "email" : "upload");

  const abas: { id: Aba; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: "upload", label: "Upload manual", icon: <FileUp size={14} /> },
    {
      id: "email",
      label: "E-mail",
      icon: <Mail size={14} />,
      badge: caixas.length > 0 ? String(caixas.length) : undefined,
    },
    { id: "sefaz", label: "Consulta SEFAZ", icon: <CloudDownload size={14} /> },
    { id: "historico", label: "Histórico", icon: <ScrollText size={14} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {!moduloLigado && (
        <Aviso tom="warn">
          O módulo fiscal está desligado no seu plano. Você pode configurar os canais agora,
          mas a importação automática só roda com o módulo ativo.{" "}
          <Link href="/configuracoes/modulos" className="font-medium underline">
            Ver módulos
          </Link>
        </Aviso>
      )}

      {oauth === "ok" && (
        <Aviso tom="brand">
          Conta conectada. A partir de agora a varredura usa o token do provedor — nada de
          senha de aplicativo.
        </Aviso>
      )}
      {oauth === "erro" && (
        <Aviso tom="warn">
          Não deu para conectar a conta{oauthMotivo ? `: ${oauthMotivo}` : "."}
        </Aviso>
      )}

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
        {abas.map((a) => (
          <button
            key={a.id}
            role="tab"
            type="button"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              "-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
              aba === a.id
                ? "border-brand text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {a.icon}
            {a.label}
            {a.badge && (
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {a.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {aba === "upload" && <AbaUpload />}
      {aba === "email" && <AbaEmail caixas={caixas} sites={sites} />}
      {aba === "sefaz" && (
        <AbaSefaz
          sites={sites}
          emitentes={emitentes}
          provider={provider}
          ambiente={ambiente}
          providerAtivo={providerAtivo}
          manifestacaoAutomatica={manifestacaoAutomatica}
        />
      )}
      {aba === "historico" && <AbaHistorico inicial={historico} />}
    </div>
  );
}

// ── Aba 1: upload manual ────────────────────────────────────

function AbaUpload() {
  return (
    <div className="flex flex-col gap-4">
      <Painel
        icon={<Upload size={18} />}
        titulo="Sem configuração"
        descricao="O upload manual já está pronto para usar. Ele é o caminho mais rápido quando o fornecedor manda o XML no WhatsApp ou o contador manda o mês inteiro zipado."
      >
        <ul className="mt-4 flex flex-col gap-2 text-sm text-ink-2">
          <ItemLista>
            Arraste o <strong>XML</strong> da NF-e (modelo 55) ou um <strong>ZIP</strong> com
            vários — o ZIP é aberto e cada nota entra separada.
          </ItemLista>
          <ItemLista>
            A mesma nota não entra duas vezes: a chave de 44 dígitos é a trava, valha ela por
            upload, e-mail ou SEFAZ.
          </ItemLista>
          <ItemLista>
            O <strong>DANFE em PDF</strong> não substitui o XML — ele não traz os itens, e sem
            item não há entrada de estoque. Guarde o PDF, importe o XML.
          </ItemLista>
        </ul>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/recebimento">
            <Button size="sm">
              <FileUp size={15} /> Importar XML agora
            </Button>
          </Link>
          <Link href="/fiscal/notas-recebidas">
            <Button size="sm" variant="secondary">
              Ver notas recebidas
            </Button>
          </Link>
        </div>
      </Painel>
    </div>
  );
}

// ── Aba 2: e-mail (IMAP) ────────────────────────────────────

const PRESETS: Record<string, { host: string; porta: number; ssl: boolean; dica: string }> = {
  gmail: {
    host: "imap.gmail.com",
    porta: 993,
    ssl: true,
    dica: "No Gmail com verificação em duas etapas, gere uma senha de aplicativo em myaccount.google.com/apppasswords.",
  },
  outlook: {
    host: "outlook.office365.com",
    porta: 993,
    ssl: true,
    dica: "No Outlook/Microsoft 365 pode ser preciso habilitar o IMAP e usar senha de aplicativo.",
  },
};

type Autenticacao = "SENHA" | "OAUTH2_GOOGLE" | "OAUTH2_MICROSOFT";

type FormCaixa = {
  id: string | null;
  nome: string;
  email: string;
  host: string;
  porta: string;
  ssl: boolean;
  usuario: string;
  senha: string;
  pasta: string;
  ativo: boolean;
  siteId: string;
  autenticacao: Autenticacao;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthTenantId: string;
};

function formVazio(siteId: string): FormCaixa {
  return {
    id: null,
    nome: "",
    email: "",
    host: "",
    porta: "993",
    ssl: true,
    usuario: "",
    senha: "",
    pasta: "INBOX",
    ativo: true,
    siteId,
    autenticacao: "SENHA",
    oauthClientId: "",
    oauthClientSecret: "",
    oauthTenantId: "",
  };
}

function AbaEmail({
  caixas,
  sites,
}: {
  caixas: CaixaView[];
  sites: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormCaixa | null>(null);
  const [verificando, setVerificando] = React.useState<string | null>(null);

  function verificar(inboxId?: string) {
    setVerificando(inboxId ?? "todas");
    void (async () => {
      try {
        const r = await verificarCaixasAction(inboxId ?? null);
        toast.success(
          r.importadas > 0
            ? `${r.importadas} nota(s) importada(s) de ${r.mensagens} e-mail(s).`
            : `Nenhuma nota nova em ${r.mensagens} e-mail(s) verificado(s).`,
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao verificar a caixa.");
      } finally {
        setVerificando(null);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      <Painel
        icon={<Mail size={18} />}
        titulo="Caixa de e-mail monitorada"
        descricao="O sistema abre a caixa a cada 20 minutos, procura anexos XML e importa as notas. Nada é lido, movido ou apagado na sua caixa."
        acao={
          <div className="flex flex-wrap gap-2">
            {caixas.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={verificando !== null}
                onClick={() => verificar()}
              >
                <RefreshCw size={15} className={verificando ? "animate-spin" : undefined} />
                Verificar agora
              </Button>
            )}
            <Button size="sm" onClick={() => setForm(formVazio(sites[0]?.id ?? ""))}>
              <Plus size={15} /> Adicionar conta
            </Button>
          </div>
        }
      >
        {caixas.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-8 text-center">
            <Inbox size={20} className="mx-auto text-faint" aria-hidden />
            <p className="mt-2 text-sm font-medium text-ink">Nenhuma conta configurada</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
              Use uma caixa dedicada às compras (ex.: notas@seumercado.com.br) e peça ao
              fornecedor para mandar o XML nela. A partir daí a nota chega sozinha na fila de
              recebimento.
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {caixas.map((c) => (
              <CartaoCaixa
                key={c.id}
                caixa={c}
                site={sites.find((s) => s.id === c.siteId)?.nome ?? "—"}
                ocupada={verificando === c.id}
                onVerificar={() => verificar(c.id)}
                onEditar={() =>
                  setForm({
                    id: c.id,
                    nome: c.nome,
                    email: c.email,
                    host: c.host,
                    porta: String(c.porta),
                    ssl: c.ssl,
                    usuario: c.usuario,
                    senha: "",
                    pasta: c.pasta,
                    ativo: c.ativo,
                    siteId: c.siteId,
                    autenticacao: c.autenticacao,
                    oauthClientId: c.oauthClientId ?? "",
                    oauthClientSecret: "",
                    oauthTenantId: c.oauthTenantId ?? "",
                  })
                }
              />
            ))}
          </ul>
        )}
      </Painel>

      {form && (
        <SheetCaixa
          form={form}
          sites={sites}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSalvo={() => {
            setForm(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CartaoCaixa({
  caixa,
  site,
  ocupada,
  onVerificar,
  onEditar,
}: {
  caixa: CaixaView;
  site: string;
  ocupada: boolean;
  onVerificar: () => void;
  onEditar: () => void;
}) {
  const router = useRouter();
  const [removendo, setRemovendo] = React.useState(false);
  const [conectando, setConectando] = React.useState(false);

  /**
   * Manda o operador ao consentimento do provedor. Navegação de página inteira
   * (não popup): o retorno é um redirect do Google/Microsoft, e popup bloqueado
   * deixaria a conexão pela metade sem explicação.
   */
  function conectar() {
    setConectando(true);
    void (async () => {
      try {
        const r = await iniciarConexaoOauthAction({
          inboxId: caixa.id,
          origem: window.location.origin,
        });
        window.location.href = r.url;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao iniciar a conexão.");
        setConectando(false);
      }
    })();
  }

  function remover() {
    if (!window.confirm(`Remover a conta ${caixa.email}? As notas já importadas continuam.`)) {
      return;
    }
    setRemovendo(true);
    void (async () => {
      try {
        await removerCaixaEmailAction(caixa.id);
        toast.success("Conta removida.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao remover a conta.");
      } finally {
        setRemovendo(false);
      }
    })();
  }

  return (
    <li className="rounded-[var(--radius)] border border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{caixa.nome}</p>
            {caixa.ativo ? (
              <Badge tone="ok">
                <Play size={11} /> Ativa
              </Badge>
            ) : (
              <Badge tone="neutral">
                <Pause size={11} /> Pausada
              </Badge>
            )}
            {caixa.ultimoErro && (
              <Badge tone="danger">
                <AlertTriangle size={11} /> Falhou
              </Badge>
            )}
            {caixa.autenticacao !== "SENHA" && (
              <Badge tone={caixa.conectada ? "ok" : "warn"}>
                {caixa.conectada ? "OAuth conectado" : "OAuth pendente"}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[12px] text-muted">
            {caixa.email} · {caixa.host}:{caixa.porta} · {caixa.pasta}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Entrada em <span className="text-ink-2">{site}</span>
            {" · "}
            {caixa.ultimaSincronizacao
              ? `verificada ${fmtQuando(caixa.ultimaSincronizacao)}`
              : "ainda não verificada"}
            {caixa.mensagensLidas > 0 && ` · ${caixa.mensagensLidas} e-mails lidos`}
          </p>
          {caixa.ultimoErro && (
            <p className="mt-2 rounded-[var(--radius-sm)] bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
              {caixa.ultimoErro}
            </p>
          )}
          {caixa.falhasSeguidas > 1 && (
            <p className="mt-1 text-[12px] text-muted">
              {caixa.falhasSeguidas} falhas seguidas — o sistema espaçou as tentativas
              automáticas para o provedor não bloquear a conta. &quot;Verificar&quot; tenta na
              hora.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          {caixa.autenticacao !== "SENHA" && (
            <Button size="sm" variant="secondary" disabled={conectando} onClick={conectar}>
              <Link2 size={14} />
              {caixa.conectada ? "Reconectar" : "Conectar"}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={ocupada} onClick={onVerificar}>
            <RefreshCw size={14} className={ocupada ? "animate-spin" : undefined} />
            Verificar
          </Button>
          <Button size="sm" variant="ghost" onClick={onEditar}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" disabled={removendo} onClick={remover}>
            <Trash2 size={14} />
            <span className="sr-only">Remover conta</span>
          </Button>
        </div>
      </div>
    </li>
  );
}

function SheetCaixa({
  form,
  sites,
  onChange,
  onClose,
  onSalvo,
}: {
  form: FormCaixa;
  sites: { id: string; nome: string }[];
  onChange: (f: FormCaixa) => void;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [salvando, setSalvando] = React.useState(false);
  const [testando, setTestando] = React.useState(false);
  const [teste, setTeste] = React.useState<string | null>(null);
  const [dica, setDica] = React.useState<string | null>(null);
  const redirect =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/fiscal/email/oauth`;

  const set = <K extends keyof FormCaixa>(k: K, v: FormCaixa[K]) =>
    onChange({ ...form, [k]: v });

  function preset(nome: keyof typeof PRESETS) {
    const p = PRESETS[nome];
    onChange({ ...form, host: p.host, porta: String(p.porta), ssl: p.ssl });
    setDica(p.dica);
  }

  function payload() {
    return {
      id: form.id,
      nome: form.nome,
      email: form.email,
      host: form.host,
      porta: form.porta,
      ssl: form.ssl,
      usuario: form.usuario || form.email,
      senha: form.senha,
      pasta: form.pasta,
      ativo: form.ativo,
      siteId: form.siteId,
      autenticacao: form.autenticacao,
      oauthClientId: form.oauthClientId,
      oauthClientSecret: form.oauthClientSecret,
      oauthTenantId: form.oauthTenantId,
    };
  }

  function testar() {
    setTestando(true);
    setTeste(null);
    void (async () => {
      try {
        const r = await testarCaixaEmailAction({
          id: form.id,
          host: form.host,
          porta: form.porta,
          ssl: form.ssl,
          usuario: form.usuario || form.email,
          senha: form.senha,
          pasta: form.pasta,
          autenticacao: form.autenticacao,
        });
        setTeste(`Conectado. ${r.mensagens} mensagem(ns) na pasta ${form.pasta}.`);
        toast.success("Conexão funcionando.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao conectar.");
      } finally {
        setTestando(false);
      }
    })();
  }

  function salvar() {
    setSalvando(true);
    void (async () => {
      try {
        await salvarCaixaEmailAction(payload());
        toast.success("Conta salva. A verificação automática roda a cada 20 minutos.");
        onSalvo();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar a conta.");
      } finally {
        setSalvando(false);
      }
    })();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      title={form.id ? "Editar conta de e-mail" : "Nova conta de e-mail"}
      description="Conexão IMAP somente leitura: o sistema procura anexos XML e importa as notas."
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={testando || (form.autenticacao !== "SENHA" && !form.id)}
            onClick={testar}
          >
            {testando ? "Testando…" : "Testar conexão"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando…" : "Salvar configuração"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">Preencher para:</span>
          <Button size="sm" variant="secondary" onClick={() => preset("gmail")}>
            Gmail
          </Button>
          <Button size="sm" variant="secondary" onClick={() => preset("outlook")}>
            Outlook
          </Button>
        </div>

        {dica && <Aviso tom="brand">{dica}</Aviso>}

        <Field label="Nome da conta" htmlFor="nf-nome" required>
          <Input
            id="nf-nome"
            value={form.nome}
            placeholder="Compras — matriz"
            onChange={(e) => set("nome", e.target.value)}
          />
        </Field>

        <Field label="E-mail" htmlFor="nf-email" required>
          <Input
            id="nf-email"
            type="email"
            value={form.email}
            placeholder="notas@seumercado.com.br"
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Servidor IMAP" htmlFor="nf-host" required>
            <Input
              id="nf-host"
              value={form.host}
              placeholder="imap.gmail.com"
              onChange={(e) => set("host", e.target.value)}
            />
          </Field>
          <Field label="Porta" htmlFor="nf-porta" required>
            <Input
              id="nf-porta"
              type="number"
              inputMode="numeric"
              value={form.porta}
              className="font-mono"
              onChange={(e) => set("porta", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-line px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">Conexão SSL/TLS</p>
            <p className="text-[12px] text-muted">
              Ligado usa a porta 993 (padrão). Desligue só se o servidor exigir 143.
            </p>
          </div>
          <Switch checked={form.ssl} onChange={(v) => set("ssl", v)} label="Conexão SSL" />
        </div>

        <Field
          label="Usuário"
          htmlFor="nf-usuario"
          hint="Na maioria dos provedores é o próprio e-mail. Deixe em branco para usar o e-mail acima."
        >
          <Input
            id="nf-usuario"
            value={form.usuario}
            onChange={(e) => set("usuario", e.target.value)}
          />
        </Field>

        <Field
          label="Autenticação"
          htmlFor="nf-auth"
          hint="O Microsoft 365 já desligou senha no IMAP em boa parte das contas — nesses casos, use OAuth."
        >
          <Select
            id="nf-auth"
            value={form.autenticacao}
            onChange={(e) => set("autenticacao", e.target.value as Autenticacao)}
          >
            <option value="SENHA">Senha de aplicativo</option>
            <option value="OAUTH2_GOOGLE">OAuth — Google</option>
            <option value="OAUTH2_MICROSOFT">OAuth — Microsoft</option>
          </Select>
        </Field>

        {form.autenticacao === "SENHA" ? (
          <Field
            label={form.id ? "Senha (deixe em branco para manter)" : "Senha de aplicativo"}
            htmlFor="nf-senha"
            required={!form.id}
            hint="Guardada cifrada. Contas com verificação em duas etapas exigem senha de aplicativo."
          >
            <Input
              id="nf-senha"
              type="password"
              autoComplete="new-password"
              value={form.senha}
              onChange={(e) => set("senha", e.target.value)}
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface-2/40 p-4">
            <p className="text-[12px] text-muted">
              O aplicativo OAuth é da sua empresa, não do NoHub: crie um no painel do provedor
              e registre esta URL de retorno.
            </p>
            <code className="block overflow-x-auto rounded-[var(--radius-sm)] bg-surface px-3 py-2 font-mono text-[12px] text-ink">
              {redirect}
            </code>

            <Field label="ID do cliente" htmlFor="nf-oauth-id" required>
              <Input
                id="nf-oauth-id"
                value={form.oauthClientId}
                onChange={(e) => set("oauthClientId", e.target.value)}
              />
            </Field>
            <Field
              label={form.id ? "Segredo (em branco mantém)" : "Segredo do cliente"}
              htmlFor="nf-oauth-secret"
              hint="Guardado cifrado."
            >
              <Input
                id="nf-oauth-secret"
                type="password"
                autoComplete="new-password"
                value={form.oauthClientSecret}
                onChange={(e) => set("oauthClientSecret", e.target.value)}
              />
            </Field>
            {form.autenticacao === "OAUTH2_MICROSOFT" && (
              <Field
                label="ID do diretório (tenant)"
                htmlFor="nf-oauth-tenant"
                hint="Deixe em branco para usar “common”."
              >
                <Input
                  id="nf-oauth-tenant"
                  value={form.oauthTenantId}
                  onChange={(e) => set("oauthTenantId", e.target.value)}
                />
              </Field>
            )}
            <p className="text-[12px] text-muted">
              Salve a conta e use <strong>Conectar</strong> no cartão dela para autorizar o
              acesso — é aí que o provedor devolve o token.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pasta monitorada" htmlFor="nf-pasta" required>
            <Input
              id="nf-pasta"
              value={form.pasta}
              placeholder="INBOX"
              className="font-mono"
              onChange={(e) => set("pasta", e.target.value)}
            />
          </Field>
          <Field
            label="Loja de entrada"
            htmlFor="nf-site"
            required
            hint="Onde a mercadoria destas notas entra."
          >
            <Select
              id="nf-site"
              value={form.siteId}
              onChange={(e) => set("siteId", e.target.value)}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-line px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">Verificação automática</p>
            <p className="text-[12px] text-muted">
              Pausar mantém a conta salva, mas o job deixa de abrir a caixa.
            </p>
          </div>
          <Switch
            checked={form.ativo}
            onChange={(v) => set("ativo", v)}
            label="Verificação automática"
          />
        </div>

        {teste && (
          <p className="flex items-center gap-2 text-[13px] text-ok">
            <CheckCircle2 size={14} /> {teste}
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ── Aba 3: consulta SEFAZ ───────────────────────────────────

function AbaSefaz({
  sites,
  emitentes,
  provider,
  ambiente,
  providerAtivo,
  manifestacaoAutomatica,
}: {
  sites: { id: string; nome: string }[];
  emitentes: EmitenteResumo[];
  provider: string | null;
  ambiente: string | null;
  providerAtivo: boolean;
  manifestacaoAutomatica: boolean;
}) {
  const router = useRouter();
  const [consultando, setConsultando] = React.useState(false);
  const [ciencia, setCiencia] = React.useState(manifestacaoAutomatica);

  function alternarCiencia(valor: boolean) {
    setCiencia(valor);
    void (async () => {
      try {
        await salvarManifestacaoAutomaticaAction(valor);
        toast.success(
          valor
            ? "Ciência automática ligada — notas de fornecedor conhecido chegam completas."
            : "Ciência automática desligada.",
        );
        router.refresh();
      } catch (e) {
        setCiencia(!valor);
        toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    })();
  }
  const distribuicaoOk = provider === "NUVEM_FISCAL" && emitentes.some((e) => e.temCertificado);

  function consultar() {
    setConsultando(true);
    void (async () => {
      try {
        const r = await consultarSefazAction();
        toast.success(
          `${r.consultadas} documento(s) na SEFAZ · ${r.importadas} importado(s) · ` +
            `${r.aguardandoManifestacao} aguardando manifestação.`,
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao consultar a SEFAZ.");
      } finally {
        setConsultando(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      <Painel
        icon={<CloudDownload size={18} />}
        titulo="Notas emitidas contra o seu CNPJ"
        descricao="Com certificado A1 configurado, a SEFAZ entrega a lista do que os fornecedores faturaram para você — mesmo o que ninguém mandou por e-mail."
        acao={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!distribuicaoOk || consultando} onClick={consultar}>
              <CloudDownload size={15} /> {consultando ? "Consultando…" : "Consultar NF-es"}
            </Button>
            <Link href="/fiscal/notas-recebidas">
              <Button size="sm" variant="secondary">
                Fila de manifestação
              </Button>
            </Link>
          </div>
        }
      >
        <div className="mt-4 grid gap-2 text-[13px]">
          <Requisito
            ok={provider === "NUVEM_FISCAL"}
            texto={
              provider === "NUVEM_FISCAL"
                ? `Provedor Nuvem Fiscal (${ambiente === "PRODUCAO" ? "produção" : "homologação"}${providerAtivo ? "" : ", inativo"})`
                : "Provedor: a consulta à SEFAZ exige a Nuvem Fiscal"
            }
            href="/configuracoes/fiscal"
          />
          <Requisito
            ok={emitentes.length > 0}
            texto={
              emitentes.length > 0
                ? `${emitentes.length} loja(s) com dados fiscais preenchidos`
                : "Dados fiscais da loja (CNPJ, IE, endereço) ainda não preenchidos"
            }
            href="/configuracoes/fiscal"
          />
          <Requisito
            ok={emitentes.some((e) => e.temCertificado)}
            texto={
              emitentes.some((e) => e.temCertificado)
                ? "Certificado A1 enviado"
                : "Certificado A1 ainda não enviado"
            }
          />
        </div>

        <p className="mt-4 text-[12px] text-muted">
          A SEFAZ devolve primeiro um resumo (chave, emitente, valor). O XML completo — com os
          itens — só libera depois da manifestação do destinatário, feita na fila de notas
          recebidas. Por isso o resumo não vira entrada de estoque sozinho.
        </p>
      </Painel>

      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">
              Dar ciência automaticamente
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              A SEFAZ só entrega o XML completo depois da manifestação. Com isto ligado, o
              sistema dá <strong>ciência da operação</strong> sozinho nas notas de fornecedor
              já cadastrado — e a nota chega pronta para conferir.
            </p>
          </div>
          <Switch
            checked={ciencia}
            onChange={alternarCiencia}
            label="Ciência automática"
            disabled={!distribuicaoOk}
          />
        </div>
        <p className="mt-4 border-t border-line pt-3 text-[12px] text-muted">
          Nunca damos &quot;confirmação da operação&quot; sozinhos: isso declara que a
          mercadoria chegou, e quem diz isso é a conferência na porta. Manifestação não tem
          desfazer na SEFAZ.
        </p>
      </div>

      <Painel
        icon={<FileSignature size={18} />}
        titulo="Certificado digital A1"
        descricao="O arquivo .pfx vai para o provedor e não fica no nosso banco: guardamos só o titular e a validade."
      >
        {sites.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Cadastre uma loja primeiro.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {sites.map((s) => (
              <CertificadoLoja
                key={s.id}
                site={s}
                emitente={emitentes.find((e) => e.siteId === s.id) ?? null}
              />
            ))}
          </ul>
        )}
      </Painel>
    </div>
  );
}

function CertificadoLoja({
  site,
  emitente,
}: {
  site: { id: string; nome: string };
  emitente: EmitenteResumo | null;
}) {
  const router = useRouter();
  const [senha, setSenha] = React.useState("");
  const [arquivo, setArquivo] = React.useState<{ nome: string; base64: string } | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  const dias = emitente?.certificadoValidade ? diasAte(emitente.certificadoValidade) : null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("Arquivo grande demais para um certificado A1. Confira se é o .pfx correto.");
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    setArquivo({ nome: file.name, base64: btoa(bin) });
  }

  function enviar() {
    if (!arquivo) return toast.error("Escolha o arquivo .pfx do certificado.");
    if (!senha) return toast.error("Informe a senha do certificado.");
    setEnviando(true);
    void (async () => {
      try {
        const r = await enviarCertificadoAction({
          siteId: site.id,
          arquivoBase64: arquivo.base64,
          senha,
        });
        toast.success(
          `Certificado validado: ${r.titular ?? "titular não informado"}${
            r.validade ? ` · vence ${fmtData(String(r.validade))}` : ""
          }.`,
        );
        setArquivo(null);
        setSenha("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao validar o certificado.");
      } finally {
        setEnviando(false);
      }
    })();
  }

  return (
    <li className="rounded-[var(--radius)] border border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{site.nome}</p>
          {emitente ? (
            <p className="mt-0.5 font-mono text-[12px] text-muted">
              {emitente.cnpj} · {emitente.razaoSocial}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-muted">
              Sem dados fiscais.{" "}
              <Link href="/configuracoes/fiscal" className="underline">
                Preencher agora
              </Link>
            </p>
          )}
        </div>

        {emitente?.temCertificado ? (
          dias != null && dias <= 0 ? (
            <Badge tone="danger">
              <AlertTriangle size={11} /> Vencido
            </Badge>
          ) : dias != null && dias <= 30 ? (
            <Badge tone="warn">
              <AlertTriangle size={11} /> Vence em {dias} dia(s)
            </Badge>
          ) : (
            <Badge tone="ok">
              <BadgeCheck size={11} /> Válido
            </Badge>
          )
        ) : (
          <Badge tone="neutral">Sem certificado</Badge>
        )}
      </div>

      {emitente?.temCertificado && (
        <p className="mt-2 text-[12px] text-muted">
          {emitente.certificadoTitular ?? "Titular não informado"}
          {emitente.certificadoValidade &&
            ` · válido até ${fmtData(emitente.certificadoValidade)}`}
        </p>
      )}

      {emitente && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pfx,.p12"
              className="sr-only"
              onChange={(e) => void onFile(e)}
            />
            <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line-button bg-surface px-4 text-[13px] font-medium text-ink hover:bg-surface-2">
              <Upload size={14} /> {arquivo ? arquivo.nome : "Escolher .pfx"}
            </span>
          </label>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Senha do certificado"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="h-9 w-52"
          />
          <Button size="sm" disabled={enviando} onClick={enviar}>
            {enviando ? "Validando…" : "Validar e salvar"}
          </Button>
        </div>
      )}
    </li>
  );
}

// ── Aba 4: histórico ────────────────────────────────────────

const ORIGEM_ROTULO: Record<string, string> = {
  UPLOAD: "Upload",
  EMAIL: "E-mail",
  SEFAZ: "SEFAZ",
};

const STATUS_BADGE: Record<string, { tom: "ok" | "neutral" | "warn" | "danger"; label: string }> =
  {
    IMPORTADA: { tom: "ok", label: "Importada" },
    DUPLICADA: { tom: "neutral", label: "Já existia" },
    IGNORADA: { tom: "neutral", label: "Ignorada" },
    ERRO: { tom: "danger", label: "Erro" },
  };

function AbaHistorico({ inicial }: { inicial: LinhaHistorico[] }) {
  const [linhas, setLinhas] = React.useState(inicial);
  const [carregando, setCarregando] = React.useState(false);
  const [mes, setMes] = React.useState(new Date().toISOString().slice(0, 7));

  // O contador pede o mês fechado, não nota a nota. As datas saem do <input
  // type="month"> — dia 1 até o último dia daquele mês.
  const [ano, mesNum] = mes.split("-").map(Number);
  const primeiroDia = `${mes}-01`;
  const ultimoDia = `${mes}-${String(new Date(ano, mesNum, 0).getDate()).padStart(2, "0")}`;

  function recarregar() {
    setCarregando(true);
    void (async () => {
      try {
        setLinhas(await historicoImportacoesAction(120));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar o histórico.");
      } finally {
        setCarregando(false);
      }
    })();
  }

  return (
    <Painel
      icon={<ScrollText size={18} />}
      titulo="Histórico de importações"
      descricao="Todo arquivo visto por qualquer canal — inclusive o que foi recusado por já existir. É aqui que se descobre por que uma nota não apareceu, e de onde sai o pacote de XMLs do contador."
      acao={
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Mês do pacote
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="h-9 rounded-[var(--radius)] border border-line-strong bg-surface px-3 font-mono text-[13px] text-ink"
            />
          </label>
          <a href={`/api/fiscal/entrada/export?de=${primeiroDia}&ate=${ultimoDia}`}>
            <Button size="sm" variant="secondary">
              <Download size={15} /> Baixar XMLs do mês
            </Button>
          </a>
          <Button size="sm" variant="secondary" disabled={carregando} onClick={recarregar}>
            <RefreshCw size={15} className={carregando ? "animate-spin" : undefined} />
            Atualizar
          </Button>
        </div>
      }
    >
      {linhas.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          Nenhuma importação registrada ainda.
        </p>
      ) : (
        <div className="mt-4 -mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
                <th className="px-1 py-2 font-medium">Quando</th>
                <th className="px-1 py-2 font-medium">Canal</th>
                <th className="px-1 py-2 font-medium">Arquivo</th>
                <th className="px-1 py-2 font-medium">Situação</th>
                <th className="px-1 py-2 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {linhas.map((l) => {
                const badge = STATUS_BADGE[l.status] ?? STATUS_BADGE.ERRO;
                return (
                  <tr key={l.id} className="align-top">
                    <td className="px-1 py-2.5 whitespace-nowrap text-muted">
                      {fmtQuando(l.processadoEm)}
                    </td>
                    <td className="px-1 py-2.5 whitespace-nowrap">
                      {ORIGEM_ROTULO[l.origem] ?? l.origem}
                    </td>
                    <td className="max-w-[220px] px-1 py-2.5">
                      <p className="truncate text-ink">{l.arquivo ?? "—"}</p>
                      {l.chave && (
                        <p className="truncate font-mono text-[11px] text-faint">{l.chave}</p>
                      )}
                      {l.remetente && (
                        <p className="truncate text-[11px] text-muted">de {l.remetente}</p>
                      )}
                    </td>
                    <td className="px-1 py-2.5">
                      <Badge tone={badge.tom}>{badge.label}</Badge>
                    </td>
                    <td className="max-w-[280px] px-1 py-2.5 text-muted">
                      <span className="line-clamp-2">{l.mensagem ?? "—"}</span>
                      {l.inboundId && (
                        <Link
                          href={`/recebimento/${l.inboundId}`}
                          className="mt-0.5 block text-[12px] text-brand underline"
                        >
                          Abrir recebimento
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}

// ── Peças compartilhadas ────────────────────────────────────

function Painel({
  icon,
  titulo,
  descricao,
  acao,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            {icon}
          </span>
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">{titulo}</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">{descricao}</p>
          </div>
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

function ItemLista({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function Requisito({ ok, texto, href }: { ok: boolean; texto: string; href?: string }) {
  const conteudo = (
    <span className={cn("flex items-center gap-2", ok ? "text-ink-2" : "text-muted")}>
      {ok ? (
        <CheckCircle2 size={14} className="shrink-0 text-ok" />
      ) : (
        <AlertTriangle size={14} className="shrink-0 text-warn" />
      )}
      {texto}
    </span>
  );
  return href && !ok ? (
    <Link href={href} className="underline-offset-2 hover:underline">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}

function Aviso({ tom, children }: { tom: "warn" | "brand"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-[var(--radius)] px-3.5 py-2.5 text-[13px]",
        tom === "warn" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand-strong",
      )}
    >
      {children}
    </p>
  );
}

function diasAte(iso: string): number {
  const alvo = new Date(iso).getTime();
  return Math.ceil((alvo - Date.now()) / 86_400_000);
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtQuando(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
