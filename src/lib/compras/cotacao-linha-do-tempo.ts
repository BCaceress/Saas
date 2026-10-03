// ============================================================
// Linha do tempo da cotação — tudo o que aconteceu, em ordem.
//
// Não existe tabela de eventos: cada fato já tem sua data em algum lugar
// (envio, abertura do link, resposta, pedido, entrada). Esta função pura
// junta as datas numa lista só, do mais recente para o mais antigo. Fecha o
// ciclo que o comprador quer ver: pediu → responderam → decidiu → pediu →
// recebeu — e se o que chegou custou o que foi cotado.
// ============================================================

export type TomEvento = "neutro" | "marca" | "ok" | "alerta" | "perigo";

export type EventoCotacao = {
  id: string;
  em: string;
  titulo: string;
  detalhe: string | null;
  tom: TomEvento;
};

export type EntradaLinhaDoTempo = {
  criadaEm: string;
  geradaPorRecorrencia: boolean;
  encerradaEm: string | null;
  decididaEm: string | null;
  canceladaEm: string | null;
  convites: {
    id: string;
    supplierNome: string;
    status: "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA";
    abertoEm: string | null;
    respondidaEm: string | null;
    origemResposta: "link" | "manual" | null;
    observacao: string | null;
    envios: {
      id: string;
      canal: "WHATSAPP" | "EMAIL";
      contatoNome: string | null;
      reenvio: boolean;
      sucesso: boolean;
      enviadoEm: string;
      automatico: boolean;
      status: "ENVIADA" | "ENTREGUE" | "LIDA" | "FALHOU" | null;
    }[];
  }[];
  pedidos: {
    id: string;
    numero: string;
    supplierNome: string;
    status: string;
    criadoEm: string;
    enviadoEm: string | null;
    recebidoEm: string | null;
    valorTotal: number;
    valorRecebido: number;
  }[];
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const CANAL = { WHATSAPP: "WhatsApp", EMAIL: "e-mail" } as const;

/** Diferença entre o faturado e o pedido que só vira notícia acima de 1%. */
const DESVIO_MINIMO = 0.01;

export function montarLinhaDoTempo(e: EntradaLinhaDoTempo): EventoCotacao[] {
  const ev: EventoCotacao[] = [];
  const add = (x: EventoCotacao) => ev.push(x);

  add({
    id: "criada",
    em: e.criadaEm,
    titulo: e.geradaPorRecorrencia ? "Montada pela repetição programada" : "Cotação criada",
    detalhe: null,
    tom: "neutro",
  });

  for (const c of e.convites) {
    for (const s of c.envios) {
      // Contato com o mesmo nome da empresa (o contato "geral") não se repete.
      const para =
        s.contatoNome && s.contatoNome.trim().toLowerCase() !== c.supplierNome.trim().toLowerCase()
          ? `${c.supplierNome} — ${s.contatoNome}`
          : c.supplierNome;
      add({
        id: `envio:${s.id}`,
        em: s.enviadoEm,
        titulo: `${s.reenvio ? "Cobrado" : "Enviada"} para ${para}`,
        detalhe: [
          `por ${CANAL[s.canal]}${s.automatico ? " (automático)" : ""}`,
          !s.sucesso || s.status === "FALHOU"
            ? "falhou"
            : s.status === "LIDA"
              ? "lida"
              : s.status === "ENTREGUE"
                ? "entregue"
                : null,
        ]
          .filter(Boolean)
          .join(" · "),
        tom: !s.sucesso || s.status === "FALHOU" ? "perigo" : "neutro",
      });
    }
    if (c.abertoEm) {
      add({
        id: `aberto:${c.id}`,
        em: c.abertoEm,
        titulo: `${c.supplierNome} abriu o link`,
        detalhe: null,
        tom: "neutro",
      });
    }
    if (c.respondidaEm && c.status === "RESPONDIDA") {
      add({
        id: `resposta:${c.id}`,
        em: c.respondidaEm,
        titulo: `${c.supplierNome} respondeu`,
        detalhe: c.origemResposta === "manual" ? "registrada pela loja" : "pelo link",
        tom: "marca",
      });
    }
    if (c.respondidaEm && c.status === "RECUSADA") {
      add({
        id: `recusa:${c.id}`,
        em: c.respondidaEm,
        titulo: `${c.supplierNome} não vai cotar`,
        detalhe: c.observacao,
        tom: "alerta",
      });
    }
  }

  if (e.encerradaEm) {
    add({ id: "encerrada", em: e.encerradaEm, titulo: "Respostas encerradas", detalhe: null, tom: "neutro" });
  }
  if (e.decididaEm) {
    add({ id: "decidida", em: e.decididaEm, titulo: "Cotação concluída", detalhe: null, tom: "ok" });
  }
  if (e.canceladaEm) {
    add({ id: "cancelada", em: e.canceladaEm, titulo: "Cotação cancelada", detalhe: null, tom: "perigo" });
  }

  for (const p of e.pedidos) {
    add({
      id: `pedido:${p.id}`,
      em: p.criadoEm,
      titulo: `Pedido ${p.numero} gerado`,
      detalhe: `${p.supplierNome} · ${brl(p.valorTotal)} · rascunho`,
      tom: "neutro",
    });
    if (p.enviadoEm) {
      add({
        id: `pedido-enviado:${p.id}`,
        em: p.enviadoEm,
        titulo: `Pedido ${p.numero} enviado`,
        detalhe: p.supplierNome,
        tom: "marca",
      });
    }
    if (p.recebidoEm || p.valorRecebido > 0) {
      const desvio = p.valorTotal > 0 ? (p.valorRecebido - p.valorTotal) / p.valorTotal : 0;
      const pct = Math.round(Math.abs(desvio) * 1000) / 10;
      add({
        id: `pedido-recebido:${p.id}`,
        // Sem data de recebimento (parcial), a entrada mais recente não está
        // aqui — o pedido enviado é a melhor âncora que sobra.
        em: p.recebidoEm ?? p.enviadoEm ?? p.criadoEm,
        titulo: p.status === "RECEBIDO_PARCIAL" ? `Pedido ${p.numero} recebido em parte` : `Pedido ${p.numero} recebido`,
        detalhe:
          Math.abs(desvio) < DESVIO_MINIMO
            ? `${brl(p.valorRecebido)} — igual ao cotado`
            : `${brl(p.valorRecebido)} faturado contra ${brl(p.valorTotal)} cotado (${desvio > 0 ? "+" : "−"}${pct.toLocaleString("pt-BR")}%)`,
        tom: desvio > DESVIO_MINIMO && p.status !== "RECEBIDO_PARCIAL" ? "alerta" : "ok",
      });
    }
  }

  return ev.sort((a, b) => b.em.localeCompare(a.em));
}
