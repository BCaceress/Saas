"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { esquecerContextoAcoes } from "@/components/mobile/contexto-acoes";
import { toast } from "@/components/ui/toast";
import { trocarSiteAction } from "@/app/(mobile)/m/menu/actions";

/**
 * Em qual loja este celular está operando.
 *
 * A troca só existia na tela de mesa, e o `/m` inteiro (saldo, contagem, venda,
 * pedido) lê a loja ativa no servidor. Quem cobre duas unidades ficava preso na
 * escolha do computador — e contar prateleira da loja B vendo o saldo da loja A
 * não é incômodo de navegação, é erro de estoque.
 *
 * Vive no cartão do usuário, junto do nome da empresa: é ali que a pessoa olha
 * para saber "onde eu estou".
 */
export function TrocaLoja({
  sites,
  siteAtivo,
}: {
  sites: Array<{ id: string; nome: string }>;
  siteAtivo: string | null;
}) {
  const router = useRouter();
  const [aberta, setAberta] = React.useState(false);
  const [trocando, setTrocando] = React.useState<string | null>(null);

  // Uma loja só: não há escolha a fazer, e um seletor de um item é ruído.
  if (sites.length < 2) return null;

  const atual = sites.find((s) => s.id === siteAtivo) ?? sites[0];

  async function trocar(id: string) {
    if (id === atual?.id) {
      setAberta(false);
      return;
    }
    setTrocando(id);
    try {
      await trocarSiteAction({ siteId: id });
      // A memória de lojas/permissões da aba envelheceu junto com o cookie.
      esquecerContextoAcoes();
      setAberta(false);
      // `refresh` e não `push`: a pessoa continua na tela em que estava, só que
      // agora com os números da outra loja.
      router.refresh();
      toast.success(`Operando em ${sites.find((s) => s.id === id)?.nome ?? "outra loja"}`);
    } catch (e) {
      toast.error("Não foi possível trocar de loja", e instanceof Error ? e.message : undefined);
    } finally {
      setTrocando(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-haspopup="dialog"
        className="tap mt-3 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-full border border-line-button bg-surface-2 px-3 text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <Store className="h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {atual?.nome ?? "Escolher loja"}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </button>

      <BottomSheet
        open={aberta}
        onClose={() => setAberta(false)}
        titulo="Operar em qual loja?"
        descricao="Saldo, contagem e venda passam a ser desta loja."
      >
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line pb-2">
          {sites.map((s) => {
            const ativa = s.id === atual?.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void trocar(s.id)}
                  disabled={trocando !== null}
                  aria-current={ativa ? "true" : undefined}
                  className={cn(
                    "flex min-h-14 w-full cursor-pointer items-center gap-3 bg-surface px-4 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-60",
                    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  )}
                >
                  <span
                    className={cn(
                      "flex-1 truncate text-sm",
                      ativa ? "font-semibold text-ink" : "font-medium text-ink-2",
                    )}
                  >
                    {s.nome}
                  </span>
                  {trocando === s.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden />
                  ) : (
                    ativa && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </>
  );
}
