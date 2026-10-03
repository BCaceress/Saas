// ── Etapas da cotação ───────────────────────────────────────
// O selo de status dizia UMA palavra ("Parcialmente respondida"). A trilha diz
// onde a cotação está no caminho inteiro — enviada, respostas, decisão,
// pedidos — e o que falta na etapa atual. Função pura: derivada dos mesmos
// dados que a tela já carrega, sem coluna nova.

import type { CotacaoStatus } from "./_compra-types";

export type EstadoEtapa = "feito" | "atual" | "futuro";

export type Etapa = {
  id: "enviada" | "respostas" | "decisao" | "pedidos";
  rotulo: string;
  /** Complemento curto ("3 de 4", "2 a enviar"). */
  detalhe: string | null;
  estado: EstadoEtapa;
};

type Convite = { status: "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA" };
type Pedido = { status: string };

export function etapasDaCotacao(
  status: CotacaoStatus,
  convites: Convite[],
  pedidos: Pedido[],
): Etapa[] {
  const total = convites.length;
  const respondidos = convites.filter((c) => c.status === "RESPONDIDA").length;
  const recusados = convites.filter((c) => c.status === "RECUSADA").length;
  const naoEnviados = convites.filter((c) => c.status === "PENDENTE").length;
  const faltam = total - respondidos - recusados;
  const vivos = pedidos.filter((p) => p.status !== "CANCELADO");
  const rascunhos = vivos.filter((p) => p.status === "RASCUNHO").length;

  // Onde a cotação está. Encerrar o prazo ou todos terem respondido leva à
  // decisão mesmo com gente faltando — esperar não é mais o trabalho.
  const atual: Etapa["id"] =
    status === "RASCUNHO"
      ? "enviada"
      : status === "DECIDIDA"
        ? "pedidos"
        : status === "ENCERRADA" || (respondidos > 0 && faltam <= 0)
          ? "decisao"
          : "respostas";

  const ordem: Etapa["id"][] = ["enviada", "respostas", "decisao", "pedidos"];
  const posAtual = ordem.indexOf(atual);
  // Pedidos todos enviados = o caminho acabou; não há etapa "atual" a cobrar.
  const tudoFeito = status === "DECIDIDA" && vivos.length > 0 && rascunhos === 0;

  const estado = (id: Etapa["id"]): EstadoEtapa => {
    const pos = ordem.indexOf(id);
    if (tudoFeito || pos < posAtual) return "feito";
    return pos === posAtual ? "atual" : "futuro";
  };

  return [
    {
      id: "enviada",
      rotulo: "Enviada",
      detalhe: naoEnviados > 0 && status !== "RASCUNHO" ? `${naoEnviados} a enviar` : null,
      estado: estado("enviada"),
    },
    {
      id: "respostas",
      rotulo: "Respostas",
      detalhe: total > 0 ? `${respondidos} de ${total}` : null,
      estado: estado("respostas"),
    },
    {
      id: "decisao",
      rotulo: "Decisão",
      detalhe: status === "DECIDIDA" ? "concluída" : status === "ENCERRADA" ? "em andamento" : null,
      estado: estado("decisao"),
    },
    {
      id: "pedidos",
      rotulo: "Pedidos",
      detalhe:
        vivos.length === 0
          ? null
          : rascunhos > 0
            ? `${rascunhos} a enviar`
            : `${vivos.length} ${vivos.length === 1 ? "enviado" : "enviados"}`,
      estado: estado("pedidos"),
    },
  ];
}
