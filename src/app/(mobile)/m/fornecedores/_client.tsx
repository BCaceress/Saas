"use client";

import * as React from "react";
import {
  ChevronDown,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Truck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/misc";
import { SupplierAvatar } from "@/app/(app)/cotacoes/_ui";
import { diasDeCalendario } from "@/lib/datas";
import { FormContato } from "./_contato-form";
import type { ContatoMobile, FornecedorMobile } from "./_data";

type Filtro = "ativos" | "chegando" | "todos";

/**
 * Lista de consulta e contato. Filtro na memória do aparelho, como em
 * `/m/produtos`: um mercadinho tem dezenas de fornecedores, e ir ao servidor a
 * cada letra digitada custaria mais que carregar a lista uma vez.
 *
 * O cartão inteiro NÃO é link: no celular não existe ficha de fornecedor (o
 * centro de gestão é tela de mesa), então o toque útil é ligar ou chamar no
 * WhatsApp — dois alvos explícitos valem mais que um cartão que navega para
 * lugar nenhum.
 *
 * A exceção é a AGENDA DE PESSOAS: o telefone da empresa cai no 0800 de
 * faturamento, e quem responde cotação é o vendedor. Os contatos abrem dentro
 * do próprio cartão (sem sair da lista) e podem ser cadastrados aqui — é de pé,
 * na entrega, que o vendedor novo passa o WhatsApp.
 */
export function FornecedoresClient({
  fornecedores,
  podeEditar,
}: {
  fornecedores: FornecedorMobile[];
  /** `fornecedor.editar`: sem ela a agenda é só leitura. */
  podeEditar: boolean;
}) {
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<Filtro>("ativos");

  const contagem = React.useMemo(
    () => ({
      ativos: fornecedores.filter((f) => f.ativo).length,
      chegando: fornecedores.filter((f) => f.pedidosAbertos > 0).length,
      todos: fornecedores.length,
    }),
    [fornecedores],
  );

  const linhas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return fornecedores.filter((f) => {
      if (
        termo &&
        !`${f.razaoSocial} ${f.nomeFantasia ?? ""} ${f.municipio ?? ""} ${f.cnpj ?? ""}`
          .toLowerCase()
          .includes(termo)
      ) {
        return false;
      }
      if (filtro === "chegando") return f.pedidosAbertos > 0;
      if (filtro === "todos") return true;
      return f.ativo;
    });
  }, [fornecedores, busca, filtro]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, cidade ou CNPJ"
          aria-label="Buscar fornecedor"
          className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip ativo={filtro === "ativos"} onClick={() => setFiltro("ativos")}>
          Ativos {contagem.ativos}
        </Chip>
        <Chip ativo={filtro === "chegando"} onClick={() => setFiltro("chegando")}>
          Com pedido {contagem.chegando}
        </Chip>
        <Chip ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Todos {contagem.todos}
        </Chip>
      </div>

      {linhas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <Truck className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">Nada por aqui</p>
          <p className="text-sm text-ink-2">
            {busca
              ? "Nenhum fornecedor com esse termo. Confira o nome ou a cidade."
              : "Nenhum fornecedor neste filtro. O cadastro é feito na versão de computador."}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {linhas.map((f) => (
            <LinhaFornecedor key={f.id} f={f} podeEditar={podeEditar} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** wa.me exige DDI; o cadastro guarda DDD+número (mesma regra de clientes). */
const linkWhatsApp = (tel: string) =>
  `https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`;

/** "hoje" / "amanhã" / "atrasada" / "12/09" — a previsão em uma palavra. */
function quandoChega(iso: string): { texto: string; atrasada: boolean } {
  const dias = diasDeCalendario(iso);
  if (dias == null) return { texto: "sem previsão", atrasada: false };
  // `diasDeCalendario` conta para trás: 1 = ontem. Previsão futura vem negativa.
  if (dias > 0) return { texto: "entrega atrasada", atrasada: true };
  if (dias === 0) return { texto: "entrega hoje", atrasada: false };
  if (dias === -1) return { texto: "entrega amanhã", atrasada: false };
  return {
    texto: `entrega ${new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
    atrasada: false,
  };
}

function LinhaFornecedor({
  f,
  podeEditar,
}: {
  f: FornecedorMobile;
  podeEditar: boolean;
}) {
  const nome = f.nomeFantasia?.trim() || f.razaoSocial;
  const local = [f.municipio, f.uf].filter(Boolean).join("/");
  const entrega = f.proximaEntrega ? quandoChega(f.proximaEntrega) : null;
  const [aberto, setAberto] = React.useState(false);
  /** `null` = nenhum formulário; `"novo"` = cadastro; objeto = edição. */
  const [editando, setEditando] = React.useState<ContatoMobile | "novo" | null>(null);

  return (
    <li>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-3">
          <SupplierAvatar nome={nome} logoUrl={f.logoUrl} size={40} />

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{nome}</p>
            <p className="truncate text-xs text-ink-2">{local || "Sem cidade no cadastro"}</p>
            {f.pedidosAbertos > 0 ? (
              <p
                className={cn(
                  "truncate text-[11px] font-medium",
                  entrega?.atrasada ? "text-danger" : "text-brand",
                )}
              >
                {f.pedidosAbertos} {f.pedidosAbertos === 1 ? "pedido aberto" : "pedidos abertos"}
                {entrega ? ` · ${entrega.texto}` : ""}
              </p>
            ) : (
              !f.ativo && <p className="text-[11px] font-medium text-warn">Inativo</p>
            )}
          </div>

          {/* Os dois alvos que o aparelho resolve sozinho. Sem telefone no
              cadastro nenhum dos dois aparece — botão morto ensina errado. */}
          {f.telefone && (
            <div className="flex shrink-0 gap-1.5">
              <a
                href={linkWhatsApp(f.telefone)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Chamar ${nome} no WhatsApp`}
                className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-2 text-ink-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <MessageCircle className="h-5 w-5" aria-hidden />
              </a>
              <a
                href={`tel:+55${f.telefone}`}
                aria-label={`Ligar para ${nome}`}
                className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-2 text-ink-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <Phone className="h-5 w-5" aria-hidden />
              </a>
            </div>
          )}
        </div>

        {/* Pessoas do fornecedor. Fechado por padrão: a lista tem dezenas de
            cartões, e abrir todos empurraria a busca para fora da tela. */}
        <div className="border-t border-line">
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left"
          >
            <Users className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            <span className="flex-1 truncate text-[13px] text-ink-2">
              {f.contatos.length === 0
                ? "Sem contato cadastrado"
                : f.contatos.length === 1
                  ? `1 contato · ${f.contatos[0].nome}`
                  : `${f.contatos.length} contatos`}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-faint transition-transform",
                aberto && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {aberto && (
            <div className="space-y-1.5 px-3 pb-3">
              {f.contatos.map((c) => (
                <LinhaContato
                  key={c.id}
                  c={c}
                  podeEditar={podeEditar}
                  onEditar={() => setEditando(c)}
                />
              ))}

              {f.contatos.length === 0 && (
                <p className="py-1 text-xs text-muted">
                  A cotação vai para uma pessoa, não para a empresa. Cadastre o vendedor
                  que atende você.
                </p>
              )}

              {podeEditar && (
                <button
                  type="button"
                  onClick={() => setEditando("novo")}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-dashed border-line-button text-[13px] font-medium text-ink-2"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Novo contato
                </button>
              )}
            </div>
          )}
        </div>
      </Card>

      {editando && (
        <FormContato
          supplierId={f.id}
          fornecedorNome={nome}
          base={editando === "novo" ? null : editando}
          onFechar={() => setEditando(null)}
        />
      )}
    </li>
  );
}

/**
 * Uma pessoa do fornecedor. Os alvos são os mesmos do cartão da empresa —
 * WhatsApp, ligação, e-mail —, porque o motivo de abrir a lista é falar com
 * ela agora; editar fica atrás do lápis, mais estreito de propósito.
 */
function LinhaContato({
  c,
  podeEditar,
  onEditar,
}: {
  c: ContatoMobile;
  podeEditar: boolean;
  onEditar: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] bg-surface-2 p-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-[13px] font-medium text-ink">
          {c.principal && (
            <Star
              className="h-3 w-3 shrink-0 fill-accent text-accent"
              aria-label="Recebe as cotações"
            />
          )}
          <span className="truncate">{c.nome}</span>
        </p>
        <p className="truncate text-[11px] text-ink-2">
          {c.cargo || (c.telefone ? formatarTelefone(c.telefone) : c.email) || "Sem função"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {c.telefone && (
          <>
            <a
              href={linkWhatsApp(c.telefone)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Chamar ${c.nome} no WhatsApp`}
              className={ALVO_CONTATO}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
            </a>
            <a
              href={`tel:+55${c.telefone}`}
              aria-label={`Ligar para ${c.nome}`}
              className={ALVO_CONTATO}
            >
              <Phone className="h-4 w-4" aria-hidden />
            </a>
          </>
        )}
        {!c.telefone && c.email && (
          <a href={`mailto:${c.email}`} aria-label={`E-mail para ${c.nome}`} className={ALVO_CONTATO}>
            <Mail className="h-4 w-4" aria-hidden />
          </a>
        )}
        {podeEditar && (
          <button
            type="button"
            onClick={onEditar}
            aria-label={`Editar ${c.nome}`}
            className={ALVO_CONTATO}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

const ALVO_CONTATO =
  "grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

/** "(11) 99999-9999" a partir dos dígitos guardados. */
function formatarTelefone(tel: string): string {
  const d = tel.length > 11 ? tel.slice(-11) : tel;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-9 shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2",
      )}
    >
      {children}
    </button>
  );
}
