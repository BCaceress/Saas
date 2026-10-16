"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/sheet";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";

// ============================================================
// Manifestação do destinatário — compartilhado entre a fila de notas
// recebidas e a configuração de notas fiscais. Quem usa injeta a action, que
// decide em qual loja (CNPJ) a manifestação vale.
// ============================================================

export const MANIFESTACOES = [
  {
    tipo: "CIENCIA",
    label: "Dar ciência",
    ajuda: "Só avisa a SEFAZ que você viu a nota. Libera o XML completo e não assume nada.",
  },
  {
    tipo: "CONFIRMACAO",
    label: "Confirmar operação",
    ajuda: "A mercadoria chegou e a nota está correta. É definitivo.",
  },
  {
    tipo: "DESCONHECIMENTO",
    label: "Desconhecer",
    ajuda: "Você não reconhece essa compra. Exige justificativa.",
  },
  {
    tipo: "NAO_REALIZADA",
    label: "Operação não realizada",
    ajuda: "A nota existe mas a entrega não aconteceu (recusa, devolução). Exige justificativa.",
  },
] as const;

export type TipoManifestacao = (typeof MANIFESTACOES)[number]["tipo"];

export type NotaParaManifestar = {
  chave: string;
  emitRazaoSocial: string;
  numero: number;
  serie: number;
};

export function ModalManifestacao({
  nota,
  manifestar,
  onClose,
  onFeito,
}: {
  nota: NotaParaManifestar;
  manifestar: (input: {
    chave: string;
    tipo: TipoManifestacao;
    justificativa?: string;
  }) => Promise<{ ok: boolean; mensagem: string }>;
  onClose: () => void;
  onFeito: () => void;
}) {
  const [tipo, setTipo] = useState<TipoManifestacao>("CIENCIA");
  const [justificativa, setJustificativa] = useState("");
  const [pending, start] = useTransition();

  const escolha = MANIFESTACOES.find((m) => m.tipo === tipo)!;
  const precisaJustificativa = tipo === "DESCONHECIMENTO" || tipo === "NAO_REALIZADA";

  function confirmar() {
    start(async () => {
      try {
        const r = await manifestar({
          chave: nota.chave,
          tipo,
          justificativa: precisaJustificativa ? justificativa : undefined,
        });
        if (r.ok) toast.success(r.mensagem);
        else toast.error(r.mensagem);
        onFeito();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao manifestar.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Manifestar nota"
      description={`${nota.emitRazaoSocial} — NF-e ${nota.numero}/${nota.serie}`}
      width="md"
    >
      <div className="flex flex-col gap-4">
        <Field label="O que você quer registrar" htmlFor="tipo" hint={escolha.ajuda}>
          <Select
            id="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoManifestacao)}
          >
            {MANIFESTACOES.map((m) => (
              <option key={m.tipo} value={m.tipo}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        {precisaJustificativa && (
          <Field
            label="Justificativa"
            htmlFor="justificativa"
            hint="Mínimo de 15 caracteres — a SEFAZ recusa textos curtos."
          >
            <Input
              id="justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: mercadoria recusada na portaria por avaria"
            />
          </Field>
        )}

        <p className="text-xs text-muted">
          Manifestação não tem desfazer na SEFAZ. A chave fica registrada no histórico fiscal.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={confirmar} disabled={pending}>
          {pending ? "Enviando…" : escolha.label}
        </Button>
      </div>
    </Modal>
  );
}
