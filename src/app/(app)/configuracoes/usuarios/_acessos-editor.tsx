"use client";

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "../_ui";
import {
  PERFIL_LABEL,
  PERFIL_DESCRICAO,
  PERFIS,
  perfilEhGlobal,
  type Acesso,
} from "@/lib/permissoes";
import type { Perfil } from "@/generated/prisma";

export type SiteOpt = { id: string; nome: string; tipo: string };

const OPERACIONAIS = PERFIS.filter((p) => !perfilEhGlobal(p));

function tem(acessos: Acesso[], perfil: Perfil, siteId: string | null) {
  return acessos.some((a) => a.perfil === perfil && a.siteId === siteId);
}

/**
 * Matriz perfil × loja. ADMINISTRADOR é um interruptor à parte: quando ligado,
 * dá acesso ao tenant inteiro e a matriz some — acesso por loja viraria ruído.
 */
export function AcessosEditor({
  acessos,
  onChange,
  sites,
  disabled,
}: {
  acessos: Acesso[];
  onChange: (a: Acesso[]) => void;
  sites: SiteOpt[];
  disabled?: boolean;
}) {
  const admin = acessos.some((a) => a.perfil === "ADMINISTRADOR");
  // Com uma loja só, "Todas" e a própria loja seriam a mesma coluna — some.
  const multiLoja = sites.length > 1;

  function setAdmin(v: boolean) {
    onChange(v ? [{ perfil: "ADMINISTRADOR", siteId: null }] : []);
  }

  function toggleGlobal(perfil: Perfil, v: boolean) {
    const sem = acessos.filter((a) => a.perfil !== perfil);
    onChange(v ? [...sem, { perfil, siteId: null }] : sem);
  }

  function toggleLoja(perfil: Perfil, siteId: string, v: boolean) {
    onChange(
      v
        ? [...acessos, { perfil, siteId }]
        : acessos.filter((a) => !(a.perfil === perfil && a.siteId === siteId)),
    );
  }

  /**
   * Loja única: guarda o acesso preso a ela (nunca global). Se um dia entrar uma
   * segunda loja, o acesso antigo não passa a valer para ela por tabela.
   */
  function toggleUnica(perfil: Perfil, siteId: string, v: boolean) {
    const sem = acessos.filter((a) => a.perfil !== perfil);
    onChange(v ? [...sem, { perfil, siteId }] : sem);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Administrador */}
      <div
        className={cn(
          "flex items-start gap-3 rounded-[var(--radius-lg)] border p-4 transition-colors",
          admin ? "border-brand bg-brand-soft/40" : "border-line bg-surface-2",
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <ShieldCheck size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{PERFIL_LABEL.ADMINISTRADOR}</p>
          <p className="mt-0.5 text-xs text-muted">{PERFIL_DESCRICAO.ADMINISTRADOR}</p>
        </div>
        <Switch
          checked={admin}
          onChange={setAdmin}
          disabled={disabled}
          label="Administrador"
        />
      </div>

      {admin ? (
        <p className="text-xs text-muted">
          Administrador já alcança todas as lojas — não há o que restringir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="px-4 py-2.5 text-left font-medium text-muted">Perfil</th>
                {multiLoja && (
                  <th className="px-3 py-2.5 text-center font-medium text-muted">Todas</th>
                )}
                {sites.map((s) => (
                  <th
                    key={s.id}
                    className="px-3 py-2.5 text-center font-medium text-muted"
                    title={s.tipo === "CD" ? "Centro de distribuição" : "Loja"}
                  >
                    {s.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {OPERACIONAIS.map((perfil) => {
                const global = tem(acessos, perfil, null);
                return (
                  <tr key={perfil}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{PERFIL_LABEL[perfil]}</p>
                      <p className="mt-0.5 text-xs text-muted">{PERFIL_DESCRICAO[perfil]}</p>
                    </td>
                    {multiLoja && (
                      <td className="px-3 py-3 text-center">
                        <Celula
                          checked={global}
                          disabled={disabled}
                          onChange={(v) => toggleGlobal(perfil, v)}
                          label={`${PERFIL_LABEL[perfil]} em todas as lojas`}
                        />
                      </td>
                    )}
                    {sites.map((s) => (
                      <td key={s.id} className="px-3 py-3 text-center">
                        <Celula
                          checked={global || tem(acessos, perfil, s.id)}
                          disabled={disabled || (multiLoja && global)}
                          onChange={(v) =>
                            multiLoja
                              ? toggleLoja(perfil, s.id, v)
                              : toggleUnica(perfil, s.id, v)
                          }
                          label={`${PERFIL_LABEL[perfil]} em ${s.nome}`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Celula({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4.5 w-4.5 cursor-pointer accent-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-45"
    />
  );
}

/** Resumo dos acessos em chips — usado na lista de membros e de convites. */
export function AcessosChips({
  acessos,
  sites,
}: {
  acessos: Acesso[];
  sites: SiteOpt[];
}) {
  if (acessos.length === 0) {
    return <span className="text-xs text-faint">Sem acesso</span>;
  }
  const nomeDaLoja = (id: string) => sites.find((s) => s.id === id)?.nome ?? "loja removida";
  // Com uma loja só, dizer em qual loja é redundante.
  const mostrarLoja = sites.length > 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {acessos.map((a) => (
        <span
          key={`${a.perfil}:${a.siteId ?? "*"}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            a.perfil === "ADMINISTRADOR"
              ? "border-transparent bg-brand-soft text-brand-strong"
              : "border-line bg-surface-2 text-muted",
          )}
        >
          {PERFIL_LABEL[a.perfil]}
          {a.perfil !== "ADMINISTRADOR" && mostrarLoja && (
            <span className="text-faint">
              · {a.siteId === null ? "todas" : nomeDaLoja(a.siteId)}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
