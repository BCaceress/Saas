import * as React from "react";
import { Loader2, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CopilotoMensagemUI } from "./use-copiloto-chat";

const TOOL_LABEL: Record<string, string> = {
  consultarVendas: "Consultando vendas…",
  getRelatorio: "Gerando relatório…",
  compararFornecedores: "Comparando fornecedores…",
};

/** `**negrito**`, linhas "- item" e quebra de linha — sem HTML, sem lib nova. */
function renderInline(texto: string, keyBase: string): React.ReactNode[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((parte, i) =>
      parte.startsWith("**") && parte.endsWith("**") ? (
        <strong key={`${keyBase}-${i}`} className="font-semibold">
          {parte.slice(2, -2)}
        </strong>
      ) : (
        <React.Fragment key={`${keyBase}-${i}`}>{parte}</React.Fragment>
      ),
    );
}

function TextoFormatado({ texto }: { texto: string }) {
  const blocos: React.ReactNode[] = [];
  let listaAtual: string[] = [];

  const fecharLista = (chave: string) => {
    if (listaAtual.length === 0) return;
    blocos.push(
      <ul key={chave} className="ml-4 list-disc space-y-0.5">
        {listaAtual.map((item, i) => (
          <li key={i}>{renderInline(item, `${chave}-li-${i}`)}</li>
        ))}
      </ul>,
    );
    listaAtual = [];
  };

  texto.split("\n").forEach((linha, idx) => {
    const item = linha.match(/^\s*[-•]\s+(.*)$/);
    if (item) {
      listaAtual.push(item[1]);
      return;
    }
    fecharLista(`ul-${idx}`);
    if (linha.trim() !== "") {
      blocos.push(
        <p key={`p-${idx}`} className="leading-relaxed">
          {renderInline(linha, `p-${idx}`)}
        </p>,
      );
    }
  });
  fecharLista("ul-fim");

  return <div className="space-y-1 text-sm">{blocos}</div>;
}

export function CopilotoMensagem({ mensagem }: { mensagem: CopilotoMensagemUI }) {
  const souUsuario = mensagem.role === "user";

  return (
    <div className={cn("flex gap-2", souUsuario && "flex-row-reverse")}>
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line",
          souUsuario ? "bg-surface-2 text-muted" : "bg-brand-soft text-brand",
        )}
        aria-hidden
      >
        {souUsuario ? <User size={13} /> : <Sparkles size={13} />}
      </span>

      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl px-3 py-2",
          souUsuario ? "bg-brand text-on-brand" : "border border-line bg-surface-2 text-ink",
        )}
      >
        {mensagem.toolAtual && (
          <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={11} className="animate-spin" aria-hidden />
            {TOOL_LABEL[mensagem.toolAtual] ?? "Consultando…"}
          </p>
        )}

        {mensagem.texto ? (
          <TextoFormatado texto={mensagem.texto} />
        ) : mensagem.status === "streaming" ? (
          <Loader2 size={14} className="animate-spin text-muted" aria-hidden />
        ) : null}

        {mensagem.status === "erro" && !mensagem.texto && (
          <p className="text-sm text-danger">Não consegui responder agora.</p>
        )}
      </div>
    </div>
  );
}
