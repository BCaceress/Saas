"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Mail, MessageCircle, Send, UserRound } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { maskPhone } from "@/lib/masks";
import { ContatoSheet } from "@/components/app/contato-fornecedor";
import { SupplierAvatar } from "../_ui";
import type { ConviteCotacao, ContatoConvite } from "../_compra-types";
import { enviarCotacaoAction, type Envio } from "../_compra-actions";

// ── Envio da cotação ────────────────────────────────────────
// Um botão só ("Enviar cotação") e uma folha de conferência: cada fornecedor
// numa linha, com O CONTATO que vai receber e por onde. O principal já vem
// escolhido — o comprador só olha, e troca quando a conversa daquela semana é
// com outro vendedor.
//
// Trocar e cadastrar acontecem AQUI. Descobrir um representante novo no meio
// do envio é rotina; mandar o operador ao cadastro do fornecedor e voltar é o
// desvio que faz o dado nunca ser gravado.

export type Canal = "whatsapp" | "email";

type Escolha = { contactId: string | null; canais: Canal[] };

const temWhatsapp = (c: { telefone: string | null } | null) => Boolean(c?.telefone?.trim());
const temEmail = (c: { email: string | null } | null) => Boolean(c?.email?.trim());

/** Contato que abre selecionado: o gravado no convite, senão o principal. */
function contatoInicial(c: ConviteCotacao, contatos: ContatoConvite[]): ContatoConvite | null {
  return (
    contatos.find((x) => x.id === c.contatoId) ??
    contatos.find((x) => x.principal) ??
    contatos[0] ??
    null
  );
}

/** Canal padrão: WhatsApp quando dá, e-mail quando é o que existe. */
function canaisIniciais(destino: { telefone: string | null; email: string | null } | null): Canal[] {
  if (temWhatsapp(destino)) return ["whatsapp"];
  if (temEmail(destino)) return ["email"];
  return ["whatsapp"];
}

export function EnvioSheet({
  cotacaoId,
  alvos,
  reenvio = false,
  prazoAtual,
  onFechar,
  onEnviado,
}: {
  cotacaoId: string;
  /** Convites que vão receber agora. */
  alvos: ConviteCotacao[];
  /** Reenvio troca o token do link e permite esticar o prazo. */
  reenvio?: boolean;
  prazoAtual: string | null;
  onFechar: () => void;
  onEnviado: (envios: Envio[]) => void;
}) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [prazo, setPrazo] = useState(prazoAtual ? prazoAtual.slice(0, 10) : "");
  /** Contatos cadastrados aqui dentro — a folha não recarrega ao salvar. */
  const [novos, setNovos] = useState<Record<string, ContatoConvite[]>>({});
  const [trocando, setTrocando] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState<ConviteCotacao | null>(null);

  const contatosDe = useMemo(
    () => (c: ConviteCotacao) => [...c.contatos, ...(novos[c.supplierId] ?? [])],
    [novos],
  );

  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>(() => {
    const inicial: Record<string, Escolha> = {};
    for (const c of alvos) {
      const contato = contatoInicial(c, c.contatos);
      inicial[c.id] = {
        contactId: contato?.id ?? null,
        canais: canaisIniciais(contato ?? { telefone: c.telefone, email: c.email }),
      };
    }
    return inicial;
  });

  function destinoDe(c: ConviteCotacao): {
    contato: ContatoConvite | null;
    telefone: string | null;
    email: string | null;
  } {
    const escolha = escolhas[c.id];
    const contato = contatosDe(c).find((x) => x.id === escolha?.contactId) ?? null;
    // Sem contato, o envio cai no telefone/e-mail da empresa — como sempre foi.
    return contato
      ? { contato, telefone: contato.telefone, email: contato.email }
      : { contato: null, telefone: c.telefone, email: c.email };
  }

  function escolherContato(c: ConviteCotacao, contato: ContatoConvite | null) {
    setEscolhas((e) => ({
      ...e,
      [c.id]: {
        contactId: contato?.id ?? null,
        canais: canaisIniciais(contato ?? { telefone: c.telefone, email: c.email }),
      },
    }));
    setTrocando(null);
  }

  function alternarCanal(conviteId: string, canal: Canal) {
    setEscolhas((e) => {
      const atual = e[conviteId]?.canais ?? [];
      const tem = atual.includes(canal);
      // Sempre sobra um canal: cotação sem carteiro não sai do lugar.
      if (tem && atual.length === 1) return e;
      return {
        ...e,
        [conviteId]: {
          contactId: e[conviteId]?.contactId ?? null,
          canais: tem ? atual.filter((x) => x !== canal) : [...atual, canal],
        },
      };
    });
  }

  function enviar() {
    setErro(null);
    start(async () => {
      try {
        const envios = await enviarCotacaoAction({
          quotationId: cotacaoId,
          destinos: alvos.map((c) => ({
            conviteId: c.id,
            contactId: escolhas[c.id]?.contactId ?? null,
            canais: escolhas[c.id]?.canais ?? ["whatsapp"],
          })),
          reenviar: reenvio,
          prazoResposta: reenvio && prazo ? prazo : undefined,
        });
        onEnviado(envios);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível enviar a cotação.");
      }
    });
  }

  const semNinguem = alvos.filter((c) => {
    const d = destinoDe(c);
    return !d.telefone && !d.email;
  }).length;

  return (
    <>
      <Sheet
        open
        onClose={onFechar}
        width="xl"
        title={reenvio ? "Reenviar cotação" : "Enviar cotação"}
        description={
          reenvio
            ? "O link antigo deixa de valer: cada reenvio gera um endereço novo."
            : "Confira quem recebe em cada fornecedor e por onde."
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-muted">
              {alvos.length} {alvos.length === 1 ? "fornecedor" : "fornecedores"}
              {semNinguem > 0 && ` · ${semNinguem} sem contato — a mensagem sai para copiar`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onFechar}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={pendente || alvos.length === 0}
                className="flex items-center gap-1.5 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
              >
                <Send size={15} />
                {pendente ? "Enviando…" : reenvio ? "Reenviar cotação" : "Enviar cotação"}
              </button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {reenvio && (
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <CalendarClock size={12} className="text-faint" />
                Novo prazo de resposta <span className="text-faint">(opcional)</span>
              </span>
              <input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink sm:w-56"
              />
            </label>
          )}

          <ul className="divide-y divide-line rounded-[var(--radius-lg)] border border-line">
            {alvos.map((c) => {
              const contatos = contatosDe(c);
              const destino = destinoDe(c);
              const canais = escolhas[c.id]?.canais ?? [];
              const aberto = trocando === c.id;

              return (
                <li key={c.id} className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <SupplierAvatar
                        nome={c.supplierNome}
                        logoUrl={c.supplierLogoUrl}
                        size={32}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">
                          {c.supplierNome}
                        </span>
                        <span className="flex items-center gap-1 text-[12px] text-muted">
                          <UserRound size={11} className="shrink-0 text-faint" />
                          {destino.contato ? (
                            <>
                              <span className="truncate">{destino.contato.nome}</span>
                              {destino.contato.cargo && (
                                <span className="truncate text-faint">
                                  · {destino.contato.cargo}
                                </span>
                              )}
                            </>
                          ) : destino.telefone || destino.email ? (
                            <span className="truncate">Contato geral da empresa</span>
                          ) : (
                            <span className="truncate text-accent">Sem contato cadastrado</span>
                          )}
                        </span>
                      </span>
                    </span>

                    <button
                      type="button"
                      onClick={() => setTrocando(aberto ? null : c.id)}
                      aria-expanded={aberto}
                      className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft"
                    >
                      {aberto ? "Fechar" : "Trocar"}
                    </button>

                    <div className="flex shrink-0 gap-1 rounded-full border border-line bg-surface p-0.5">
                      <ChipCanal
                        ativo={canais.includes("whatsapp")}
                        bloqueado={!destino.telefone}
                        icone={<MessageCircle size={13} />}
                        rotulo="WhatsApp"
                        titulo={
                          destino.telefone
                            ? maskPhone(destino.telefone)
                            : "Este contato não tem WhatsApp."
                        }
                        onClick={() => alternarCanal(c.id, "whatsapp")}
                      />
                      <ChipCanal
                        ativo={canais.includes("email")}
                        bloqueado={!destino.email}
                        icone={<Mail size={13} />}
                        rotulo="E-mail"
                        titulo={destino.email ?? "Este contato não tem e-mail."}
                        onClick={() => alternarCanal(c.id, "email")}
                      />
                    </div>
                  </div>

                  {aberto && (
                    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
                      {contatos.length === 0 && (
                        <p className="px-2 py-1 text-[12px] text-muted">
                          Nenhum contato cadastrado neste fornecedor.
                        </p>
                      )}
                      {contatos.map((ct) => (
                        <button
                          key={ct.id}
                          type="button"
                          onClick={() => escolherContato(c, ct)}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-surface",
                            escolhas[c.id]?.contactId === ct.id && "bg-surface",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] text-ink">
                              {ct.nome}
                              {ct.principal && (
                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                  principal
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-[11px] text-muted">
                              {[ct.cargo, ct.telefone ? maskPhone(ct.telefone) : null, ct.email]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          {escolhas[c.id]?.contactId === ct.id && (
                            <Check size={14} className="shrink-0 text-brand" />
                          )}
                        </button>
                      ))}

                      {(c.telefone || c.email) && (
                        <button
                          type="button"
                          onClick={() => escolherContato(c, null)}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-surface",
                            escolhas[c.id]?.contactId === null && "bg-surface",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] text-ink">
                              Contato geral da empresa
                            </span>
                            <span className="block truncate text-[11px] text-muted">
                              {[c.telefone ? maskPhone(c.telefone) : null, c.email]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          {escolhas[c.id]?.contactId === null && (
                            <Check size={14} className="shrink-0 text-brand" />
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setCadastrando(c)}
                        className="mt-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] font-medium text-brand transition-colors hover:bg-surface"
                      >
                        + Adicionar contato
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {erro && <p className="text-[13px] text-danger">{erro}</p>}
        </div>
      </Sheet>

      {cadastrando && (
        <ContatoSheet
          aberto
          supplierId={cadastrando.supplierId}
          primeiro={contatosDe(cadastrando).length === 0}
          onFechar={() => setCadastrando(null)}
          onSalvo={(salvo) => {
            const convite = cadastrando;
            const contato: ContatoConvite = {
              id: salvo.id,
              nome: salvo.nome,
              cargo: salvo.cargo,
              telefone: salvo.telefone,
              email: salvo.email,
              principal: salvo.principal,
            };
            // Entra na lista e já assume o envio: quem cadastra o vendedor no
            // meio do disparo quer mandar para ele agora.
            setNovos((n) => ({
              ...n,
              [convite.supplierId]: [...(n[convite.supplierId] ?? []), contato],
            }));
            setEscolhas((e) => ({
              ...e,
              [convite.id]: { contactId: contato.id, canais: canaisIniciais(contato) },
            }));
            setTrocando(null);
            setCadastrando(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ChipCanal({
  ativo,
  bloqueado,
  icone,
  rotulo,
  titulo,
  onClick,
}: {
  ativo: boolean;
  bloqueado: boolean;
  icone: React.ReactNode;
  rotulo: string;
  titulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={bloqueado}
      aria-pressed={ativo && !bloqueado}
      title={titulo}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
        ativo && !bloqueado ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
        bloqueado && "opacity-40",
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}
