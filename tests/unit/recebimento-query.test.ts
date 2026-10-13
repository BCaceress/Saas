import { describe, it, expect } from "vitest";
import {
  abasDeRecebimento,
  filtrosAtivos,
  filtrosDaUrl,
  montarPagina,
  mostraPedidos,
  periodoAplicavel,
  placeholderBusca,
  REC_FILTROS_VAZIO,
  REC_LIMITE_PADRAO,
  REC_RECORTES,
  soPedidos,
  urlDosFiltros,
} from "@/app/(app)/recebimento/_query";

// /recebimento abre em TODOS e o status é um filtro de seleção múltipla que
// mora na URL — é ele que decide o que o servidor consulta. Estes testes travam
// esse contrato: se os dois lados divergirem, a tela mostra um recorte e o
// banco devolve outro, e nada quebra alto o bastante para alguém notar.

describe("filtrosDaUrl", () => {
  it("sem parâmetros, mostra todos", () => {
    const f = filtrosDaUrl({});
    expect(f.abas).toEqual([]);
    expect(f.pagina).toBe(1);
    expect(f.limite).toBe(REC_LIMITE_PADRAO);
  });

  // O parâmetro continua chamando `status` na URL de propósito: links antigos
  // (o alerta de /pedidos, favoritos do operador) precisam cair no lugar certo.
  it("aceita o recorte legado ?status=sem-nfe", () => {
    expect(filtrosDaUrl({ status: "sem-nfe" }).abas).toEqual(["sem-nfe"]);
  });

  it("aceita vários status, sempre na ordem canônica e sem repetição", () => {
    expect(filtrosDaUrl({ status: "divergencia,aguardando,divergencia" }).abas).toEqual([
      "aguardando",
      "divergencia",
    ]);
    expect(filtrosDaUrl({ status: ["concluidos", "andamento"] }).abas).toEqual([
      "andamento",
      "concluidos",
    ]);
  });

  it("status desconhecido é ignorado — cai em todos, não numa lista vazia", () => {
    expect(filtrosDaUrl({ status: "tudo" }).abas).toEqual([]);
    expect(filtrosDaUrl({ status: "" }).abas).toEqual([]);
    expect(filtrosDaUrl({ status: "tudo,andamento" }).abas).toEqual(["andamento"]);
  });

  // Quem chega buscando procura UM registro, que pode ser de meses atrás.
  it("busca na URL derruba o período padrão", () => {
    expect(filtrosDaUrl({ q: "REC-00054" }).periodo).toBe("");
  });

  it("ordem da data: mais recente primeiro, salvo pedido explícito", () => {
    expect(filtrosDaUrl({}).ordem).toBe("desc");
    expect(filtrosDaUrl({ ordem: "asc" }).ordem).toBe("asc");
    expect(filtrosDaUrl({ ordem: "qualquer" }).ordem).toBe("desc");
    expect(urlDosFiltros({ ...REC_FILTROS_VAZIO, ordem: "asc" })).toBe("?ordem=asc");
  });

  it("só aceita os tamanhos de página oferecidos", () => {
    expect(filtrosDaUrl({ limite: "50" }).limite).toBe(50);
    expect(filtrosDaUrl({ limite: "100" }).limite).toBe(100);
    expect(filtrosDaUrl({ limite: "5000" }).limite).toBe(REC_LIMITE_PADRAO);
  });
});

describe("urlDosFiltros", () => {
  it("o padrão da tela não suja a URL", () => {
    expect(urlDosFiltros(REC_FILTROS_VAZIO)).toBe("");
  });

  it("ida e volta preservam o recorte", () => {
    const f = {
      ...REC_FILTROS_VAZIO,
      abas: ["andamento" as const, "concluidos" as const],
      q: "AMBEV",
      pagina: 3,
      limite: 50,
    };
    const url = urlDosFiltros(f);
    const sp = Object.fromEntries(new URLSearchParams(url.slice(1)));
    const volta = filtrosDaUrl(sp);
    expect(volta.abas).toEqual(["andamento", "concluidos"]);
    expect(volta.q).toBe("AMBEV");
    expect(volta.pagina).toBe(3);
    expect(volta.limite).toBe(50);
  });
});

describe("os recortes", () => {
  it("as opções do filtro, na ordem de quem precisa agir", () => {
    expect(REC_RECORTES.map((t) => t.aba)).toEqual([
      "aguardando",
      "andamento",
      "divergencia",
      "concluidos",
      "avulsos",
      "sem-nfe",
    ]);
  });

  it("pedidos entram em 'todos' e quando Aguardando está marcado", () => {
    expect(mostraPedidos([])).toBe(true);
    expect(mostraPedidos(["aguardando", "concluidos"])).toBe(true);
    expect(mostraPedidos(["andamento"])).toBe(false);
  });

  it("só Aguardando sozinho troca a lista paginada para pedidos", () => {
    expect(soPedidos(["aguardando"])).toBe(true);
    expect(soPedidos([])).toBe(false);
    expect(soPedidos(["aguardando", "andamento"])).toBe(false);
  });

  it("Aguardando não vira recorte de recebimento", () => {
    expect(abasDeRecebimento(["aguardando", "divergencia"])).toEqual(["divergencia"]);
    expect(abasDeRecebimento([])).toEqual([]);
  });

  // Esconder uma conferência aberta há 40 dias por causa de um filtro padrão de
  // 30 dias transformaria o filtro num apagador de pendência.
  it("período só aparece quando há histórico na tela", () => {
    expect(periodoAplicavel([])).toBe(true);
    expect(periodoAplicavel(["concluidos"])).toBe(true);
    expect(periodoAplicavel(["andamento", "avulsos"])).toBe(true);
    expect(periodoAplicavel(["aguardando"])).toBe(false);
    expect(periodoAplicavel(["andamento", "divergencia"])).toBe(false);
    expect(periodoAplicavel(["sem-nfe"])).toBe(false);
  });

  it("status marcado conta como filtro ativo", () => {
    expect(filtrosAtivos(REC_FILTROS_VAZIO)).toBe(false);
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, abas: ["concluidos"] })).toBe(true);
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, q: "REC-1" })).toBe(true);
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, periodo: "7" })).toBe(true);
  });

  it("a busca promete só o que a tela tem", () => {
    expect(placeholderBusca(["aguardando"])).toContain("pedido");
    expect(placeholderBusca(["aguardando"])).not.toContain("NF-e");
    expect(placeholderBusca([])).toContain("NF-e");
    expect(placeholderBusca(["concluidos"])).toContain("NF-e");
  });
});

describe("montarPagina", () => {
  it("conta as páginas pelo total do banco, não pelo que veio", () => {
    const p = montarPagina([1, 2, 3], 3482, { ...REC_FILTROS_VAZIO, pagina: 2, limite: 20 });
    expect(p.total).toBe(3482);
    expect(p.page).toBe(2);
    expect(p.limit).toBe(20);
    expect(p.totalPages).toBe(175);
  });

  it("lista vazia ainda tem uma página — não zero", () => {
    const p = montarPagina([], 0, REC_FILTROS_VAZIO);
    expect(p.totalPages).toBe(1);
  });
});
