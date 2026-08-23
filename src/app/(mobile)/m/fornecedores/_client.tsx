"use client";

import * as React from "react";
import { MessageCircle, Phone, Search, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/misc";
import { SupplierAvatar } from "@/app/(app)/cotacoes/_ui";
import { diasDeCalendario } from "@/lib/datas";
import type { FornecedorMobile } from "./_data";

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
 */
export function FornecedoresClient({
  fornecedores,
}: {
  fornecedores: FornecedorMobile[];
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
            <LinhaFornecedor key={f.id} f={f} />
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

function LinhaFornecedor({ f }: { f: FornecedorMobile }) {
  const nome = f.nomeFantasia?.trim() || f.razaoSocial;
  const local = [f.municipio, f.uf].filter(Boolean).join("/");
  const entrega = f.proximaEntrega ? quandoChega(f.proximaEntrega) : null;

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
      </Card>
    </li>
  );
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
