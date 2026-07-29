"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, Store, Truck, Wine } from "lucide-react";
import { cn } from "@/lib/utils";

const segmentos = [
  {
    icon: Store,
    nome: "Mercado",
    texto: "Controle estoque, compras, financeiro e PDV em um único sistema.",
  },
  {
    icon: ShoppingCart,
    nome: "Conveniência",
    texto: "Reposição inteligente, operação rápida e controle em tempo real.",
  },
  {
    icon: Truck,
    nome: "Distribuidora",
    texto: "Pedidos, entregas, bonificações e gestão completa de fornecedores.",
  },
  {
    icon: Wine,
    nome: "Loja de bebidas",
    texto: "Controle de garrafas, lotes, estoque e vendas com facilidade.",
  },
];

const INTERVALO = 5000;

/**
 * Card único que apresenta os perfis de operação atendidos — troca sozinho a
 * cada 5s. Sem print e sem mockup: só o ícone, o nome do segmento e uma linha
 * do que ele ganha. O contêiner tem altura reservada para a troca não empurrar
 * o layout.
 */
export function SegmentosCarousel() {
  const [i, setI] = useState(0);
  // Pausa enquanto o ponteiro está sobre o card: quem parou para ler não é
  // interrompido pelo relógio.
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    if (pausado) return;
    const t = setInterval(() => setI((v) => (v + 1) % segmentos.length), INTERVALO);
    return () => clearInterval(t);
  }, [pausado, i]);

  const atual = segmentos[i];
  const Icon = atual.icon;

  return (
    <div
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      className={cn(
        "auth-rise relative overflow-hidden rounded-[24px] border border-[var(--auth-line)]",
        "bg-[var(--auth-card)]/75 p-6 backdrop-blur-sm",
        "shadow-[0_18px_50px_-32px_rgba(15,23,42,0.35)] lg:p-7",
      )}
      style={{ animationDelay: "620ms" }}
    >
      {/* Glow que acompanha a troca — nasce atrás do ícone do segmento ativo. */}
      <div
        aria-hidden
        key={`glow-${i}`}
        className="auth-glow-in pointer-events-none absolute -left-10 -top-12 h-44 w-44 rounded-full blur-[60px]"
        style={{ background: "radial-gradient(circle, var(--auth-glow), transparent 70%)" }}
      />

      <div className="relative">
        <p className="font-display text-[15px] font-semibold text-[var(--auth-ink)]">
          Feito para cada tipo de operação
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--auth-muted)]">
          Uma plataforma adaptada para diferentes modelos de negócio.
        </p>

        {/* Altura fixa: a troca acontece dentro da caixa, o card não pulsa. */}
        <div className="mt-5 min-h-[76px]" aria-live="polite">
          <div key={i} className="auth-slide-in flex items-start gap-3.5">
            <span className="auth-icon-pop grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--auth-brand-tint)] text-[var(--auth-brand-text)]">
              <Icon size={19} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--auth-ink)]">{atual.nome}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--auth-muted)]">
                {atual.texto}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-1.5">
          {segmentos.map((s, idx) => (
            <button
              key={s.nome}
              type="button"
              onClick={() => setI(idx)}
              aria-label={`Ver ${s.nome}`}
              aria-current={idx === i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                idx === i
                  ? "w-6 bg-[var(--auth-brand)]"
                  : "w-1.5 bg-[var(--auth-line-strong)] hover:bg-[var(--auth-muted)]",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
