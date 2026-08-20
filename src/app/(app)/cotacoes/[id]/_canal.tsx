"use client";

import { Mail, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Canal de envio ──────────────────────────────────────────
// O link é o MESMO nos dois canais — a escolha aqui é só por onde ele chega.
// Nenhuma experiência paralela para e-mail: quem abrir por lá cai na mesma
// página que quem abrir pelo WhatsApp.
//
// E-mail sai do servidor na hora. WhatsApp não tem gateway: o sistema monta a
// mensagem e o operador dispara — por isso "WhatsApp" aqui significa "me dê a
// mensagem pronta", e não "mande por mim".

export type Canal = "whatsapp" | "email";

const OPCOES: { id: Canal; label: string; icone: typeof Mail }[] = [
  { id: "whatsapp", label: "WhatsApp", icone: MessageCircle },
  { id: "email", label: "E-mail", icone: Mail },
];

export function CanalPicker({
  canais,
  onChange,
  semEmail,
}: {
  canais: Canal[];
  onChange: (c: Canal[]) => void;
  /** Nenhum dos destinatários tem e-mail cadastrado. */
  semEmail?: boolean;
}) {
  function alternar(id: Canal) {
    const tem = canais.includes(id);
    // Sempre sobra um canal: cotação sem carteiro não sai do lugar.
    if (tem && canais.length === 1) return;
    onChange(tem ? canais.filter((c) => c !== id) : [...canais, id]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-muted">Enviar por</span>
      <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5">
        {OPCOES.map((o) => {
          const ativo = canais.includes(o.id);
          const bloqueado = o.id === "email" && semEmail;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => alternar(o.id)}
              disabled={bloqueado}
              aria-pressed={ativo}
              title={bloqueado ? "Nenhum fornecedor selecionado tem e-mail cadastrado." : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                ativo ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
                bloqueado && "opacity-40",
              )}
            >
              <o.icone size={14} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
