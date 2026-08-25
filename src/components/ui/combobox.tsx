"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; group?: string };

/**
 * Onde a lista deve aparecer, em coordenadas de viewport.
 *
 * A lista sai do fluxo e vai para um portal no `body` porque `absolute` dentro
 * do formulário é refém dos ancestrais: um `overflow-hidden` num card corta a
 * lista, e qualquer ancestral com `transform`/`z-index` próprio a enterra por
 * baixo do painel vizinho. Medindo o campo e desenhando por cima de tudo, o
 * dropdown deixa de depender do layout de quem o usa.
 */
function useAncora(aberto: boolean, ref: React.RefObject<HTMLElement | null>) {
  const [caixa, setCaixa] = React.useState<{
    left: number;
    top: number;
    width: number;
    /** Espaço até o fim da janela — a lista encolhe em vez de vazar. */
    maxHeight: number;
    acima: boolean;
  } | null>(null);

  React.useLayoutEffect(() => {
    // Fechado não zera a medida: quem lê só desenha com `aberto`, e remedir
    // antes do paint na reabertura já corrige a posição.
    if (!aberto) return;

    function medir() {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const abaixo = window.innerHeight - r.bottom - 8;
      const acima = r.top - 8;
      // Campo no rodapé de um formulário longo: abrir para baixo daria uma
      // lista de duas linhas. Aí ela sobe.
      const paraCima = abaixo < 180 && acima > abaixo;
      setCaixa({
        left: r.left,
        top: paraCima ? r.top - 4 : r.bottom + 4,
        width: r.width,
        maxHeight: Math.min(288, Math.max(120, paraCima ? acima : abaixo)),
        acima: paraCima,
      });
    }

    medir();
    // `true` = fase de captura: pega o scroll de qualquer contêiner interno,
    // não só o da janela.
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
    };
  }, [aberto, ref]);

  return caixa;
}

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

/**
 * Campo de busca com lista — digita, filtra, escolhe. Quando o texto não bate
 * com nenhuma opção, oferece criar ali mesmo (sem abrir modal).
 *
 * `freeText` = o valor é o próprio texto digitado (marca, por ex.): sai do campo
 * e o que estiver escrito vira o valor. Sem `freeText`, o valor é o `value` da
 * opção escolhida (id).
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  emptyText = "Nada encontrado.",
  freeText = false,
  onCreate,
  createLabel,
  renderCreate,
  onCommit,
  className,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  freeText?: boolean;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  /** Substitui a linha de criar por um bloco próprio (ex.: escolher a categoria). */
  renderCreate?: (query: string, close: () => void) => React.ReactNode;
  /** Chamado quando o operador confirma um valor pelo teclado — usado para pular ao próximo campo. */
  onCommit?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listaRef = React.useRef<HTMLDivElement>(null);
  const caixa = useAncora(open, wrapRef);

  const display =
    options.find((o) => o.value === value)?.label ?? (freeText ? value : "");

  const filtered = React.useMemo(() => {
    const q = norm(query);
    if (!q) return options;
    return options.filter(
      (o) => norm(o.label).includes(q) || norm(o.group ?? "").includes(q),
    );
  }, [options, query]);

  const exact = options.some((o) => norm(o.label) === norm(query));
  const showCreate =
    query.trim().length > 0 && !exact && (!!onCreate || !!renderCreate);

  const commit = React.useCallback(() => {
    if (!freeText) return;
    const q = query.trim();
    const hit = options.find((o) => norm(o.label) === norm(q));
    if (hit) onChange(hit.value);
    else if (q) onChange(q);
  }, [freeText, query, options, onChange]);

  const close = React.useCallback(
    (withCommit = true) => {
      if (withCommit) commit();
      setOpen(false);
      setQuery("");
      setActive(0);
    },
    [commit],
  );

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      // A lista mora num portal, fora do wrapper: sem checá-la também, clicar
      // numa opção fecharia antes do clique chegar nela.
      if (wrapRef.current?.contains(alvo) || listaRef.current?.contains(alvo)) return;
      close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  function pick(v: string) {
    onChange(v);
    close(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const max = filtered.length + (showCreate && onCreate ? 1 : 0) - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(max, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open) return onCommit?.();
      if (active < filtered.length) {
        pick(filtered[active].value);
        onCommit?.();
      } else if (showCreate && onCreate) {
        onCreate(query.trim());
        close(false);
        onCommit?.();
      } else if (freeText) {
        // Texto livre sem opção equivalente (marca nova) — vale como resposta.
        close(true);
        inputRef.current?.blur();
        onCommit?.();
      }
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      close(false);
    }
  }

  // Cabeçalho de grupo aparece quando o grupo muda em relação à linha anterior.
  const rows = React.useMemo(
    () =>
      filtered.map((o, i) => ({
        option: o,
        head: o.group && o.group !== filtered[i - 1]?.group ? o.group : null,
      })),
    [filtered],
  );

  const listId = React.useId();

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : display}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "h-11 w-full rounded-[var(--radius)] border border-line-strong bg-surface pl-4 pr-9 text-sm text-ink",
          "placeholder:text-faint transition-colors",
          "focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      />
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />

      {open && caixa && createPortal(
        <div
          ref={listaRef}
          id={listId}
          role="listbox"
          style={{
            left: caixa.left,
            width: caixa.width,
            maxHeight: caixa.maxHeight,
            ...(caixa.acima
              ? { bottom: window.innerHeight - caixa.top }
              : { top: caixa.top }),
          }}
          // z-[100]: acima de sheets e painéis. Uma lista de categorias por
          // baixo do formulário não é um detalhe estético — é o campo
          // obrigatório que o operador não consegue preencher.
          className="fixed z-[100] overflow-auto rounded-[var(--radius)] border border-line-strong bg-surface p-1 shadow-[var(--shadow-2)]"
        >
          {rows.map(({ option: o, head }, i) => (
            <React.Fragment key={o.value}>
              {head && (
                <div className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.15em] text-faint">
                  {head}
                </div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm transition-colors",
                  i === active ? "bg-surface-2 text-ink" : "text-ink-2",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.value === value && (
                  <Check size={14} className="shrink-0 text-brand-strong" />
                )}
              </button>
            </React.Fragment>
          ))}

          {filtered.length === 0 && !showCreate && (
            <p className="px-2.5 py-3 text-sm text-muted">{emptyText}</p>
          )}

          {showCreate &&
            (renderCreate ? (
              <div className="mt-1 border-t border-line pt-1">
                {renderCreate(query.trim(), () => close(false))}
              </div>
            ) : (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(filtered.length)}
                onClick={() => {
                  onCreate?.(query.trim());
                  close(false);
                }}
                className={cn(
                  "mt-1 flex w-full items-center gap-2 rounded-[var(--radius-sm)] border-t border-line px-2.5 py-2 text-left text-sm font-medium text-brand-strong",
                  active === filtered.length && "bg-brand-soft",
                )}
              >
                <Plus size={14} className="shrink-0" />
                {createLabel?.(query.trim()) ?? `Criar “${query.trim()}”`}
              </button>
            ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
